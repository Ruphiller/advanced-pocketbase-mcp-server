/**
 * PocketBase MCP Server using Cloudflare's official McpAgent
 * 
 * This implementation uses the official Cloudflare Agents SDK McpAgent class
 * which provides built-in Durable Object state management, hibernation,
 * and authentication support.
 */

import { Agent } from "agents";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import PocketBase from 'pocketbase';
import { StripeService } from './services/stripe.js';
import { EmailService } from './services/email.js';

// Environment interface
interface Env {
  POCKETBASE_URL?: string;
  POCKETBASE_ADMIN_EMAIL?: string;
  POCKETBASE_ADMIN_PASSWORD?: string;
  STRIPE_SECRET_KEY?: string;
  SENDGRID_API_KEY?: string;
  EMAIL_SERVICE?: string;
  SMTP_HOST?: string;
}

// Agent state interface
interface State {
  pocketbaseInitialized: boolean;
  isAuthenticated: boolean;
  discoveryMode: boolean;
  customHeaders: Record<string, string>;
  realtimeSubscriptions: string[];
  lastActivityTime: number;
}

/**
 * PocketBase MCP Agent using Cloudflare's official McpAgent class
 */
export class PocketBaseMCPAgent extends Agent<Env, State> {
  server = new McpServer({
    name: "pocketbase-server",
    version: "0.1.0",
  });

  // Initial state
  initialState: State = {
    pocketbaseInitialized: false,
    isAuthenticated: false,
    discoveryMode: false,
    customHeaders: {},
    realtimeSubscriptions: [],
    lastActivityTime: Date.now()
  };

  // Private instances
  private pb?: PocketBase;
  private stripeService?: StripeService;
  private emailService?: EmailService;
  private realtimeUnsubscribers: Map<string, () => void> = new Map();

  /**
   * Initialize the MCP agent
   */
  async init() {
    console.log('Initializing PocketBase MCP Agent...');
    
    // Update last activity time
    this.setState({
      ...this.state,
      lastActivityTime: Date.now()
    });

    // Setup tools first (for fast discovery)
    this.setupDiscoveryTools();
    this.setupPocketBaseTools();
    this.setupUtilityTools();

    // Setup resources
    this.setupResources();

    // Setup prompts
    this.setupPrompts();

    // Initialize PocketBase if URL is provided
    await this.initializePocketBase();

    // Initialize additional services
    await this.initializeServices();

    console.log('PocketBase MCP Agent initialized successfully');
  }

  /**
   * Handle state updates
   */
  onStateUpdate(state: State) {
    console.log('State updated:', {
      pocketbaseInitialized: state.pocketbaseInitialized,
      isAuthenticated: state.isAuthenticated,
      discoveryMode: state.discoveryMode,
      subscriptions: state.realtimeSubscriptions.length
    });
  }

  /**
   * Initialize PocketBase connection
   */
  private async initializePocketBase(): Promise<void> {
    const pocketbaseUrl = this.env.POCKETBASE_URL;
    
    if (!pocketbaseUrl) {
      console.log('No PocketBase URL provided, running in discovery mode');
      this.setState({
        ...this.state,
        discoveryMode: true
      });
      return;
    }

    try {
      console.log(`Connecting to PocketBase at ${pocketbaseUrl}...`);
      
      this.pb = new PocketBase(pocketbaseUrl);

      // Apply custom headers
      if (Object.keys(this.state.customHeaders).length > 0) {
        this.pb.beforeSend = (url, options) => {
          options.headers = { ...options.headers, ...this.state.customHeaders };
          return { url, options };
        };
      }

      // Test connection
      await this.pb.health.check();
      console.log('PocketBase health check passed');

      // Authenticate if credentials provided
      const adminEmail = this.env.POCKETBASE_ADMIN_EMAIL;
      const adminPassword = this.env.POCKETBASE_ADMIN_PASSWORD;

      if (adminEmail && adminPassword) {
        try {
          await (this.pb as any).admins.authWithPassword(adminEmail, adminPassword);
          console.log('Admin authentication successful');
          
          this.setState({
            ...this.state,
            pocketbaseInitialized: true,
            isAuthenticated: true
          });
        } catch (error: any) {
          console.warn(`Admin authentication failed: ${error.message}`);
          this.setState({
            ...this.state,
            pocketbaseInitialized: true,
            isAuthenticated: false
          });
        }
      } else {
        this.setState({
          ...this.state,
          pocketbaseInitialized: true
        });
      }

    } catch (error: any) {
      console.error('PocketBase initialization failed:', error.message);
      this.setState({
        ...this.state,
        discoveryMode: true
      });
    }
  }

