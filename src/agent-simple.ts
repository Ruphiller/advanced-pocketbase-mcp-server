#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import PocketBase from 'pocketbase';
import { z } from 'zod';
import { EventSource } from 'eventsource';
import * as dotenv from 'dotenv';
import { StripeService } from './services/stripe.js';
import { EmailService } from './services/email.js';

// Load environment variables from .env file
dotenv.config();

// Assign the polyfill to the global scope for PocketBase SDK to find
// @ts-ignore - Need to assign to global scope
global.EventSource = EventSource;

// Smithery configToEnv mapping
const configToEnv = {
  pocketbaseUrl: 'POCKETBASE_URL',
  adminEmail: 'POCKETBASE_ADMIN_EMAIL', 
  adminPassword: 'POCKETBASE_ADMIN_PASSWORD',
  stripeSecretKey: 'STRIPE_SECRET_KEY',
  emailService: 'EMAIL_SERVICE',
  smtpHost: 'SMTP_HOST',
  smtpPort: 'SMTP_PORT',
  smtpUser: 'SMTP_USER',
  smtpPassword: 'SMTP_PASSWORD',
  sendgridApiKey: 'SENDGRID_API_KEY',
  defaultFromEmail: 'DEFAULT_FROM_EMAIL'
};

// Apply configuration to environment variables if provided
function applyConfigToEnv(config: Record<string, any>): void {
  Object.entries(configToEnv).forEach(([configKey, envVar]) => {
    if (config[configKey] !== undefined && config[configKey] !== null) {
      process.env[envVar] = String(config[configKey]);
    }
  });
}

// Configuration interface
interface ServerConfiguration {
  pocketbaseUrl?: string;
  adminEmail?: string;
  adminPassword?: string;
  stripeSecretKey?: string;
  emailService?: string;
  smtpHost?: string;
}

// Initialization state interface
interface InitializationState {
  configLoaded: boolean;
  pocketbaseInitialized: boolean;
  servicesInitialized: boolean;
  hasValidConfig: boolean;
  isAuthenticated: boolean;
  initializationError?: string;
}

// Agent state interface for persistence (Cloudflare compatibility)
interface AgentState {
  sessionId?: string;
  configuration?: ServerConfiguration;
  initializationState: InitializationState;
  customHeaders: Record<string, string>;
  lastActiveTime: number;
}

/**
 * Cloudflare-compatible MCP Agent for PocketBase
 * This class encapsulates all stateful operations and can be used with Durable Objects
 */
class PocketBaseMCPAgent {
  private server: McpServer;
  private pb?: PocketBase;
  private stripeService?: StripeService;
  private emailService?: EmailService;
  
  // State management
  private state: AgentState;
  private initializationPromise: Promise<void> | null = null;
  private discoveryMode: boolean = false;

  constructor(initialState?: Partial<AgentState>) {
    // Initialize state from provided state or defaults
    this.state = {
      sessionId: initialState?.sessionId,
      configuration: initialState?.configuration,
      initializationState: initialState?.initializationState || {
        configLoaded: false,
        pocketbaseInitialized: false,
        servicesInitialized: false,
        hasValidConfig: false,
        isAuthenticated: false
      },
      customHeaders: initialState?.customHeaders || {},
      lastActiveTime: Date.now()
    };

    this.server = new McpServer({
      name: 'pocketbase-server',
      version: '0.1.0',
    }, {
      capabilities: {
        resources: {},
        tools: {},
        prompts: {}
      }
    });

    // Setup MCP server components
    this.setupTools();
    this.setupResources();
    this.setupPrompts();
  }

  /**
   * Get current agent state for persistence (Durable Object compatibility)
   */
  getState(): AgentState {
    this.state.lastActiveTime = Date.now();
    return { ...this.state };
  }

  /**
   * Restore agent state from persistence (Durable Object compatibility)
   */
  restoreState(state: AgentState): void {
    this.state = state;
  }

  /**
   * Check if agent should hibernate (for Cloudflare Durable Objects)
   */
  shouldHibernate(): boolean {
    const inactiveTime = Date.now() - this.state.lastActiveTime;
    const HIBERNATION_THRESHOLD = 30 * 60 * 1000; // 30 minutes
    return inactiveTime > HIBERNATION_THRESHOLD;
  }

