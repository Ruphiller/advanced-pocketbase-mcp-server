#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import PocketBase from 'pocketbase';
import { z } from 'zod';
import { EventSource } from 'eventsource'; // Import the polyfill using named import
import dotenv from 'dotenv'; // Import dotenv for loading .env file
import { StripeService } from './services/stripe.js';
import { EmailService } from './services/email.js';

// Load environment variables from .env file
dotenv.config();

// Assign the polyfill to the global scope for PocketBase SDK to find
// @ts-ignore - Need to assign to global scope
global.EventSource = EventSource;

// Smithery configToEnv mapping
// This maps user-provided configuration parameters to environment variables
// for proper deployment in Smithery environments
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

// Define types for PocketBase
interface CollectionModel {
  id: string;
  name: string;
  type: string;
  system: boolean;
  schema: SchemaField[];
  listRule: string | null;
  viewRule: string | null;
  createRule: string | null;
  updateRule: string | null;
  deleteRule: string | null;
  indexes?: Array<{
    name: string;
    fields: string[];
    unique?: boolean;
  }>;
}

interface RecordModel {
  id: string;
  [key: string]: any;
}

interface ListResult<T> {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: T[];
}

interface RequestHandlerExtra {
  [key: string]: any;
}

// Schema field type
interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  options?: Record<string, any>;
}

// Schema field from input
interface InputSchemaField {
  name: string;
  type: string;
  required?: boolean;
  options?: Record<string, any>;
}

// Type for subscription event (adjust based on actual PocketBase SDK types if known)
interface SubscriptionEvent {
	action: string;
	record: RecordModel;
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

// Configuration interface
interface ServerConfiguration {
  pocketbaseUrl?: string;
  adminEmail?: string;
  adminPassword?: string;
  stripeSecretKey?: string;
  emailService?: string;
  smtpHost?: string;
  // Add other config properties as needed
}

// Agent state interface for persistence
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
  private pb?: PocketBase; // Make optional for deferred initialization
  private _customHeaders: Record<string, string> = {};
  private _realtimeSubscriptions: Map<string, () => void> = new Map();
  private stripeService?: StripeService;
  private emailService?: EmailService;
  
  // Initialization state management
  private initializationState: InitializationState = {
    configLoaded: false,
    pocketbaseInitialized: false,
    servicesInitialized: false,
    hasValidConfig: false,
    isAuthenticated: false
  };
  
  // Flag to indicate if we're in discovery mode (no initialization required)
  private discoveryMode: boolean = false;
  
  // Configuration cache
  private configuration?: ServerConfiguration;
  
  // Initialization promise to prevent multiple simultaneous initializations
  private initializationPromise: Promise<void> | null = null;

  // Agent state persistence
  private state: AgentState;

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

    // Restore state
    this.initializationState = this.state.initializationState;
    this.configuration = this.state.configuration;
    this._customHeaders = this.state.customHeaders;

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

    // Setup MCP server components without initializing PocketBase
    this.setupTools();
    this.setupResources();
    this.setupPrompts();

    // Error handling
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  /**
   * Get current agent state for persistence (Durable Object compatibility)
   */
  getState(): AgentState {
    this.state.initializationState = this.initializationState;
    this.state.configuration = this.configuration;
    this.state.customHeaders = this._customHeaders;
    this.state.lastActiveTime = Date.now();
    return { ...this.state };
  }