  /**
   * Initialize additional services
   */
  private async initializeServices(): Promise<void> {
    if (!this.pb) return;

    // Initialize Stripe service
    if (this.env.STRIPE_SECRET_KEY) {
      try {
        this.stripeService = new StripeService(this.pb);
        this.setupStripeTools();
        console.log('Stripe service initialized');
      } catch (error: any) {
        console.warn(`Stripe service initialization failed: ${error.message}`);
      }
    }

    // Initialize Email service
    if (this.env.EMAIL_SERVICE || this.env.SMTP_HOST) {
      try {
        this.emailService = new EmailService(this.pb);
        this.setupEmailTools();
        console.log('Email service initialized');
      } catch (error: any) {
        console.warn(`Email service initialization failed: ${error.message}`);
      }
    }
  }

  /**
   * Setup discovery and health tools (always available)
   */
  private setupDiscoveryTools(): void {
    // Health check tool
    this.server.tool(
      "health_check",
      "Check the health status of the MCP server and PocketBase connection",
      {},
      async () => {
        const status = {
          server: 'healthy',
          timestamp: new Date().toISOString(),
          state: this.state,
          pocketbase: this.pb ? 'connected' : 'not initialized',
          services: {
            stripe: Boolean(this.stripeService),
            email: Boolean(this.emailService)
          }
        };

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(status, null, 2)
          }]
        };
      }
    );

    // Fast discovery tool for Smithery
    this.server.tool(
      "smithery_discovery",
      "Fast discovery endpoint for Smithery tool scanning",
      {},
      async () => {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              server: 'pocketbase-mcp-server',
              version: '0.1.0',
              capabilities: ['pocketbase', 'database', 'realtime', 'auth', 'files'],
              status: 'ready',
              tools: ['health_check', 'list_collections', 'create_record', 'query_records'],
              discoveryTime: '0ms'
            }, null, 2)
          }]
        };
      }
    );

    // Tool discovery
    this.server.tool(
      "discover_tools",
      "List all available tools and their current status",
      {},
      async () => {
        const tools = [
          { name: 'health_check', status: 'available', category: 'system' },
          { name: 'smithery_discovery', status: 'available', category: 'system' },
          { name: 'discover_tools', status: 'available', category: 'system' }
        ];

        // Add PocketBase tools
        if (this.state.pocketbaseInitialized) {
          const pbTools = [
            'list_collections', 'get_collection', 'create_collection',
            'list_records', 'get_record', 'create_record', 'update_record',
            'delete_record', 'query_records', 'authenticate_user'
          ];
          pbTools.forEach(tool => {
            tools.push({ name: tool, status: 'available', category: 'pocketbase' });
          });
        }

        // Add service tools
        if (this.stripeService) {
          ['create_customer', 'create_payment_intent'].forEach(tool => {
            tools.push({ name: tool, status: 'available', category: 'stripe' });
          });
        }

        if (this.emailService) {
          ['send_email'].forEach(tool => {
            tools.push({ name: tool, status: 'available', category: 'email' });
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
  }

  /**
   * Setup PocketBase tools
   */
  private setupPocketBaseTools(): void {
    // List collections
    this.server.tool(
      "list_collections",
      "List all collections in the PocketBase database",
      {},
      async () => {
        if (!this.pb) {
          throw new Error('PocketBase not initialized. Please configure POCKETBASE_URL.');
        }

        const collections = await this.pb.collections.getFullList();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(collections, null, 2)
          }]
        };
      }
    );

    // Get collection
    this.server.tool(
      "get_collection",
      "Get details of a specific collection",
      { nameOrId: z.string().describe('Collection name or ID') },
      async ({ nameOrId }) => {
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        const collection = await this.pb.collections.getOne(nameOrId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(collection, null, 2)
          }]
        };
      }
    );

    // Create collection
    this.server.tool(
      "create_collection",
      "Create a new collection in the database",
      {
        name: z.string().describe('Collection name'),
        type: z.enum(['base', 'auth', 'view']).describe('Collection type'),
        schema: z.array(z.object({
          name: z.string(),
          type: z.string(),
          required: z.boolean().optional().default(false),
          options: z.record(z.any()).optional()
        })).describe('Collection schema fields')
      },
      async ({ name, type, schema }) => {
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

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
      }
    );

    // List records
    this.server.tool(
      "list_records",
      "List records from a collection with optional filtering and pagination",
      {
        collection: z.string().describe('Collection name'),
        page: z.number().optional().default(1).describe('Page number'),
        perPage: z.number().optional().default(30).describe('Records per page'),
        sort: z.string().optional().describe('Sort order (e.g., "-created")'),
        filter: z.string().optional().describe('Filter expression'),
        expand: z.string().optional().describe('Relations to expand')
      },
      async ({ collection, page, perPage, sort, filter, expand }) => {
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

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
      }
    );

    // Get record
    this.server.tool(
      "get_record",
      "Get a specific record by ID",
      {
        collection: z.string().describe('Collection name'),
        id: z.string().describe('Record ID'),
        expand: z.string().optional().describe('Relations to expand')
      },
      async ({ collection, id, expand }) => {
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        const record = await this.pb.collection(collection).getOne(id, { expand });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(record, null, 2)
          }]
        };
      }
    );

    // Create record
    this.server.tool(
      "create_record",
      "Create a new record in a collection",
      {
        collection: z.string().describe('Collection name'),
        data: z.record(z.any()).describe('Record data')
      },
      async ({ collection, data }) => {
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        const record = await this.pb.collection(collection).create(data);
        
        // Update activity time
        this.setState({
          ...this.state,
          lastActivityTime: Date.now()
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(record, null, 2)
          }]
        };
      }
    );

    // Update record
    this.server.tool(
      "update_record",
      "Update an existing record",
      {
        collection: z.string().describe('Collection name'),
        id: z.string().describe('Record ID'),
        data: z.record(z.any()).describe('Updated record data')
      },
      async ({ collection, id, data }) => {
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        const record = await this.pb.collection(collection).update(id, data);
        
        this.setState({
          ...this.state,
          lastActivityTime: Date.now()
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(record, null, 2)
          }]
        };
      }
    );

    // Delete record
    this.server.tool(
      "delete_record",
      "Delete a record from a collection",
      {
        collection: z.string().describe('Collection name'),
        id: z.string().describe('Record ID')
      },
      async ({ collection, id }) => {
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        await this.pb.collection(collection).delete(id);
        
        this.setState({
          ...this.state,
          lastActivityTime: Date.now()
        });

        return {
          content: [{
            type: 'text',
            text: `Record ${id} deleted successfully from collection ${collection}`
          }]
        };
      }
    );

    // Query records
    this.server.tool(
      "query_records",
      "Perform complex queries on records with advanced filtering",
      {
        collection: z.string().describe('Collection name'),
        filter: z.string().optional().describe('Filter expression'),
        sort: z.string().optional().describe('Sort expression'),
        limit: z.number().optional().describe('Maximum number of records'),
        expand: z.string().optional().describe('Relations to expand')
      },
      async ({ collection, filter, sort, limit, expand }) => {
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

        let records;
        if (limit) {
          records = await this.pb.collection(collection).getList(1, limit, {
            filter, sort, expand
          });
        } else {
          records = await this.pb.collection(collection).getFullList({
            filter, sort, expand
          });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(records, null, 2)
          }]
        };
      }
    );

    // Authenticate user
    this.server.tool(
      "authenticate_user",
      "Authenticate a user with email/username and password",
      {
        collection: z.string().describe('Auth collection name (e.g., users)'),
        identity: z.string().describe('Email or username'),
        password: z.string().describe('User password')
      },
      async ({ collection, identity, password }) => {
        if (!this.pb) {
          throw new Error('PocketBase not initialized');
        }

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
      }
    );
  }

  /**
   * Setup utility tools
   */
  private setupUtilityTools(): void {
    // Set custom header
    this.server.tool(
      "set_custom_header",
      "Set a custom header for PocketBase requests",
      {
        name: z.string().describe('Header name'),
        value: z.string().describe('Header value')
      },
      async ({ name, value }) => {
        const newHeaders = { ...this.state.customHeaders, [name]: value };
        
        this.setState({
          ...this.state,
          customHeaders: newHeaders
        });

        // Apply to existing PocketBase instance
        if (this.pb) {
          this.pb.beforeSend = (url, options) => {
            options.headers = { ...options.headers, ...newHeaders };
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
  }

  /**
   * Setup Stripe tools
   */
  private setupStripeTools(): void {
    if (!this.stripeService) return;

    this.server.tool(
      "create_customer",
      "Create a new customer in Stripe",
      {
        email: z.string().email().describe('Customer email'),
        name: z.string().optional().describe('Customer name'),
        metadata: z.record(z.string()).optional().describe('Additional metadata')
      },
      async ({ email, name, metadata }) => {
        if (!this.stripeService) {
          throw new Error('Stripe service not initialized');
        }

        const customer = await this.stripeService.createCustomer({
          email, name, metadata
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(customer, null, 2)
          }]
        };
      }
    );

    this.server.tool(
      "create_payment_intent",
      "Create a payment intent in Stripe",
      {
        amount: z.number().describe('Amount in cents'),
        currency: z.string().default('usd').describe('Currency code'),
        customerId: z.string().optional().describe('Stripe customer ID'),
        metadata: z.record(z.string()).optional().describe('Additional metadata')
      },
      async ({ amount, currency, customerId, metadata }) => {
        if (!this.stripeService) {
          throw new Error('Stripe service not initialized');
        }

        const paymentIntent = await this.stripeService.createPaymentIntent({
          amount, currency, customerId, metadata
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(paymentIntent, null, 2)
          }]
        };
      }
    );
  }

  /**
   * Setup Email tools
   */
  private setupEmailTools(): void {
    if (!this.emailService) return;

    this.server.tool(
      "send_email",
      "Send an email using the configured email service",
      {
        to: z.string().email().describe('Recipient email address'),
        subject: z.string().describe('Email subject'),
        text: z.string().optional().describe('Plain text content'),
        html: z.string().optional().describe('HTML content'),
        from: z.string().email().optional().describe('Sender email')
      },
      async ({ to, subject, text, html, from }) => {
        if (!this.emailService) {
          throw new Error('Email service not initialized');
        }

        const result = await this.emailService.sendTemplatedEmail({
          template: 'default',
          to,
          from,
          customSubject: subject,
          variables: { content: text || html }
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      }
    );
  }

  /**
   * Setup resources
   */
  private setupResources(): void {
    // Agent status resource
    this.server.resource(
      "agent_status",
      "agent://status",
      async (uri) => {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              state: this.state,
              environment: {
                pocketbaseUrl: Boolean(this.env.POCKETBASE_URL),
                hasAdminAuth: Boolean(this.env.POCKETBASE_ADMIN_EMAIL),
                hasStripe: Boolean(this.env.STRIPE_SECRET_KEY),
                hasEmail: Boolean(this.env.EMAIL_SERVICE || this.env.SMTP_HOST)
              },
              services: {
                pocketbase: Boolean(this.pb),
                stripe: Boolean(this.stripeService),
                email: Boolean(this.emailService)
              },
              timestamp: new Date().toISOString()
            }, null, 2)
          }]
        };
      }
    );

    // Database stats resource (if PocketBase available)
    this.server.resource(
      "database_stats",
      "pocketbase://stats",
      async (uri) => {
        if (!this.pb) {
          return {
            contents: [{
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({
                error: 'PocketBase not initialized',
                message: 'Configure POCKETBASE_URL to access database stats'
              }, null, 2)
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
              text: JSON.stringify({
                error: error.message,
                timestamp: new Date().toISOString()
              }, null, 2)
            }]
          };
        }
      }
    );
  }

  /**
   * Setup prompts
   */
  private setupPrompts(): void {
    // PocketBase setup prompt
    this.server.prompt(
      "pocketbase_setup",
      "Guide for setting up PocketBase MCP server",
      async () => {
        const hasConfig = Boolean(this.env.POCKETBASE_URL);
        
        return {
          description: "Comprehensive guide for configuring the PocketBase MCP server",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: hasConfig 
                  ? `PocketBase MCP Server Configuration Status:

## Current Configuration
- PocketBase URL: ${this.env.POCKETBASE_URL ? '✓ Configured' : '✗ Missing'}
- Admin Authentication: ${this.env.POCKETBASE_ADMIN_EMAIL ? '✓ Configured' : '✗ Missing'}
- Stripe Integration: ${this.env.STRIPE_SECRET_KEY ? '✓ Configured' : '✗ Missing'}
- Email Service: ${this.env.EMAIL_SERVICE || this.env.SMTP_HOST ? '✓ Configured' : '✗ Missing'}

## Available Tools
- PocketBase: Database operations, authentication, file upload
- Stripe: Payment processing, subscription management (if configured)
- Email: Template-based email sending (if configured)
- Utilities: Header management, health checks

## Getting Started
1. Use 'pocketbase_list_collections' to see available collections
2. Use 'pocketbase_auth_admin' to authenticate as admin
3. Use 'pocketbase_create_record' to add data
4. Use 'pocketbase_query_records' to retrieve data

Need help with specific operations? Ask about any PocketBase, Stripe, or email functionality!`
                  : `PocketBase MCP Server Setup Guide:

## Required Environment Variables
- POCKETBASE_URL: Your PocketBase instance URL
- POCKETBASE_ADMIN_EMAIL: Admin user email
- POCKETBASE_ADMIN_PASSWORD: Admin user password

## Optional Integrations
- STRIPE_SECRET_KEY: For payment processing
- EMAIL_SERVICE: 'sendgrid' or 'smtp'
- SENDGRID_API_KEY: If using SendGrid
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD: If using SMTP

## Quick Start
1. Deploy a PocketBase instance
2. Set the environment variables
3. Restart the MCP server
4. Use 'pocketbase_list_collections' to verify connection

The server will automatically initialize once properly configured!`
              }
            }
          ]
        };
      }
    );

    // Database schema prompt
    this.server.prompt(
      "database_schema_design",
      "Help design PocketBase database schema",
      async () => {
        return {
          description: "Database schema design assistance for PocketBase",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Database Schema Design Guide:

## PocketBase Collections Best Practices

### Auth Collections (Users)
- Built-in user management with email/password
- Custom fields: profile data, preferences, roles
- Automatic email verification and password reset

### Base Collections (Data)
- Use clear, descriptive names (posts, products, orders)
- Add proper relations between collections
- Include created/updated timestamps
- Use appropriate field types (text, number, date, file, relation)

### View Collections (Virtual)
- Aggregate data from multiple collections
- Read-only computed views
- Useful for reporting and analytics

## Common Patterns
1. **User Profiles**: Extend auth collection with custom fields
2. **Content Management**: Posts/Articles with categories and tags
3. **E-commerce**: Products, Orders, Customers with Stripe integration
4. **File Management**: Use PocketBase's built-in file fields
5. **Multi-tenant**: Use relation fields to separate data by organization

## Schema Design Questions:
1. What type of data will you store?
2. How do users relate to your data?
3. What are the main relationships between entities?
4. Do you need file uploads?
5. Will you integrate with external services (Stripe, email)?

Describe your project needs and I'll help design the optimal schema!`
              }
            }
          ]
        };
      }
    );
  }
}

// Export for Cloudflare Workers
export default PocketBaseMCPAgent;