  /**
   * Wake up from hibernation
   */
  async wakeUp(): Promise<void> {
    this.state.lastActiveTime = Date.now();
    if (this.state.initializationState.pocketbaseInitialized && !this.pb) {
      await this.doInitialization();
    }
  }

  /**
   * Initialize the agent (can be called multiple times safely)
   */
  async init(config?: ServerConfiguration): Promise<void> {
    this.state.lastActiveTime = Date.now();
    await this.ensureInitialized(config);
  }

  /**
   * Load configuration from environment variables or provided config
   */
  private loadConfiguration(config?: ServerConfiguration): ServerConfiguration {
    if (this.state.initializationState.configLoaded && this.state.configuration) {
      return this.state.configuration;
    }

    try {
      if (config) {
        applyConfigToEnv(config as Record<string, any>);
      }

      const pocketbaseUrl = config?.pocketbaseUrl || process.env.POCKETBASE_URL;
      const adminEmail = config?.adminEmail || process.env.POCKETBASE_ADMIN_EMAIL;
      const adminPassword = config?.adminPassword || process.env.POCKETBASE_ADMIN_PASSWORD;
      const stripeSecretKey = config?.stripeSecretKey || process.env.STRIPE_SECRET_KEY;

      this.state.configuration = {
        pocketbaseUrl,
        adminEmail,
        adminPassword,
        stripeSecretKey
      };

      this.state.initializationState.configLoaded = true;
      this.state.initializationState.hasValidConfig = Boolean(pocketbaseUrl);
      
      return this.state.configuration;
    } catch (error: any) {
      this.state.initializationState.initializationError = error.message;
      throw error;
    }
  }

  /**
   * Ensure the agent is properly initialized
   */
  async ensureInitialized(config?: ServerConfiguration): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    if (this.state.initializationState.pocketbaseInitialized && this.state.initializationState.servicesInitialized) {
      return;
    }

    this.initializationPromise = this.doInitialization(config);
    
    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  /**
   * Perform the actual initialization
   */
  private async doInitialization(config?: ServerConfiguration): Promise<void> {
    try {
      this.loadConfiguration(config);

      if (!this.state.initializationState.hasValidConfig) {
        this.discoveryMode = true;
        return;
      }

      // Initialize PocketBase
      if (!this.state.initializationState.pocketbaseInitialized) {
        await this.initializePocketBase();
      }

      // Initialize services
      if (!this.state.initializationState.servicesInitialized) {
        await this.initializeServices();
      }

    } catch (error: any) {
      this.state.initializationState.initializationError = error.message;
      this.discoveryMode = true;
    }
  }

  /**
   * Initialize PocketBase connection
   */
  private async initializePocketBase(): Promise<void> {
    if (!this.state.configuration?.pocketbaseUrl) {
      throw new Error('PocketBase URL is required for initialization');
    }

    try {
      this.pb = new PocketBase(this.state.configuration.pocketbaseUrl);
      
      // Test connection
      try {
        await this.pb.health.check();
      } catch (error) {
        console.warn('PocketBase health check failed, continuing anyway');
      }

      // Authenticate if credentials provided
      if (this.state.configuration.adminEmail && this.state.configuration.adminPassword) {
        try {
          await (this.pb as any).admins.authWithPassword(
            this.state.configuration.adminEmail,
            this.state.configuration.adminPassword
          );
          this.state.initializationState.isAuthenticated = true;
        } catch (error) {
          console.warn('Admin authentication failed, continuing without auth');
        }
      }

      this.state.initializationState.pocketbaseInitialized = true;
    } catch (error: any) {
      throw new Error(`Failed to initialize PocketBase: ${error.message}`);
    }
  }

  /**
   * Initialize additional services
   */
  private async initializeServices(): Promise<void> {
    try {
      if (this.state.configuration?.stripeSecretKey && this.pb) {
        try {
          this.stripeService = new StripeService(this.pb);
        } catch (error) {
          console.warn('Stripe service initialization failed');
        }
      }

      if ((this.state.configuration?.emailService || this.state.configuration?.smtpHost) && this.pb) {
        try {
          this.emailService = new EmailService(this.pb);
        } catch (error) {
          console.warn('Email service initialization failed');
        }
      }

      this.state.initializationState.servicesInitialized = true;
    } catch (error: any) {
      throw new Error(`Failed to initialize services: ${error.message}`);
    }
  }