  /**
   * Restore agent state from persistence (Durable Object compatibility)
   */
  restoreState(state: AgentState): void {
    this.state = state;
    this.initializationState = state.initializationState;
    this.configuration = state.configuration;
    this._customHeaders = state.customHeaders;
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
    // Reinitialize connections if needed
    if (this.initializationState.pocketbaseInitialized && !this.pb) {
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
   * This is fast and synchronous for discovery purposes
   */
  private loadConfiguration(config?: ServerConfiguration): ServerConfiguration {
    if (this.initializationState.configLoaded && this.configuration) {
      return this.configuration;
    }

    try {
      // Apply config to environment variables if provided (Smithery pattern)
      if (config) {
        try {
          applyConfigToEnv(config as Record<string, any>);
        } catch (error: any) {
          console.warn('Failed to apply config to environment variables:', error.message);
        }
      }

      // Load configuration with validation
      const pocketbaseUrl = config?.pocketbaseUrl || process.env.POCKETBASE_URL;
      const adminEmail = config?.adminEmail || process.env.POCKETBASE_ADMIN_EMAIL;
      const adminPassword = config?.adminPassword || process.env.POCKETBASE_ADMIN_PASSWORD;
      const stripeSecretKey = config?.stripeSecretKey || process.env.STRIPE_SECRET_KEY;
      const emailService = config?.emailService || process.env.EMAIL_SERVICE;
      const smtpHost = config?.smtpHost || process.env.SMTP_HOST;

      // Basic validation for critical configuration
      const configErrors: string[] = [];
      
      if (!pocketbaseUrl) {
        configErrors.push('POCKETBASE_URL is required. Set it as an environment variable or provide it in the configuration.');
      } else {
        // Basic URL validation
        try {
          new URL(pocketbaseUrl);
        } catch {
          configErrors.push(`POCKETBASE_URL "${pocketbaseUrl}" is not a valid URL. Example: http://localhost:8090 or https://your-pb-server.com`);
        }
      }

      // Validate admin credentials if provided
      if ((adminEmail && !adminPassword) || (!adminEmail && adminPassword)) {
        configErrors.push('Both POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD must be provided together for admin authentication.');
      }

      if (adminEmail && adminEmail.indexOf('@') === -1) {
        configErrors.push(`POCKETBASE_ADMIN_EMAIL "${adminEmail}" is not a valid email address.`);
      }

      // Validate Stripe configuration if partially provided
      if (stripeSecretKey && !stripeSecretKey.startsWith('sk_')) {
        configErrors.push('STRIPE_SECRET_KEY appears to be invalid. It should start with "sk_test_" or "sk_live_".');
      }

      this.configuration = {
        pocketbaseUrl,
        adminEmail,
        adminPassword,
        stripeSecretKey,
        emailService,
        smtpHost,
      };

      this.initializationState.configLoaded = true;
      
      // Determine if configuration is valid for initialization
      const hasMinimumConfig = Boolean(pocketbaseUrl) && configErrors.length === 0;
      this.initializationState.hasValidConfig = hasMinimumConfig;
      
      // Log configuration status
      if (configErrors.length > 0) {
        console.warn('Configuration warnings/errors found:', configErrors);
        this.initializationState.initializationError = configErrors.join('\n');
      } else {
        console.log('Configuration loaded successfully');
        console.log(`PocketBase URL: ${pocketbaseUrl}`);
        console.log(`Admin Email: ${adminEmail ? 'Set' : 'Not set'}`);
        console.log(`Stripe Key: ${stripeSecretKey ? 'Set' : 'Not set'}`);
        console.log(`Email Service: ${emailService || 'Not set'}`);
      }

      return this.configuration;

    } catch (error: any) {
      console.error('Failed to load configuration:', error.message);
      this.initializationState.initializationError = `Configuration loading failed: ${error.message}`;
      throw error;
    }
  }

  /**
   * Ensure the agent is properly initialized (lazy initialization)
   * This method can be called multiple times safely and won't re-initialize if already done
   */
  async ensureInitialized(config?: ServerConfiguration): Promise<void> {
    // If already initializing, wait for it to complete
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // If already initialized, just return
    if (this.initializationState.pocketbaseInitialized && 
        this.initializationState.servicesInitialized) {
      return;
    }

    // Start initialization
    this.initializationPromise = this.doInitialization(config);
    
    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  /**
   * Perform the actual initialization (should only be called once)
   */
  private async doInitialization(config?: ServerConfiguration): Promise<void> {
    try {
      console.log('Starting agent initialization...');

      // Step 1: Load configuration
      this.loadConfiguration(config);

      if (!this.initializationState.hasValidConfig) {
        console.warn('Agent initialized in discovery mode due to invalid configuration');
        this.discoveryMode = true;
        return;
      }

      // Step 2: Initialize PocketBase connection
      if (!this.initializationState.pocketbaseInitialized) {
        await this.initializePocketBase();
      }

      // Step 3: Initialize additional services
      if (!this.initializationState.servicesInitialized) {
        await this.initializeServices();
      }

      console.log('Agent initialization completed successfully');

    } catch (error: any) {
      console.error('Agent initialization failed:', error.message);
      this.initializationState.initializationError = error.message;
      
      // In case of error, set discovery mode to allow basic functionality
      this.discoveryMode = true;
      
      // Don't throw - allow the agent to work in discovery mode
    }
  }

  /**
   * Initialize PocketBase connection and authentication
   */
  private async initializePocketBase(): Promise<void> {
    if (!this.configuration?.pocketbaseUrl) {
      throw new Error('PocketBase URL is required for initialization');
    }

    try {
      console.log(`Connecting to PocketBase at ${this.configuration.pocketbaseUrl}...`);
      
      this.pb = new PocketBase(this.configuration.pocketbaseUrl);
      
      // Set custom headers if any
      Object.entries(this._customHeaders).forEach(([key, value]) => {
        this.pb!.beforeSend = (url, options) => {
          options.headers = { ...options.headers, [key]: value };
          return { url, options };
        };
      });

      // Test connection with a simple health check
      try {
        await this.pb.health.check();
        console.log('PocketBase health check passed');
      } catch (error: any) {
        console.warn(`PocketBase health check failed: ${error.message}`);
        // Continue anyway - the server might still be functional
      }

      // Authenticate if admin credentials are provided
      if (this.configuration.adminEmail && this.configuration.adminPassword) {
        try {
          console.log('Authenticating with admin credentials...');
          await (this.pb as any).admins.authWithPassword(
            this.configuration.adminEmail,
            this.configuration.adminPassword
          );
          console.log('Admin authentication successful');
          this.initializationState.isAuthenticated = true;
        } catch (error: any) {
          console.warn(`Admin authentication failed: ${error.message}`);
          console.warn('Continuing without admin authentication');
          // Don't throw - we can still work without admin auth for many operations
        }
      }

      this.initializationState.pocketbaseInitialized = true;
      console.log('PocketBase initialization completed');
      
    } catch (error: any) {
      console.error('PocketBase initialization failed:', error.message);
      throw new Error(`Failed to initialize PocketBase: ${error.message}`);
    }
  }

  /**
   * Initialize additional services (Stripe, Email, etc.)
   */
  private async initializeServices(): Promise<void> {
    try {
      console.log('Initializing additional services...');        // Initialize Stripe service if key is provided
        if (this.configuration?.stripeSecretKey) {
          try {
            if (!this.pb) {
              throw new Error('PocketBase instance required for Stripe service');
            }
            this.stripeService = new StripeService(this.pb);
            console.log('Stripe service initialized');
          } catch (error: any) {
            console.warn(`Stripe service initialization failed: ${error.message}`);
            // Continue without Stripe - it's optional
          }
        }        // Initialize Email service if configuration is provided
        if (this.configuration?.emailService || this.configuration?.smtpHost) {
          try {
            if (!this.pb) {
              throw new Error('PocketBase instance required for Email service');
            }
            this.emailService = new EmailService(this.pb);
            console.log('Email service initialized');
          } catch (error: any) {
            console.warn(`Email service initialization failed: ${error.message}`);
            // Continue without Email - it's optional
          }
        }

      this.initializationState.servicesInitialized = true;
      console.log('Additional services initialization completed');
      
    } catch (error: any) {
      console.error('Services initialization failed:', error.message);
      throw new Error(`Failed to initialize services: ${error.message}`);
    }
  }

  /**
   * Setup tool handlers (called during construction, before initialization)
   */
  private setupTools(): void {
    // Discovery and health tools (always available, no PocketBase required)
    this.server.tool(
      'health_check',
      {
        description: 'Check the health status of the MCP server and PocketBase connection',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      async () => {
        const status: Record<string, any> = {
          server: 'healthy',
          timestamp: new Date().toISOString(),
          initialized: this.initializationState.pocketbaseInitialized,
          authenticated: this.initializationState.isAuthenticated,
          discoveryMode: this.discoveryMode
        };

        if (this.pb) {
          try {
            await this.pb.health.check();
            status.pocketbase = 'healthy';
          } catch (error: any) {
            status.pocketbase = `unhealthy: ${error.message}`;
          }
        } else {
          status.pocketbase = 'not initialized';
        }

        if (this.stripeService) {
          status.stripe = 'available';
        }

        if (this.emailService) {
          status.email = 'available';
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(status, null, 2)
          }]
        };
      }
    );

    this.server.registerTool(
      'discover_tools',
      {
        title: 'Discover Available Tools',
        description: 'List all available tools and their current status',
        inputSchema: {}
      },
      async () => {
        const tools = [];
        
        // Always available tools
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

        // PocketBase tools (require initialization)
        const pbTools = [
          'list_collections', 'get_collection', 'create_collection', 'update_collection', 'delete_collection',
          'list_records', 'get_record', 'create_record', 'update_record', 'delete_record',
          'query_records', 'backup_database', 'restore_database', 'list_admins',
          'create_admin', 'update_admin', 'delete_admin', 'list_users', 'create_user',
          'update_user', 'delete_user', 'authenticate_user', 'send_verification_email',
          'send_password_reset_email', 'list_files', 'upload_file', 'delete_file',
          'get_logs', 'get_stats', 'realtime_subscribe', 'realtime_unsubscribe',
          'set_custom_header', 'remove_custom_header', 'list_custom_headers',
          'validate_record', 'bulk_import', 'bulk_export'
        ];

        pbTools.forEach(toolName => {
          tools.push({
            name: toolName,
            status: this.initializationState.pocketbaseInitialized ? 'available' : 'requires_initialization',
            description: `PocketBase ${toolName.replace(/_/g, ' ')}`
          });
        });

        // Stripe tools
        if (this.stripeService) {
          const stripeTools = ['create_customer', 'get_customer', 'list_customers', 'create_payment_intent'];
          stripeTools.forEach(toolName => {
            tools.push({
              name: toolName,
              status: 'available',
              description: `Stripe ${toolName.replace(/_/g, ' ')}`
            });
          });
        }

        // Email tools
        if (this.emailService) {
          const emailTools = ['send_email', 'send_template_email'];
          emailTools.forEach(toolName => {
            tools.push({
              name: toolName,
              status: 'available', 
              description: `Email ${toolName.replace(/_/g, ' ')}`
            });
          });
        }

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

    // Special Smithery discovery tool for fast scanning
    this.server.registerTool(
      'smithery_discovery',
      {
        title: 'Smithery Discovery',
        description: 'Fast discovery endpoint for Smithery tool scanning',
        inputSchema: {}
      },
      async () => {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              server: 'pocketbase-mcp-server',
              version: '0.1.0',
              capabilities: ['pocketbase', 'database', 'realtime', 'auth', 'files'],
              status: 'ready',
              discoveryTime: '0ms'
            }, null, 2)
          }]
        };
      }
    );