  /**
   * Setup tool handlers using the correct MCP SDK API
   */
  private setupTools(): void {
    // Health check tool (always available)
    this.server.tool(
      'health_check',
      {
        description: 'Check the health status of the MCP server and PocketBase connection'
      },
      async () => {
        const status: Record<string, any> = {
          server: 'healthy',
          timestamp: new Date().toISOString(),
          initialized: this.state.initializationState.pocketbaseInitialized,
          authenticated: this.state.initializationState.isAuthenticated,
          discoveryMode: this.discoveryMode
        };

        if (this.pb) {
          try {
            await this.pb.health.check();
            status.pocketbase = 'healthy';
          } catch (error) {
            status.pocketbase = 'unhealthy';
          }
        } else {
          status.pocketbase = 'not initialized';
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(status, null, 2)
          }]
        };
      }
    );

    // Tool discovery (always available)
    this.server.tool(
      'discover_tools',
      {
        description: 'List all available tools and their current status'
      },
      async () => {
        const tools = [];
        
        tools.push({
          name: 'health_check',
          status: 'available',
          description: 'Health check tool'
        });
        
        tools.push({
          name: 'discover_tools', 
          status: 'available',
          description: 'Tool discovery'
        });

        // PocketBase tools
        const pbStatus = this.state.initializationState.pocketbaseInitialized ? 'available' : 'requires_initialization';
        ['list_collections', 'get_collection', 'list_records', 'get_record', 'create_record'].forEach(toolName => {
          tools.push({
            name: toolName,
            status: pbStatus,
            description: `PocketBase ${toolName.replace(/_/g, ' ')}`
          });
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              totalTools: tools.length,
              availableTools: tools.filter(t => t.status === 'available').length,
              tools: tools
            }, null, 2)
          }]
        };
      }
    );

    // Smithery discovery tool
    this.server.tool(
      'smithery_discovery',
      {
        description: 'Fast discovery endpoint for Smithery tool scanning'
      },
      async () => {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              server: 'pocketbase-mcp-server',
              version: '0.1.0',
              capabilities: ['pocketbase', 'database', 'realtime', 'auth'],
              status: 'ready',
              discoveryTime: '0ms'
            }, null, 2)
          }]
        };
      }
    );

    // PocketBase collection tools
    this.server.tool(
      'list_collections',
      {
        description: 'List all collections in the PocketBase database'
      },
      async () => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        try {
          const collections = await this.pb.collections.getFullList();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(collections, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to list collections: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'get_collection',
      {
        description: 'Get details of a specific collection',
        inputSchema: {
          nameOrId: z.string().describe('Collection name or ID')
        }
      },
      async ({ nameOrId }) => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        try {
          const collection = await this.pb.collections.getOne(nameOrId);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(collection, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to get collection: ${error.message}`);
        }
      }
    );

    // PocketBase record tools
    this.server.tool(
      'list_records',
      {
        description: 'List records from a collection',
        inputSchema: {
          collection: z.string().describe('Collection name'),
          page: z.number().optional().describe('Page number (default: 1)'),
          perPage: z.number().optional().describe('Records per page (default: 30)')
        }
      },
      async ({ collection, page = 1, perPage = 30 }) => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        try {
          const records = await this.pb.collection(collection).getList(page, perPage);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(records, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to list records: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'get_record',
      {
        description: 'Get a specific record by ID',
        inputSchema: {
          collection: z.string().describe('Collection name'),
          id: z.string().describe('Record ID')
        }
      },
      async ({ collection, id }) => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        try {
          const record = await this.pb.collection(collection).getOne(id);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(record, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to get record: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'create_record',
      {
        description: 'Create a new record in a collection',
        inputSchema: {
          collection: z.string().describe('Collection name'),
          data: z.record(z.any()).describe('Record data')
        }
      },
      async ({ collection, data }) => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        try {
          const record = await this.pb.collection(collection).create(data);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(record, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to create record: ${error.message}`);
        }
      }
    );

    // Test tool (always available)
    this.server.tool(
      'test_tool',
      {
        description: 'A simple test tool that always works to verify tool registration'
      },
      async () => {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              message: 'Test tool working!',
              timestamp: new Date().toISOString(),
              totalRegisteredTools: 'This should increase the count if registration works'
            }, null, 2)
          }]
        };
      }
    );

    // Always register all tools (lazy loading approach)
    this.setupStripeTools();
    this.setupEmailTools();
  }

  /**
   * Setup Stripe-related tools
   */
  private setupStripeTools(): void {
    this.server.tool(
      'create_stripe_customer',
      'Create a new customer in Stripe',
      {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email', description: 'Customer email' },
          name: { type: 'string', description: 'Customer name' }
        },
        required: ['email']
      },
      async ({ email, name }) => {
        // Lazy load Stripe service
        await this.ensureStripeService();
        
        if (!this.stripeService) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Stripe service not available. Please set STRIPE_SECRET_KEY environment variable.'
              })
            }]
          };
        }

        try {
          const customer = await this.stripeService.createCustomer({ email, name });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(customer, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: `Failed to create Stripe customer: ${error.message}`
              })
            }]
          };
        }
      }
    );

    this.server.tool(
      'create_stripe_payment_intent',
      'Create a Stripe payment intent for processing payments',
      {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Amount in cents (e.g., 2000 for $20.00)' },
          currency: { type: 'string', description: 'Three-letter currency code (e.g., USD)' },
          description: { type: 'string', description: 'Optional description for the payment' }
        },
        required: ['amount', 'currency']
      },
      async ({ amount, currency, description }) => {
        // Lazy load Stripe service
        await this.ensureStripeService();
        
        if (!this.stripeService) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Stripe service not available. Please set STRIPE_SECRET_KEY environment variable.'
              })
            }]
          };
        }

        try {
          const paymentIntent = await this.stripeService.createPaymentIntent({
            amount,
            currency,
            description
          });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                paymentIntent: {
                  paymentIntentId: paymentIntent.paymentIntentId,
                  clientSecret: paymentIntent.clientSecret
                }
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: `Failed to create payment intent: ${error.message}`
              })
            }]
          };
        }
      }
    );

    this.server.tool(
      'create_stripe_product',
      {
        description: 'Create a new product in Stripe',
        inputSchema: {
          name: z.string().describe('Product name'),
          description: z.string().optional().describe('Product description'),
          price: z.number().int().positive().describe('Price in cents'),
          currency: z.string().length(3).optional().describe('Currency code (default: USD)'),
          interval: z.enum(['month', 'year', 'week', 'day']).optional().describe('Billing interval for subscriptions')
        }
      },
      async ({ name, description, price, currency, interval }) => {
        // Lazy load Stripe service
        await this.ensureStripeService();
        
        if (!this.stripeService) {
          throw new Error('Stripe service not available. Please set STRIPE_SECRET_KEY environment variable.');
        }

        try {
          const product = await this.stripeService.createProduct({
            name,
            description,
            price,
            currency: currency || 'usd',
            interval
          });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                product
              }, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to create product: ${error.message}`);
        }
      }
    );
  }

  /**
   * Setup Email-related tools
   */
  private setupEmailTools(): void {
    this.server.tool(
      'send_templated_email',
      {
        description: 'Send a templated email using the configured email service',
        inputSchema: {
          template: z.string().describe('Email template name'),
          to: z.string().email().describe('Recipient email address'),
          from: z.string().email().optional().describe('Sender email address'),
          subject: z.string().optional().describe('Custom email subject'),
          variables: z.record(z.unknown()).optional().describe('Template variables')
        }
      },
      async ({ template, to, from, subject, variables }) => {
        // Lazy load Email service
        await this.ensureEmailService();
        
        if (!this.emailService) {
          throw new Error('Email service not available. Please configure EMAIL_SERVICE or SMTP settings.');
        }

        try {
          const result = await this.emailService.sendTemplatedEmail({
            template,
            to,
            from,
            customSubject: subject,
            variables
          });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                emailLog: {
                  id: result.id,
                  to: result.to,
                  subject: result.subject,
                  status: result.status,
                  sentAt: result.created
                }
              }, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to send email: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'send_custom_email',
      {
        description: 'Send a custom email with specified content',
        inputSchema: {
          to: z.string().email().describe('Recipient email address'),
          from: z.string().email().optional().describe('Sender email address'),
          subject: z.string().describe('Email subject'),
          html: z.string().describe('HTML email body'),
          text: z.string().optional().describe('Plain text email body')
        }
      },
      async ({ to, from, subject, html, text }) => {
        // Lazy load Email service
        await this.ensureEmailService();
        
        if (!this.emailService) {
          throw new Error('Email service not available. Please configure EMAIL_SERVICE or SMTP settings.');
        }

        try {
          const result = await this.emailService.sendCustomEmail({
            to,
            from,
            subject,
            html,
            text
          });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                emailLog: {
                  id: result.id,
                  to: result.to,
                  subject: result.subject,
                  status: result.status,
                  sentAt: result.created
                }
              }, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to send email: ${error.message}`);
        }
      }
    );
  }

  /**
   * Setup resource handlers
   */
  private setupResources(): void {
    // Agent status resource
    this.server.resource(
      'agent_status',
      'agent://status',
      {
        description: 'Get current agent status and configuration'
      },
      async (uri: any) => {
        const status = {
          agent: {
            sessionId: this.state.sessionId,
            lastActiveTime: new Date(this.state.lastActiveTime).toISOString(),
            discoveryMode: this.discoveryMode
          },
          initialization: this.state.initializationState,
          services: {
            pocketbase: Boolean(this.pb),
            stripe: Boolean(this.stripeService),
            email: Boolean(this.emailService)
          }
        };

        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(status, null, 2)
          }]
        };
      }
    );
  }

  /**
   * Setup prompt handlers
   */
  private setupPrompts(): void {
    this.server.prompt(
      'setup_collection',
      'Interactive prompt to help set up a new PocketBase collection',
      (extra: any) => {
        const name = extra.arguments?.name || 'new_collection';
        const type = extra.arguments?.type || 'base';
        
        return {
          messages: [{
            role: 'assistant',
            content: {
              type: 'text',
              text: `I'll help you set up a new ${type} collection named "${name}". Would you like me to create this collection with a basic schema?`
            }
          }]
        };
      }
    );
  }

  /**
   * Connect to a transport and start the server
   */
  async connect(transport: any): Promise<void> {
    this.state.lastActiveTime = Date.now();
    await this.server.connect(transport);
  }

  /**
   * Get the underlying MCP server instance
   */
  getServer(): McpServer {
    return this.server;
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.pb) {
      try {
        this.pb.authStore.clear();
      } catch (error) {
        console.warn('Error clearing auth store:', error);
      }
    }
  }

  /**
   * Lazy load Stripe service if environment variables are available
   */
  private async ensureStripeService(): Promise<void> {
    if (this.stripeService) return;

    if (!this.pb) {
      throw new Error('PocketBase not initialized. Please configure POCKETBASE_URL environment variable.');
    }

    try {
      this.stripeService = new StripeService(this.pb);
    } catch (error) {
      throw new Error('Stripe service not available. Please configure STRIPE_SECRET_KEY environment variable.');
    }
  }

  /**
   * Lazy load Email service if environment variables are available  
   */
  private async ensureEmailService(): Promise<void> {
    if (this.emailService) return;

    if (!this.pb) {
      throw new Error('PocketBase not initialized. Please configure POCKETBASE_URL environment variable.');
    }

    try {
      this.emailService = new EmailService(this.pb);
    } catch (error) {
      throw new Error('Email service not available. Please configure EMAIL_SERVICE or SMTP_HOST environment variables.');
    }
  }
}