    // PocketBase collection management tools
    this.server.registerTool(
      'list_collections',
      {
        title: 'List Collections',
        description: 'List all collections in the PocketBase database',
        inputSchema: {}
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

    this.server.registerTool(
      'get_collection',
      {
        title: 'Get Collection',
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

    this.server.registerTool(
      'create_collection',
      {
        title: 'Create Collection',
        description: 'Create a new collection in the database',
        inputSchema: {
          name: z.string().describe('Collection name'),
          type: z.enum(['base', 'auth', 'view']).describe('Collection type'),
          schema: z.array(z.object({
            name: z.string(),
            type: z.string(),
            required: z.boolean().optional(),
            options: z.record(z.any()).optional()
          })).describe('Collection schema fields')
        }
      },
      async ({ name, type, schema }) => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        try {
          const collection = await this.pb.collections.create({
            name,
            type,
            schema
          });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(collection, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to create collection: ${error.message}`);
        }
      }
    );

    this.server.registerTool(
      'update_collection',
      {
        title: 'Update Collection',
        description: 'Update an existing collection',
        inputSchema: {
          nameOrId: z.string().describe('Collection name or ID'),
          schema: z.array(z.object({
            name: z.string(),
            type: z.string(),
            required: z.boolean().optional(),
            options: z.record(z.any()).optional()
          })).optional().describe('Updated schema fields'),
          listRule: z.string().nullable().optional().describe('List rule'),
          viewRule: z.string().nullable().optional().describe('View rule'),
          createRule: z.string().nullable().optional().describe('Create rule'),
          updateRule: z.string().nullable().optional().describe('Update rule'),
          deleteRule: z.string().nullable().optional().describe('Delete rule')
        }
      },
      async ({ nameOrId, ...updates }) => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        try {
          const collection = await this.pb.collections.update(nameOrId, updates);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(collection, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to update collection: ${error.message}`);
        }
      }
    );

    this.server.registerTool(
      'delete_collection',
      {
        title: 'Delete Collection',
        description: 'Delete a collection from the database',
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
          await this.pb.collections.delete(nameOrId);
          return {
            content: [{
              type: 'text',
              text: `Collection ${nameOrId} deleted successfully`
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to delete collection: ${error.message}`);
        }
      }
    );

    // PocketBase record management tools
    this.server.registerTool(
      'list_records',
      {
        title: 'List Records',
        description: 'List records from a collection with optional filtering and pagination',
        inputSchema: {
          collection: z.string().describe('Collection name'),
          page: z.number().optional().describe('Page number (default: 1)'),
          perPage: z.number().optional().describe('Records per page (default: 30)'),
          sort: z.string().optional().describe('Sort order (e.g., "-created")'),
          filter: z.string().optional().describe('Filter expression'),
          expand: z.string().optional().describe('Relations to expand')
        }
      },
      async ({ collection, page = 1, perPage = 30, sort, filter, expand }) => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        try {
          const records = await this.pb.collection(collection).getList(page, perPage, {
            sort,
            filter,
            expand
          });
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

    this.server.registerTool(
      'get_record',
      {
        title: 'Get Record',
        description: 'Get a specific record by ID',
        inputSchema: {
          collection: z.string().describe('Collection name'),
          id: z.string().describe('Record ID'),
          expand: z.string().optional().describe('Relations to expand')
        }
      },
      async ({ collection, id, expand }) => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        try {
          const record = await this.pb.collection(collection).getOne(id, { expand });
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

    this.server.registerTool(
      'create_record',
      {
        title: 'Create Record',
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

    this.server.registerTool(
      'update_record',
      {
        title: 'Update Record',
        description: 'Update an existing record',
        inputSchema: {
          collection: z.string().describe('Collection name'),
          id: z.string().describe('Record ID'),
          data: z.record(z.any()).describe('Updated record data')
        }
      },
      async ({ collection, id, data }) => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        try {
          const record = await this.pb.collection(collection).update(id, data);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(record, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to update record: ${error.message}`);
        }
      }
    );

    this.server.registerTool(
      'delete_record',
      {
        title: 'Delete Record',
        description: 'Delete a record from a collection',
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
          await this.pb.collection(collection).delete(id);
          return {
            content: [{
              type: 'text',
              text: `Record ${id} deleted successfully from collection ${collection}`
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to delete record: ${error.message}`);
        }
      }
    );

    // Query tool for complex operations
    this.server.registerTool(
      'query_records',
      {
        title: 'Query Records',
        description: 'Perform complex queries on records with advanced filtering',
        inputSchema: {
          collection: z.string().describe('Collection name'),
          filter: z.string().optional().describe('Filter expression (PocketBase syntax)'),
          sort: z.string().optional().describe('Sort expression'),
          limit: z.number().optional().describe('Maximum number of records to return'),
          expand: z.string().optional().describe('Relations to expand')
        }
      },
      async ({ collection, filter, sort, limit, expand }) => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        try {
          let records;
          if (limit) {
            records = await this.pb.collection(collection).getList(1, limit, {
              filter,
              sort,
              expand
            });
          } else {
            records = await this.pb.collection(collection).getFullList({
              filter,
              sort,
              expand
            });
          }
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(records, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to query records: ${error.message}`);
        }
      }
    );

    // Admin and user management tools (require admin authentication)
    this.server.registerTool(
      'list_admins',
      {
        title: 'List Admins',
        description: 'List all admin users (requires admin authentication)',
        inputSchema: {}
      },
      async () => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }
        if (!this.initializationState.isAuthenticated) {
          throw new Error('Admin authentication required for this operation');
        }

        try {
          const admins = await this.pb.admins.getFullList();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(admins, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to list admins: ${error.message}`);
        }
      }
    );

    this.server.registerTool(
      'create_admin',
      {
        title: 'Create Admin',
        description: 'Create a new admin user (requires admin authentication)',
        inputSchema: {
          email: z.string().email().describe('Admin email'),
          password: z.string().min(8).describe('Admin password'),
          passwordConfirm: z.string().min(8).describe('Password confirmation')
        }
      },
      async ({ email, password, passwordConfirm }) => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }
        if (!this.initializationState.isAuthenticated) {
          throw new Error('Admin authentication required for this operation');
        }

        try {
          const admin = await this.pb.admins.create({
            email,
            password,
            passwordConfirm
          });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(admin, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to create admin: ${error.message}`);
        }
      }
    );

    // Authentication tools
    this.server.registerTool(
      'authenticate_user',
      {
        title: 'Authenticate User',
        description: 'Authenticate a user with email/username and password',
        inputSchema: {
          collection: z.string().describe('Auth collection name (e.g., users)'),
          identity: z.string().describe('Email or username'),
          password: z.string().describe('User password')
        }
      },
      async ({ collection, identity, password }) => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        try {
          const authData = await this.pb.collection(collection).authWithPassword(identity, password);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                token: authData.token,
                record: authData.record
              }, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to authenticate user: ${error.message}`);
        }
      }
    );

    // File management tools
    this.server.registerTool(
      'list_files',
      {
        title: 'List Files',
        description: 'List files associated with a record',
        inputSchema: {
          collection: z.string().describe('Collection name'),
          recordId: z.string().describe('Record ID'),
          fieldName: z.string().describe('File field name')
        }
      },
      async ({ collection, recordId, fieldName }) => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        try {
          const record = await this.pb.collection(collection).getOne(recordId);
          const files = record[fieldName] || [];
          
          const fileUrls = files.map((filename: string) => ({
            filename,
            url: this.pb!.files.getUrl(record, filename)
          }));

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(fileUrls, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to list files: ${error.message}`);
        }
      }
    );

    // Real-time subscription tools
    this.server.registerTool(
      'realtime_subscribe',
      {
        title: 'Subscribe to Real-time Updates',
        description: 'Subscribe to real-time updates for a collection',
        inputSchema: {
          collection: z.string().describe('Collection name'),
          recordId: z.string().optional().describe('Specific record ID (optional)'),
          callback: z.string().optional().describe('Callback identifier')
        }
      },
      async ({ collection, recordId, callback }) => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        try {
          const topic = recordId ? `${collection}/${recordId}` : collection;
          
          const unsubscribe = await this.pb.collection(collection).subscribe(recordId || '*', (e: SubscriptionEvent) => {
            console.log(`Real-time update for ${topic}:`, e);
            // In a real implementation, you might want to forward this to the client
          });

          this._realtimeSubscriptions.set(topic, unsubscribe);

          return {
            content: [{
              type: 'text',
              text: `Subscribed to real-time updates for ${topic}`
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to subscribe to real-time updates: ${error.message}`);
        }
      }
    );

    this.server.registerTool(
      'realtime_unsubscribe',
      {
        title: 'Unsubscribe from Real-time Updates',
        description: 'Unsubscribe from real-time updates',
        inputSchema: {
          collection: z.string().describe('Collection name'),
          recordId: z.string().optional().describe('Specific record ID (optional)')
        }
      },
      async ({ collection, recordId }) => {
        const topic = recordId ? `${collection}/${recordId}` : collection;
        const unsubscribe = this._realtimeSubscriptions.get(topic);
        
        if (unsubscribe) {
          unsubscribe();
          this._realtimeSubscriptions.delete(topic);
          return {
            content: [{
              type: 'text',
              text: `Unsubscribed from real-time updates for ${topic}`
            }]
          };
        } else {
          return {
            content: [{
              type: 'text',
              text: `No active subscription found for ${topic}`
            }]
          };
        }
      }
    );

    // Custom headers management
    this.server.registerTool(
      'set_custom_header',
      {
        title: 'Set Custom Header',
        description: 'Set a custom header for PocketBase requests',
        inputSchema: {
          name: z.string().describe('Header name'),
          value: z.string().describe('Header value')
        }
      },
      async ({ name, value }) => {
        this._customHeaders[name] = value;
        
        // Apply to existing PocketBase instance if available
        if (this.pb) {
          this.pb.beforeSend = (url, options) => {
            options.headers = { ...options.headers, ...this._customHeaders };
            return { url, options };
          };
        }

        return {
          content: [{
            type: 'text',
            text: `Custom header ${name} set to: ${value}`
          }]
        };
      }
    );

    this.server.registerTool(
      'list_custom_headers',
      {
        title: 'List Custom Headers',
        description: 'List all custom headers currently set',
        inputSchema: {}
      },
      async () => {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(this._customHeaders, null, 2)
          }]
        };
      }
    );

    // Utility tools
    this.server.registerTool(
      'validate_record',
      {
        title: 'Validate Record',
        description: 'Validate record data against collection schema',
        inputSchema: {
          collection: z.string().describe('Collection name'),
          data: z.record(z.any()).describe('Record data to validate')
        }
      },
      async ({ collection, data }) => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        try {
          // Get collection schema
          const collectionInfo = await this.pb.collections.getOne(collection);
          const schema = collectionInfo.schema;
          
          const validation: Array<{field: string, issue: string}> = [];
          
          // Basic validation against schema
          schema.forEach((field: SchemaField) => {
            const value = data[field.name];
            
            if (field.required && (value === undefined || value === null || value === '')) {
              validation.push({ field: field.name, issue: 'Required field is missing' });
            }
            
            // Add more validation logic based on field type
            if (value !== undefined && value !== null) {
              switch (field.type) {
                case 'email':
                  if (typeof value === 'string' && !value.includes('@')) {
                    validation.push({ field: field.name, issue: 'Invalid email format' });
                  }
                  break;
                case 'number':
                  if (isNaN(Number(value))) {
                    validation.push({ field: field.name, issue: 'Value must be a number' });
                  }
                  break;
                case 'bool':
                  if (typeof value !== 'boolean') {
                    validation.push({ field: field.name, issue: 'Value must be a boolean' });
                  }
                  break;
              }
            }
          });

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                valid: validation.length === 0,
                issues: validation
              }, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to validate record: ${error.message}`);
        }
      }
    );

    // Bulk operations
    this.server.tool(
      'bulk_import',
      {
        description: 'Import multiple records into a collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            records: { type: 'array', items: { type: 'object' }, description: 'Array of record data' },
            skipErrors: { type: 'boolean', description: 'Continue on individual record errors' }
          },
          required: ['collection', 'records']
        }
      },
      async ({ collection, records, skipErrors = false }) => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        const results = [];
        const errors = [];