/**
 * Create and configure a new agent instance
 */
export function createAgent(initialState?: Partial<AgentState>): PocketBaseMCPAgent {
  return new PocketBaseMCPAgent(initialState);
}

/**
 * Main server function for traditional deployment
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  const transportType = args.find(arg => arg.startsWith('--transport='))?.split('=')[1] || 'stdio';
  const port = parseInt(args.find(arg => arg.startsWith('--port='))?.split('=')[1] || '3000');
  const host = args.find(arg => arg.startsWith('--host='))?.split('=')[1] || 'localhost';

  // Create agent instance
  const agent = createAgent();

  // Initialize agent
  await agent.init();

  // Set up transport
  let transport: any;
  switch (transportType) {
    case 'stdio':
      transport = new StdioServerTransport();
      break;
    case 'sse':
      // For SSE transport, we would need an Express app setup
      // For now, fall back to stdio
      console.warn('SSE transport not implemented in this simple version, using stdio');
      transport = new StdioServerTransport();
      break;
    default:
      console.error(`Unknown transport type: ${transportType}`);
      process.exit(1);
  }

  // Connect agent to transport
  await agent.connect(transport);
}

// Export for Cloudflare Workers / Durable Objects
export { PocketBaseMCPAgent };

// For traditional deployment - check if this module is being run directly
if (process.argv[1] && process.argv[1].endsWith('agent-simple.js')) {
  main().catch(error => {
    console.error('Server failed to start:', error);
    process.exit(1);
  });
}