        for (let i = 0; i < records.length; i++) {
          try {
            const record = await this.pb.collection(collection).create(records[i]);
            results.push({ index: i, success: true, record });
          } catch (error: any) {
            const errorInfo = { index: i, success: false, error: error.message };
            errors.push(errorInfo);
            results.push(errorInfo);
            
            if (!skipErrors) {
              break;
            }
          }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              totalRecords: records.length,
              successful: results.filter(r => r.success).length,
              failed: errors.length,
              results: results.slice(0, 10), // Limit output size
              errors: errors.slice(0, 5) // Limit error output
            }, null, 2)
          }]
        };
      }
    );

    // Add Stripe tools if service is available
    if (this.stripeService) {
      this.setupStripeTools();
    }

    // Add Email tools if service is available
    if (this.emailService) {
      this.setupEmailTools();
    }
  }

  /**
   * Setup Stripe-related tools
   */
  private setupStripeTools(): void {
    if (!this.stripeService) return;

    this.server.registerTool(
      'create_customer',
      {
        title: 'Create Stripe Customer',
        description: 'Create a new customer in Stripe',
        inputSchema: {
          email: z.string().email().describe('Customer email'),
          name: z.string().optional().describe('Customer name'),
          phone: z.string().optional().describe('Customer phone'),
          metadata: z.record(z.string()).optional().describe('Additional metadata')
        }
      },
      async ({ email, name, phone, metadata }) => {
        if (!this.stripeService) {
          throw new Error('Stripe service not initialized');
        }

        try {
          const customer = await this.stripeService.createCustomer({
            email,
            name,
            phone,
            metadata
          });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(customer, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to create Stripe customer: ${error.message}`);
        }
      }
    );

    this.server.registerTool(
      'get_customer',
      {
        title: 'Get Stripe Customer',
        description: 'Retrieve a customer from Stripe',
        inputSchema: {
          customerId: z.string().describe('Stripe customer ID')
        }
      },
      async ({ customerId }) => {
        if (!this.stripeService) {
          throw new Error('Stripe service not initialized');
        }

        try {
          const customer = await this.stripeService.getCustomer(customerId);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(customer, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to get Stripe customer: ${error.message}`);
        }
      }
    );

    this.server.registerTool(
      'create_payment_intent',
      {
        title: 'Create Payment Intent',
        description: 'Create a payment intent in Stripe',
        inputSchema: {
          amount: z.number().describe('Amount in cents'),
          currency: z.string().default('usd').describe('Currency code'),
          customerId: z.string().optional().describe('Stripe customer ID'),
          metadata: z.record(z.string()).optional().describe('Additional metadata')
        }
      },
      async ({ amount, currency, customerId, metadata }) => {
        if (!this.stripeService) {
          throw new Error('Stripe service not initialized');
        }

        try {
          const paymentIntent = await this.stripeService.createPaymentIntent({
            amount,
            currency,
            customer: customerId,
            metadata
          });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(paymentIntent, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to create payment intent: ${error.message}`);
        }
      }
    );
  }

  /**
   * Setup Email-related tools
   */
  private setupEmailTools(): void {
    if (!this.emailService) return;

    this.server.registerTool(
      'send_email',
      {
        title: 'Send Email',
        description: 'Send an email using the configured email service',
        inputSchema: {
          to: z.string().email().describe('Recipient email address'),
          subject: z.string().describe('Email subject'),
          text: z.string().optional().describe('Plain text content'),
          html: z.string().optional().describe('HTML content'),
          from: z.string().email().optional().describe('Sender email (optional)')
        }
      },
      async ({ to, subject, text, html, from }) => {
        if (!this.emailService) {
          throw new Error('Email service not initialized');
        }

        try {
          const result = await this.emailService.sendEmail({
            to,
            subject,
            text,
            html,
            from
          });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(result, null, 2)
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
    // Collection schemas resource
    this.server.resource(
      'collection_schema',
      'pocketbase://collections/{collection}/schema',
      {
        description: 'Get the schema definition for a PocketBase collection'
      },
      async (uri: any, { collection }: any) => {
        await this.ensureInitialized();
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        try {
          const collectionInfo = await this.pb.collections.getOne(collection);
          return {
            contents: [{
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(collectionInfo.schema, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to get collection schema: ${error.message}`);
        }
      }
    );

    // Database stats resource
    this.server.resource(
      'database_stats',
      'pocketbase://stats',
      {
        description: 'Get database statistics and metrics'
      },
      async (uri: any) => {
        await this.ensureInitialized();
        if (!this.pb) {
          return {
            contents: [{
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({ error: 'PocketBase not initialized' }, null, 2)
            }]
          };
        }

        try {
          const collections = await this.pb.collections.getFullList();
          const stats = {
            totalCollections: collections.length,
            authCollections: collections.filter(c => c.type === 'auth').length,
            baseCollections: collections.filter(c => c.type === 'base').length,
            viewCollections: collections.filter(c => c.type === 'view').length,
            systemCollections: collections.filter(c => c.system).length,
            lastUpdated: new Date().toISOString()
          };

          return {
            contents: [{
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify(stats, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            contents: [{
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({ error: error.message }, null, 2)
            }]
          };
        }
      }
    );

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
          initialization: this.initializationState,
          services: {
            pocketbase: Boolean(this.pb),
            stripe: Boolean(this.stripeService),
            email: Boolean(this.emailService)
          },
          configuration: {
            hasConfig: Boolean(this.configuration),
            pocketbaseUrl: this.configuration?.pocketbaseUrl || 'Not set',
            adminConfigured: Boolean(this.configuration?.adminEmail),
            stripeConfigured: Boolean(this.configuration?.stripeSecretKey),
            emailConfigured: Boolean(this.configuration?.emailService || this.configuration?.smtpHost)
          },
          realtimeSubscriptions: Array.from(this._realtimeSubscriptions.keys()),
          customHeaders: Object.keys(this._customHeaders)
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
              text: `I'll help you set up a new ${type} collection named "${name}". 

For a ${type} collection, you'll typically need:

${type === 'auth' 
  ? `- email field (required for authentication)
- username field (optional but recommended)  
- name field (for display purposes)
- avatar field (for profile pictures)`
  : type === 'base'
  ? `- id field (automatically created)
- created field (automatically created)
- updated field (automatically created)
- Add your custom fields based on your needs`
  : `- Based on existing collections/tables
- Define the SQL query for the view
- Specify which collections it depends on`
}

Would you like me to create this collection with a basic schema, or do you want to specify custom fields?`
            }
          }]
        };
      }
    );

    this.server.prompt(
      'troubleshoot_error',
      'Help troubleshoot common PocketBase errors',
      (extra: any) => {
        const error = extra.arguments?.error || 'Unknown error';
        const operation = extra.arguments?.operation || undefined;
        
        return {
          messages: [{
            role: 'assistant',
            content: {
              type: 'text',
              text: `I'll help you troubleshoot this PocketBase error:

**Error**: ${error}
${operation ? `**Operation**: ${operation}` : ''}

Let me provide some common solutions and debugging steps:

1. **Check Configuration**: Ensure your PocketBase URL and credentials are correct
2. **Verify Permissions**: Make sure you have the necessary permissions for the operation
3. **Validate Data**: Check that your data matches the collection schema
4. **Network Issues**: Verify that PocketBase server is accessible
5. **Authentication**: Ensure you're properly authenticated if required

Would you like me to run a health check or validate your current configuration?`
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
    // Unsubscribe from all real-time subscriptions
    for (const unsubscribe of this._realtimeSubscriptions.values()) {
      try {
        unsubscribe();
      } catch (error) {
        console.warn('Error unsubscribing:', error);
      }
    }
    this._realtimeSubscriptions.clear();

    // Close PocketBase connection if needed
    if (this.pb) {
      // PocketBase doesn't have explicit close method, but we can clear auth
      try {
        this.pb.authStore.clear();
      } catch (error) {
        console.warn('Error clearing auth store:', error);
      }
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
  let transport: any;

  // Parse command line arguments
  const transportType = args.find(arg => arg.startsWith('--transport='))?.split('=')[1] || 'stdio';
  const port = parseInt(args.find(arg => arg.startsWith('--port='))?.split('=')[1] || '3000');
  const host = args.find(arg => arg.startsWith('--host='))?.split('=')[1] || 'localhost';

  // Create agent instance
  const agent = createAgent();

  // Initialize agent with environment configuration
  await agent.init();

  // Set up transport based on command line arguments
  switch (transportType) {
    case 'stdio':
      transport = new StdioServerTransport();
      console.error('Server running on stdio transport');
      break;
      
    case 'sse':
      // Note: SSE transport setup may need adjustment based on current SDK version
      console.error('SSE transport not properly implemented in this version');
      process.exit(1);
      break;
      
    case 'http':
      // Note: HTTP transport may not be available in current SDK version
      console.error('HTTP transport not implemented in this version');
      process.exit(1);
      break;

    default:
      console.error(`Unknown transport type: ${transportType}`);
      process.exit(1);
  }

  // Connect agent to transport
  await agent.connect(transport);
}

// For Cloudflare Workers / Durable Objects export
export { PocketBaseMCPAgent };

// For traditional deployment
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Server failed to start:', error);
    process.exit(1);
  });
}
