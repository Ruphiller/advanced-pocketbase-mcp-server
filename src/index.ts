#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

// Extend PocketBase types
interface ExtendedPocketBase extends PocketBase {
  baseUrl: string;
  authStore: { // Restore explicit authStore definition
    isValid: boolean;
    token: string;
    model: any;
    save(token: string, model: any): void;
    clear(): void;
    exportToCookie(options?: any): string;
    loadFromCookie(cookie: string): void;
  };
  admins: any; // Add admins collection service type (using 'any' for simplicity)
  collections: {
    getList(page?: number, perPage?: number, options?: any): Promise<any>;
    getOne(id: string): Promise<any>;
    create(data: any): Promise<any>;
    update(id: string, data: any): Promise<any>;
    delete(id: string): Promise<any>;
  };
  filter(expr: string, params: Record<string, any>): string;
  autoCancellation(enable: boolean): void;
  cancelRequest(key: string): void;
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


class PocketBaseServer {
  private server: McpServer;
  private pb: ExtendedPocketBase;
  private _customHeaders: Record<string, string> = {};
  private stripeService?: StripeService;
  private emailService?: EmailService;

  constructor() {
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

    // Initialize PocketBase client
    const url = process.env.POCKETBASE_URL;
    if (!url) {
      throw new Error('POCKETBASE_URL environment variable is required');
    }
    this.pb = new PocketBase(url) as unknown as ExtendedPocketBase;

    // Initialize services if environment variables are present
    if (process.env.STRIPE_SECRET_KEY) {
      try {
        this.stripeService = new StripeService(this.pb);
        console.log('Stripe service initialized');
      } catch (error) {
        console.warn('Stripe service initialization failed:', error);
      }
    }

    if (process.env.EMAIL_SERVICE || process.env.SMTP_HOST) {
      try {
        this.emailService = new EmailService(this.pb);
        console.log('Email service initialized');
      } catch (error) {
        console.warn('Email service initialization failed:', error);
      }
    }

    this.setupTools();
    this.setupResources();
    this.setupPrompts();

    // Error handling
    process.on('SIGINT', async () => {
      process.exit(0);
    });
  }

  private setupPrompts() {
    // Collection creation prompt
    this.server.prompt(
      "create-collection",
      "Create a new collection with specified fields",
      async (extra: RequestHandlerExtra) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Create a new collection with specified fields`
          }
        }]
      })
    );

    // Record creation prompt
    this.server.prompt(
      "create-record",
      "Create a new record in a collection",
      async (extra: RequestHandlerExtra) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Create a new record in a collection`
          }
        }]
      })
    );

    // Query builder prompt
    this.server.prompt(
      "build-query",
      "Build a query for a collection with filters, sorting, and expansion",
      async (extra: RequestHandlerExtra) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Build a query for a collection with filters, sorting, and expansion`
          }
        }]
      })
    );
  }

  private setupResources() {
    interface CollectionInfo {
      id: string;
      name: string;
      type: string;
      system: boolean;
      listRule: string | null;
      viewRule: string | null;
      createRule: string | null;
      updateRule: string | null;
      deleteRule: string | null;
    }

    interface CollectionRecord {
      id: string;
      [key: string]: any;
    }

    // Server info resource
    this.server.resource(
      "server-info",
      "pocketbase://info",
      async (uri) => {
        try {
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify({
                url: this.pb.baseUrl,
                isAuthenticated: this.pb.authStore?.isValid || false
              }, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to get server info: ${error.message}`);
        }
      }
    );

    // Collection schema resource
    this.server.resource(
      "collection-schema",
      new ResourceTemplate("pocketbase://collections/{name}/schema", { list: undefined }),
      async (uri, params) => {
        const name = typeof params.name === 'string' ? params.name : params.name[0];
        try {
          const collection = await this.pb.collections.getOne(name);
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(collection.schema, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to get collection schema: ${error.message}`);
        }
      }
    );

    // Collection list resource
    this.server.resource(
      "collections",
      "pocketbase://collections",
      async (uri) => {
        try {
          const collectionsResponse = await this.pb.collections.getList(1, 100);
          const collections = {
            page: collectionsResponse.page,
            perPage: collectionsResponse.perPage,
            totalItems: collectionsResponse.totalItems,
            totalPages: collectionsResponse.totalPages,
            items: collectionsResponse.items as unknown as CollectionModel[]
          };
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(collections.items.map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                system: c.system,
                listRule: c.listRule,
                viewRule: c.viewRule,
                createRule: c.createRule,
                updateRule: c.updateRule,
                deleteRule: c.deleteRule,
              })), null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to list collections: ${error.message}`);
        }
      }
    );

    // Record resource
    this.server.resource(
      "record",
      new ResourceTemplate("pocketbase://collections/{collection}/records/{id}", { list: undefined }),
      async (uri, params) => {
        const collection = typeof params.collection === 'string' ? params.collection : params.collection[0];
        const id = typeof params.id === 'string' ? params.id : params.id[0];
        try {
          // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
          const record = await this.pb.collection(collection).getOne(id) as RecordModel;
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(record, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to get record: ${error.message}`);
        }
      }
    );

    // Auth info resource
    this.server.resource(
      "auth-info",
      "pocketbase://auth",
      async (uri) => {
        try {
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify({
                isValid: this.pb.authStore.isValid,
                token: this.pb.authStore.token,
                model: this.pb.authStore.model
              }, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to get auth info: ${error.message}`);
        }
      }
    );
  }

  private setupTools() {
    console.error('[MCP DEBUG] Setting up tools...');
    
    // Simple test tool
    const testTool = this.server.tool(
      'test_tool',
      {},
      async () => {
        console.error('[MCP DEBUG] test_tool called');
        return {
          content: [{ type: 'text', text: 'Test tool works!' }]
        };
      }
    );
    
    console.error('[MCP DEBUG] After registering test_tool');
    
    // Try to access tools through the server's API
    try {
      // @ts-ignore - Using internal API for debugging
      const toolNames = this.server._tools ? Object.keys(this.server._tools) : [];
      console.error(`[MCP DEBUG] Tools through API: ${JSON.stringify(toolNames)}`);
    } catch (error) {
      console.error(`[MCP DEBUG] Error accessing tools through API: ${error}`);
    }
    
    // Diagnostic tool to list all registered tool names
    this.server.tool(
      'list_registered_tools',
      {},
      async () => {
        console.error('[MCP DEBUG] list_registered_tools called');
        // @ts-ignore
        const toolNames = Object.keys(this.server._tools || {});
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(toolNames, null, 2)
          }]
        };
      }
    );

    // Server info tool
    this.server.tool(
      'get_server_info',
      {},
      async () => {
        try {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                url: this.pb.baseUrl,
                isAuthenticated: this.pb.authStore?.isValid || false,
                version: '0.1.0'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to get server info: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Auth info tool
    this.server.tool(
      'get_auth_info',
      {},
      async () => {
        try {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                isValid: this.pb.authStore.isValid,
                token: this.pb.authStore.token,
                model: this.pb.authStore.model,
                isAdmin: this.pb.authStore.model?.collectionName === '_superusers'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to get auth info: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // New tool to list all collections
    this.server.tool(
      'list_collections',
      {
        includeSystem: z.boolean().optional().default(false).describe('Whether to include system collections')
      },
      async ({ includeSystem }) => {
        try {
          // Try to get collections without authentication first
          try {
            const collections = await this.pb.collections.getList(1, 100);
            const filteredCollections = includeSystem
              ? collections.items
              : collections.items.filter((c: any) => !c.system);

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(filteredCollections.map((c: any) => ({
                  id: c.id,
                  name: c.name,
                  type: c.type,
                  system: c.system,
                  recordCount: c.recordCount || 0
                })), null, 2)
              }]
            };
          } catch (error: any) {
            // If authentication is required, try to discover collections by testing common ones
            // and by checking which ones are accessible
            const commonCollections = ['users', 'products', 'posts', 'categories', 'orders', 'customers', 'items', 'files'];
            const discoveredCollections = [];

            for (const collectionName of commonCollections) {
              try {
                // Try to list records in this collection
                const result = await this.pb.collection(collectionName).getList(1, 1);
                discoveredCollections.push({
                  name: collectionName,
                  recordCount: result.totalItems
                });
              } catch (e) {
                // Skip collections that don't exist or require authentication
              }
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(discoveredCollections, null, 2)
              }]
            };
          }
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to list collections: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Record management tools
    this.server.tool(
      'create_record',
      {
        collection: z.string().describe('Collection name'),
        data: z.record(z.any()).describe('Record data')
      },
      async ({ collection, data }) => {
        try {
          const result = await this.pb.collection(collection).create(data);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create record: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Collection management tools
    this.server.tool(
      'create_collection',
      {
        name: z.string().describe('Collection name'),
        schema: z.array(z.object({
          name: z.string(),
          type: z.string(),
          required: z.boolean().optional(),
          options: z.record(z.any()).optional()
        })).describe('Collection schema')
      },
      async ({ name, schema }) => {
        console.error(`[MCP DEBUG] create_collection called with:`, { name, schema });

        if (!this.pb.authStore.isValid || this.pb.authStore.model?.collectionName !== '_superusers') {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ error: 'Admin authentication required. Use authenticate_user with isAdmin: true.' }, null, 2)
            }],
            isError: true
          };
        }

        try {
          // Validate schema
          if (!Array.isArray(schema) || schema.length === 0) {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ error: 'Schema must be a non-empty array of field definitions' }, null, 2)
              }],
              isError: true
            };
          }

          // Process schema with validation
          const processedSchema = schema.map(field => {
            if (!field.name || !field.type) {
              throw new Error(`Invalid field definition. Both 'name' and 'type' are required.`);
            }

            // Validate field name format
            if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field.name)) {
              throw new Error(`Invalid field name '${field.name}'. Must start with a letter and contain only letters, numbers, and underscores.`);
            }

            // Validate field type
            const validTypes = ['text', 'number', 'bool', 'email', 'url', 'date', 'select', 'json', 'file', 'relation'];
            if (!validTypes.includes(field.type)) {
              throw new Error(`Invalid field type '${field.type}'. Must be one of: ${validTypes.join(', ')}`);
            }

            return {
              name: field.name,
              type: field.type,
              required: field.required ?? false,
              options: field.options ?? {}
            };
          });

          console.error('[MCP DEBUG] Creating collection with schema:', JSON.stringify(processedSchema, null, 2));

          // Create the collection with schema according to PocketBase JS SDK documentation
          try {
            // Based on the PocketBase JS SDK documentation, the correct format is:
            const payload = {
              name,
              type: "base",
              system: false,
              schema: processedSchema
            };
            
            console.error('[MCP DEBUG] Sending payload to PocketBase:', JSON.stringify(payload, null, 2));
            
            // Use the collections.create method as shown in the documentation
            const result = await this.pb.collections.create(payload);
            
            console.error('[MCP DEBUG] Collection created successfully:', JSON.stringify(result, null, 2));
            
            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
            };
          } catch (error: any) {
            console.error('[MCP DEBUG] Error creating collection:', error);
            
            // Try an alternative approach if the first one fails
            try {
              // Some versions of PocketBase might require a different format
              const alternativePayload = {
                id: "",
                created: "",
                updated: "",
                name,
                type: "base",
                system: false,
                schema: processedSchema
              };
              
              console.error('[MCP DEBUG] Trying alternative payload:', JSON.stringify(alternativePayload, null, 2));
              
              const result = await this.pb.collections.create(alternativePayload);
              
              console.error('[MCP DEBUG] Collection created with alternative payload:', JSON.stringify(result, null, 2));
              
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify(result, null, 2)
                }]
              };
            } catch (altError: any) {
              console.error('[MCP DEBUG] Alternative approach also failed:', altError);
              throw new Error(`Failed to create collection: ${error.message}. Alternative approach also failed: ${altError.message}`);
            }
          }
        } catch (error: any) {
          console.error('[MCP DEBUG] create_collection error:', error);
          
          const errorDetails = {
            message: error.message,
            data: error.data,
            status: error.status,
            response: error.response?.data
          };

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ error: 'Failed to create collection', details: errorDetails }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'list_records',
      {
        collection: z.string().describe('Collection name'),
        filter: z.string().optional().describe('Filter query'),
        sort: z.string().optional().describe('Sort field and direction'),
        page: z.number().optional().describe('Page number'),
        perPage: z.number().optional().describe('Items per page')
      },
      async ({ collection, filter, sort, page = 1, perPage = 50 }) => {
        try {
          const options: any = {};
          if (filter) options.filter = filter;
          if (sort) options.sort = sort;

          const result = await this.pb.collection(collection).getList(page, perPage, options);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to list records: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'update_record',
      {
        collection: z.string().describe('Collection name'),
        id: z.string().describe('Record ID'),
        data: z.record(z.any()).describe('Updated record data')
      },
      async ({ collection, id, data }) => {
        try {
          const result = await this.pb.collection(collection).update(id, data);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to update record: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'delete_record',
      {
        collection: z.string().describe('Collection name'),
        id: z.string().describe('Record ID')
      },
      async ({ collection, id }) => {
        try {
          await this.pb.collection(collection).delete(id);
          return {
            content: [{ type: 'text', text: `Successfully deleted record ${id} from collection ${collection}` }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to delete record: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Authentication tools
    this.server.tool(
      'authenticate_user',
      {
        // Make email and password optional to allow using env vars when isAdmin is true
        email: z.string().optional().describe('User email (required unless isAdmin=true and env vars are set)'),
        password: z.string().optional().describe('User password (required unless isAdmin=true and env vars are set)'),
        collection: z.string().optional().default('users').describe('Collection name'),
        isAdmin: z.boolean().optional().default(false).describe('Whether to authenticate as an admin')
      },
      async ({ email, password, collection, isAdmin }) => {
        try {
          const authCollection = isAdmin ? '_superusers' : collection;
          const authEmail = isAdmin && !email ? process.env.POCKETBASE_ADMIN_EMAIL : email;
          const authPassword = isAdmin && !password ? process.env.POCKETBASE_ADMIN_PASSWORD : password;

          if (!authEmail || !authPassword) {
            return {
              content: [{ type: 'text', text: 'Email and password are required for authentication' }],
              isError: true
            };
          }

          const authData = await this.pb
            .collection(authCollection)
            .authWithPassword(authEmail, authPassword);

          return {
            content: [{ type: 'text', text: JSON.stringify(authData, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Authentication failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'authenticate_with_oauth2',
      {
        provider: z.string().describe('OAuth2 provider name'),
        code: z.string().describe('Authorization code'),
        codeVerifier: z.string().describe('PKCE code verifier'),
        redirectUrl: z.string().describe('Redirect URL'),
        collection: z.string().optional().default('users').describe('Collection name')
      },
      async ({ provider, code, codeVerifier, redirectUrl, collection }) => {
        try {
          const authData = await this.pb
            .collection(collection)
            .authWithOAuth2(provider, code, codeVerifier, redirectUrl);

          return {
            content: [{ type: 'text', text: JSON.stringify(authData, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `OAuth2 authentication failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'authenticate_with_otp',
      {
        email: z.string().describe('User email'),
        collection: z.string().optional().default('users').describe('Collection name')
      },
      async ({ email, collection }) => {
        try {
          const result = await this.pb.collection(collection).authWithOtp(email);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: result }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `OTP authentication failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'auth_refresh',
      {
        collection: z.string().optional().default('users').describe('Collection name')
      },
      async ({ collection }) => {
        try {
          const authData = await this.pb.collection(collection).authRefresh();
          return {
            content: [{ type: 'text', text: JSON.stringify(authData, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Auth refresh failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Email verification tools
    this.server.tool(
      'request_verification',
      {
        email: z.string().describe('User email'),
        collection: z.string().optional().default('users').describe('Collection name')
      },
      async ({ email, collection }) => {
        try {
          const result = await this.pb.collection(collection).requestVerification(email);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: result }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Verification request failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'confirm_verification',
      {
        token: z.string().describe('Verification token'),
        collection: z.string().optional().default('users').describe('Collection name')
      },
      async ({ token, collection }) => {
        try {
          const result = await this.pb.collection(collection).confirmVerification(token);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: result }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Verification confirmation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Password reset tools
    this.server.tool(
      'request_password_reset',
      {
        email: z.string().describe('User email'),
        collection: z.string().optional().default('users').describe('Collection name')
      },
      async ({ email, collection }) => {
        try {
          const result = await this.pb.collection(collection).requestPasswordReset(email);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: result }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Password reset request failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'confirm_password_reset',
      {
        token: z.string().describe('Reset token'),
        password: z.string().describe('New password'),
        passwordConfirm: z.string().describe('Confirm new password'),
        collection: z.string().optional().default('users').describe('Collection name')
      },
      async ({ token, password, passwordConfirm, collection }) => {
        try {
          const result = await this.pb.collection(collection).confirmPasswordReset(token, password, passwordConfirm);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: result }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Password reset confirmation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Email change tools
    this.server.tool(
      'request_email_change',
      {
        newEmail: z.string().describe('New email address'),
        collection: z.string().optional().default('users').describe('Collection name')
      },
      async ({ newEmail, collection }) => {
        try {
          const result = await this.pb.collection(collection).requestEmailChange(newEmail);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: result }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Email change request failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'confirm_email_change',
      {
        token: z.string().describe('Email change token'),
        password: z.string().describe('Current password for confirmation'),
        collection: z.string().optional().default('users').describe('Collection name')
      },
      async ({ token, password, collection }) => {
        try {
          const authData = await this.pb.collection(collection).confirmEmailChange(token, password);
          return {
            content: [{ type: 'text', text: JSON.stringify(authData, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Email change confirmation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // User management tools
    this.server.tool(
      'impersonate_user',
      {
        userId: z.string().describe('ID of the user to impersonate'),
        collection: z.string().optional().default('users').describe('Collection name')
      },
      async ({ userId, collection }) => {
        try {
          const authData = await this.pb.collection(collection).impersonate(userId);
          return {
            content: [{ type: 'text', text: JSON.stringify(authData, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `User impersonation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'create_user',
      {
        email: z.string().describe('User email'),
        password: z.string().describe('User password'),
        passwordConfirm: z.string().describe('Password confirmation'),
        name: z.string().optional().describe('User name'),
        collection: z.string().optional().default('users').describe('Collection name')
      },
      async ({ email, password, passwordConfirm, name, collection }) => {
        try {
          const result = await this.pb.collection(collection).create({
            email,
            password,
            passwordConfirm,
            name,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create user: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Record tools
    this.server.tool(
      'get_record',
      {
        collection: z.string().describe('Collection name'),
        id: z.string().describe('Record ID'),
        expand: z.string().optional().describe('Relations to expand')
      },
      async ({ collection, id, expand }) => {
        try {
          const options: any = {};
          if (expand) options.expand = expand;

          // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
          const record = await this.pb.collection(collection).getOne(id, options);
          return {
            content: [{ type: 'text', text: JSON.stringify(record, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to get record: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Tool to set collection access rules
    this.server.tool(
      'set_collection_rules',
      {
        collection: z.string().describe('Collection name or ID'),
        listRule: z.string().nullable().optional().describe('List rule (PocketBase filter syntax or null)'),
        viewRule: z.string().nullable().optional().describe('View rule (PocketBase filter syntax or null)'),
        createRule: z.string().nullable().optional().describe('Create rule (PocketBase filter syntax or null)'),
        updateRule: z.string().nullable().optional().describe('Update rule (PocketBase filter syntax or null)'),
        deleteRule: z.string().nullable().optional().describe('Delete rule (PocketBase filter syntax or null)')
      },
      async ({ collection, listRule, viewRule, createRule, updateRule, deleteRule }) => {
        try {
          // Construct the update payload, only including rules that were provided
          const payload: Record<string, string | null> = {};
          if (listRule !== undefined) payload.listRule = listRule;
          if (viewRule !== undefined) payload.viewRule = viewRule;
          if (createRule !== undefined) payload.createRule = createRule;
          if (updateRule !== undefined) payload.updateRule = updateRule;
          if (deleteRule !== undefined) payload.deleteRule = deleteRule;

          if (Object.keys(payload).length === 0) {
             return {
               content: [{ type: 'text', text: 'No rules provided to update.' }],
               isError: true
             };
          }

          // Updating rules typically requires admin privileges
          const result = await this.pb.collections.update(collection, payload);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          // Catch permission errors or other issues
          return {
            content: [{ type: 'text', text: `Failed to set collection rules: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Tool to update collection schema (add/remove/update fields)
    const updateCollectionSchemaTool = this.server.tool(
      'update_collection_schema',
      {
        collection: z.string().describe('Collection name or ID'),
        addFields: z.array(z.object({
          name: z.string(),
          type: z.string(),
          required: z.boolean().optional().default(false),
          options: z.record(z.any()).optional()
        })).optional().describe('Fields to add'),
        removeFields: z.array(z.string()).optional().describe('Names of fields to remove'),
        updateFields: z.array(z.object({
          name: z.string().describe('Name of the field to update'),
          newName: z.string().optional().describe('Optional new name for the field'),
          type: z.string().optional().describe('Optional new type'),
          required: z.boolean().optional().describe('Optional new required status'),
          options: z.record(z.any()).optional().describe('Optional new options')
        })).optional().describe('Fields to update')
      },
      async ({ collection, addFields = [], removeFields = [], updateFields = [] }) => {
        try {
          console.error(`[MCP DEBUG] update_collection_schema called with:`, { collection, addFields, removeFields, updateFields });
          
          // Fetch the current collection details including schema
          const currentCollection = await this.pb.collections.getOne(collection);
          let currentSchema = currentCollection.schema || [];
          
          console.error(`[MCP DEBUG] Current schema:`, JSON.stringify(currentSchema, null, 2));

          // Process removals first
          if (removeFields.length > 0) {
            currentSchema = currentSchema.filter((field: any) => !removeFields.includes(field.name));
          }

          // Process updates
          if (updateFields.length > 0) {
            currentSchema = currentSchema.map((field: any) => {
              const updateInfo = updateFields.find(uf => uf.name === field.name);
              if (updateInfo) {
                return {
                  ...field,
                  name: updateInfo.newName ?? field.name, // Update name if provided
                  type: updateInfo.type ?? field.type, // Update type if provided
                  required: updateInfo.required ?? field.required, // Update required status if provided
                  options: updateInfo.options ?? field.options // Update options if provided
                };
              }
              return field;
            });
          }

          // Process additions
          if (addFields.length > 0) {
            // Process add fields to match PocketBase's expected format
            const processedAddFields = addFields.map(field => ({
              name: field.name,
              type: field.type,
              required: field.required ?? false,
              options: field.options ?? {}
            }));
            
            currentSchema = [...currentSchema, ...processedAddFields];
          }

          console.error(`[MCP DEBUG] Updated schema:`, JSON.stringify(currentSchema, null, 2));

          // Update the collection with the modified schema
          const result = await this.pb.collections.update(collection, { schema: currentSchema });
          
          console.error(`[MCP DEBUG] update_collection_schema success:`, JSON.stringify(result, null, 2));
          
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          console.error(`[MCP DEBUG] update_collection_schema error:`, error);
          
          return {
            content: [{ type: 'text', text: `Failed to update collection schema: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Tool to get collection schema (duplicates resource functionality for tool access)
    this.server.tool(
      'get_collection_schema',
      {
        collection: z.string().describe('Collection name or ID')
      },
      async ({ collection }) => {
        try {
          console.error('[MCP DEBUG] get_collection_schema called for collection:', collection);
          
          // First try to get collection directly
          const collectionData = await this.pb.collections.getOne(collection);
          console.error('[MCP DEBUG] Collection data retrieved:', JSON.stringify(collectionData, null, 2));
          
          // In newer PocketBase versions, the schema is in the 'fields' property
          const schema = collectionData.fields || collectionData.schema || [];
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                name: collection,
                id: collectionData.id,
                type: collectionData.type,
                system: collectionData.system,
                schema: schema,
                listRule: collectionData.listRule,
                viewRule: collectionData.viewRule,
                createRule: collectionData.createRule,
                updateRule: collectionData.updateRule,
                deleteRule: collectionData.deleteRule,
                indexes: collectionData.indexes || []
              }, null, 2)
            }]
          };
        } catch (error: any) {
          console.error('[MCP DEBUG] get_collection_schema error:', error);
          
          // If we can't get collection directly, try to infer from records
          try {
            const records = await this.pb.collection(collection).getList(1, 1);
            
            if (records.items.length > 0) {
              const record = records.items[0];
              // Basic inference logic
              const inferredSchema = Object.keys(record)
                .filter(key => !['id', 'created', 'updated', 'collectionId', 'collectionName', 'expand'].includes(key))
                .map(field => ({
                  name: field,
                  type: typeof record[field] === 'object' ? 'json' : typeof record[field],
                  required: false,
                  system: false,
                  options: {}
                }));
              
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    name: collection,
                    schema: inferredSchema,
                    inferredSchema: true,
                    note: "Schema was inferred from record data as collection details were not accessible"
                  }, null, 2)
                }]
              };
            } else {
              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify({
                    name: collection,
                    schema: [],
                    error: "Could not retrieve collection schema and no records found to infer from"
                  }, null, 2)
                }]
              };
            }
          } catch (inferError: any) {
            console.error('[MCP DEBUG] Error inferring schema from records:', inferError);
            
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  name: collection,
                  error: "Failed to get collection schema: " + (error.message || "Unknown error")
                }, null, 2)
              }]
            };
          }
        }
      }
    );

    // Database management tools
    this.server.tool(
      'backup_database',
      {
        format: z.enum(['json', 'csv']).optional().default('json').describe('Export format')
      },
      async ({ format }) => {
        try {
          const collections = await this.pb.collections.getList(1, 100);
          const backup: any = {};

          for (const collection of collections.items) {
            const records = await this.pb.collection(collection.name).getFullList();
            backup[collection.name] = {
              schema: collection.schema,
              records,
            };
          }

          if (format === 'csv') {
            let csv = '';
            for (const [collectionName, data] of Object.entries(backup)) {
              const { schema, records } = data as { schema: any[], records: any[] };
              csv += `Collection: ${collectionName}\n`;
              csv += `Schema:\n${JSON.stringify(schema, null, 2)}\n`;
              csv += 'Records:\n';
              if (records.length > 0) {
                const headers = Object.keys(records[0]);
                csv += headers.join(',') + '\n';
                records.forEach((record) => {
                  csv += headers.map(header => JSON.stringify(record[header])).join(',') + '\n';
                });
              }
              csv += '\n';
            }
            return {
              content: [{ type: 'text', text: csv }]
            };
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(backup, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to backup database: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'import_data',
      {
        collection: z.string().describe('Collection name'),
        data: z.array(z.record(z.any())).describe('Array of records to import'),
        mode: z.enum(['create', 'update', 'upsert']).optional().default('create').describe('Import mode')
      },
      async ({ collection, data, mode }) => {
        try {
          const results = [];
          for (const record of data) {
            let result;
            switch (mode) {
              case 'create':
                result = await this.pb.collection(collection).create(record);
                break;
              case 'update':
                if (!record.id) {
                  throw new Error('Record ID required for update mode');
                }
                result = await this.pb.collection(collection).update(record.id, record);
                break;
              case 'upsert':
                if (record.id) {
                  try {
                    result = await this.pb.collection(collection).update(record.id, record);
                  } catch {
                    result = await this.pb.collection(collection).create(record);
                  }
                } else {
                  result = await this.pb.collection(collection).create(record);
                }
                break;
            }
            results.push(result);
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to import data: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Collection migration tool
    this.server.tool(
      'migrate_collection',
      {
        collection: z.string().describe('Collection name'),
        newSchema: z.array(z.object({
          name: z.string(),
          type: z.string(),
          required: z.boolean().default(false),
          options: z.record(z.any()).optional()
        })).describe('New collection schema'),
        dataTransforms: z.record(z.string()).optional().describe('Field transformation mappings')
      },
      async ({ collection, newSchema, dataTransforms }: {
        collection: string;
        newSchema: { name: string; type: string; required: boolean; options?: Record<string, any> }[];
        dataTransforms?: Record<string, string>;
      }) => {
        try {
          console.error(`[MCP PocketBase WARNING] Executing 'migrate_collection' for '${collection}'. This tool is risky! It deletes the original collection before migration is fully complete. Backup your data first.`);
          const tempName = `${collection}_migration_${Date.now()}`;
          
          // Convert schema to ensure required is always defined
          const processedSchema = newSchema.map(field => ({
            ...field,
            required: field.required === undefined ? false : field.required
          }));

          await this.pb.collections.create({
            name: tempName,
            schema: processedSchema,
          });

          const oldRecords = await this.pb.collection(collection).getFullList();
          const transformedRecords = oldRecords.map(record => {
            const newRecord: any = { ...record };
            if (dataTransforms) {
              for (const [field, transform] of Object.entries(dataTransforms)) {
                try {
                  newRecord[field] = new Function('oldValue', `return ${transform}`)(record[field]);
                } catch (e) {
                  console.error(`Failed to transform field ${field}:`, e);
                }
              }
            }
            return newRecord;
          });

          for (const record of transformedRecords) {
            await this.pb.collection(tempName).create(record);
          }

          // Delete original collection and rename temp
          await this.pb.collections.delete(collection);
          await this.pb.collections.update(tempName, { name: collection });

          return {
            content: [{ type: 'text', text: `Successfully migrated collection '${collection}' to new schema` }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to migrate collection: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Index management tool
    this.server.tool(
      'manage_indexes',
      {
        collection: z.string().describe('Collection name'),
        action: z.enum(['create', 'delete', 'list']).describe('Action to perform'),
        index: z.object({
          name: z.string(),
          fields: z.array(z.string()),
          unique: z.boolean().optional()
        }).optional().describe('Index configuration (for create)')
      },
      async ({ collection, action, index }) => {
        try {
          const collectionObj = await this.pb.collections.getOne(collection);
          const currentIndexes = collectionObj.indexes || [];
          let result;

          switch (action) {
            case 'create':
              if (!index) {
                return {
                  content: [{ type: 'text', text: 'Index configuration required for create action' }],
                  isError: true
                };
              }
              const updatedCollection = await this.pb.collections.update(collectionObj.id, {
                ...collectionObj,
                indexes: [...currentIndexes, index],
              });
              result = updatedCollection.indexes;
              break;

            case 'delete':
              if (!index?.name) {
                return {
                  content: [{ type: 'text', text: 'Index name required for delete action' }],
                  isError: true
                };
              }
              const filteredIndexes = currentIndexes.filter((idx: any) => idx.name !== index.name);
              const collectionAfterDelete = await this.pb.collections.update(collectionObj.id, {
                ...collectionObj,
                indexes: filteredIndexes,
              });
              result = collectionAfterDelete.indexes;
              break;

            case 'list':
              result = currentIndexes;
              break;
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to manage indexes: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // File upload tool
    this.server.tool(
      'upload_file',
      {
        collection: z.string().describe('Collection name'),
        recordId: z.string().optional().describe('Record ID (optional - if not provided, creates new record)'),
        fileData: z.object({
          name: z.string().describe('File name'),
          content: z.string().describe('Base64 encoded file content'),
          type: z.string().optional().describe('File MIME type')
        }).describe('File data in base64 format'),
        additionalFields: z.record(z.any()).optional().describe('Additional record fields')
      },
      async ({ collection, recordId, fileData, additionalFields = {} }) => {
        try {
          const binaryData = Buffer.from(fileData.content, 'base64');
          const blob = new Blob([binaryData], { type: fileData.type || 'application/octet-stream' });

          const formData = new FormData();
          formData.append(fileData.name, blob, fileData.name);

          Object.entries(additionalFields).forEach(([key, value]) => {
            formData.append(key, value as string);
          });

          let result;
          if (recordId) {
            result = await this.pb.collection(collection).update(recordId, formData);
          } else {
            result = await this.pb.collection(collection).create(formData);
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to upload file: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Filter builder tool
    this.server.tool(
      'build_filter',
      {
        expression: z.string().describe('Filter expression with placeholders'),
        params: z.record(z.any()).describe('Parameter values')
      },
      async ({ expression, params }) => {
        try {
          // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
          const filter = this.pb.filter(expression, params);
          return {
            content: [{ type: 'text', text: JSON.stringify({ filter }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to build filter: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Request options tool
    this.server.tool(
      'set_request_options',
      {
        autoCancellation: z.boolean().optional().describe('Enable/disable auto cancellation'),
        requestKey: z.string().nullable().optional().describe('Custom request identifier'),
        headers: z.record(z.string()).optional().describe('Custom headers')
      },
      async ({ autoCancellation, requestKey, headers }) => {
        try {
          if (typeof autoCancellation === 'boolean') {
            // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
            this.pb.autoCancellation(autoCancellation);
          }

          if (requestKey === null) {
            // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
            this.pb.cancelRequest(requestKey);
          }

          if (headers) {
            this._customHeaders = headers;
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to set request options: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Auth store management tool
    this.server.tool(
      'manage_auth_store',
      {
        action: z.enum(['save', 'clear', 'export_cookie', 'load_cookie']).describe('Action to perform'),
        data: z.record(z.any()).optional().describe('Data for the action')
      },
      async ({ action, data = {} }) => {
        try {
          switch (action) {
            case 'save':
              // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
              this.pb.authStore.save(data.token, data.record);
              return {
                content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }]
              };
            case 'clear':
              // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
              this.pb.authStore.clear();
              return {
                content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }]
              };
            case 'export_cookie':
              // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
              return {
                content: [{ type: 'text', text: this.pb.authStore.exportToCookie(data) }]
              };
            case 'load_cookie':
              // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
              this.pb.authStore.loadFromCookie(data.cookie);
              return {
                content: [{ type: 'text', text: JSON.stringify({ success: true }, null, 2) }]
              };
          }
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to manage auth store: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Real-time subscription tool (Note: Streams data to server console, not back via MCP response)
    this.server.tool(
      'subscribe_to_collection',
      {
        collection: z.string().describe('Collection name to subscribe to'),
        recordId: z.string().optional().describe('Specific record ID to subscribe to (optional)'),
        filter: z.string().optional().describe('Filter expression for subscription (optional)')
        // How to handle the callback/stream is tricky with MCP's request/response model.
        // This implementation will log events to the server console.
      },
      async ({ collection, recordId, filter }) => {
        try {
          const subscribePath = recordId ? `${collection}/${recordId}` : collection;
          console.error(`[MCP PocketBase] Subscribing to ${subscribePath}...`);

          // The subscribe function takes a callback. We can't easily stream this back via MCP.
          // We'll log events to the server's console instead.
          // Also, managing unsubscription isn't straightforward in this model.
          // Cast to 'any' to bypass TS error if the specific type isn't correctly inferred
          await (this.pb.collection(collection) as any).subscribe(recordId || '*', (e: SubscriptionEvent) => {
            console.error(`[MCP PocketBase Subscription Event - ${collection}/${recordId || '*'}] Action: ${e.action}, Record:`, JSON.stringify(e.record, null, 2));
          }, { filter }); // Pass filter option if provided

          return {
            content: [{ type: 'text', text: `Successfully initiated subscription to collection '${collection}'${recordId ? ` for record '${recordId}'` : ''}. Events will be logged to the server console.` }]
          };
        } catch (error: any) {
          console.error(`[MCP PocketBase] Subscription failed for ${collection}/${recordId || '*'}:`, error);
          return {
            content: [{ type: 'text', text: `Failed to subscribe to collection: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Batch update tool
    this.server.tool(
      'batch_update_records',
      {
        collection: z.string().describe('Collection name'),
        records: z.array(z.object({
          id: z.string().describe('Record ID to update'),
          data: z.record(z.any()).describe('Data to update')
        })).describe('Array of records to update')
      },
      async ({ collection, records }) => {
        const results: any[] = [];
        const errors: any[] = [];
        try {
          for (const record of records) {
            try {
              const result = await this.pb.collection(collection).update(record.id, record.data);
              results.push({ id: record.id, status: 'success', result });
            } catch (error: any) {
              errors.push({ id: record.id, status: 'error', message: error.message });
            }
          }

          if (errors.length > 0) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ updated: results, errors: errors }, null, 2) }],
              isError: true // Indicate partial or full failure
            };
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ updated: results }, null, 2) }]
          };
        } catch (error: any) {
          // Catch potential errors outside the loop (though less likely here)
          return {
            content: [{ type: 'text', text: `Failed during batch update: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Batch delete tool
    this.server.tool(
      'batch_delete_records',
      {
        collection: z.string().describe('Collection name'),
        recordIds: z.array(z.string()).describe('Array of Record IDs to delete')
      },
      async ({ collection, recordIds }) => {
        const results: any[] = [];
        const errors: any[] = [];
        try {
          for (const id of recordIds) {
            try {
              await this.pb.collection(collection).delete(id);
              results.push({ id, status: 'success' });
            } catch (error: any) {
              errors.push({ id, status: 'error', message: error.message });
            }
          }

          if (errors.length > 0) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ deleted: results, errors: errors }, null, 2) }],
              isError: true // Indicate partial or full failure
            };
          }

          return {
            content: [{ type: 'text', text: JSON.stringify({ deleted: results }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed during batch delete: ${error.message}` }],
            isError: true
          };
        }
      }
    );
    
    // Batch operations tool
    this.server.tool(
      'execute_batch_operations',
      {
        operations: z.array(z.object({
          operation: z.enum(['create', 'update', 'delete', 'upsert']).describe('Operation type'),
          collection: z.string().describe('Collection name'),
          id: z.string().optional().describe('Record ID (required for update and delete)'),
          data: z.record(z.any()).optional().describe('Record data (required for create, update, and upsert)')
        })).describe('Array of operations to execute in a single transaction')
      },
      async ({ operations }) => {
        try {
          // Create a batch instance
          // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
          const batch = this.pb.createBatch();
          
          // Register operations to the batch
          for (const op of operations) {
            switch (op.operation) {
              case 'create':
                if (!op.data) {
                  throw new Error(`Data is required for create operation on collection ${op.collection}`);
                }
                batch.collection(op.collection).create(op.data);
                break;
              
              case 'update':
                if (!op.id) {
                  throw new Error(`ID is required for update operation on collection ${op.collection}`);
                }
                if (!op.data) {
                  throw new Error(`Data is required for update operation on collection ${op.collection}`);
                }
                batch.collection(op.collection).update(op.id, op.data);
                break;
              
              case 'delete':
                if (!op.id) {
                  throw new Error(`ID is required for delete operation on collection ${op.collection}`);
                }
                batch.collection(op.collection).delete(op.id);
                break;
              
              case 'upsert':
                if (!op.data) {
                  throw new Error(`Data is required for upsert operation on collection ${op.collection}`);
                }
                batch.collection(op.collection).upsert(op.data);
                break;
            }
          }
            // Send the batch request
          const result = await batch.send();
          
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to execute batch operations: ${error.message}` }],
            isError: true
          };
        }
      }    );
    
    // === ADVANCED FEATURES ===
    
    // Setup required collections for advanced features
    this.server.tool(
      'setup_advanced_collections',
      {},
      async () => {
        try {
          const collections = [
            {
              name: 'stripe_products',
              schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'description', type: 'text', required: false },
                { name: 'price', type: 'number', required: true },
                { name: 'currency', type: 'text', required: true },
                { name: 'recurring', type: 'bool', required: true },
                { name: 'interval', type: 'text', required: false },
                { name: 'stripeProductId', type: 'text', required: true },
                { name: 'stripePriceId', type: 'text', required: false },
                { name: 'active', type: 'bool', required: true },
                { name: 'metadata', type: 'json', required: false },
              ]
            },
            {
              name: 'stripe_customers',
              schema: [
                { name: 'email', type: 'email', required: true },
                { name: 'name', type: 'text', required: false },
                { name: 'stripeCustomerId', type: 'text', required: true },
                { name: 'userId', type: 'relation', required: false, options: { collectionId: 'users' } },
                { name: 'metadata', type: 'json', required: false },
              ]
            },
            {
              name: 'stripe_subscriptions',
              schema: [
                { name: 'customerId', type: 'text', required: true },
                { name: 'productId', type: 'text', required: false },
                { name: 'stripeSubscriptionId', type: 'text', required: true },
                { name: 'status', type: 'text', required: true },
                { name: 'currentPeriodStart', type: 'date', required: true },
                { name: 'currentPeriodEnd', type: 'date', required: true },
                { name: 'cancelAtPeriodEnd', type: 'bool', required: true },
                { name: 'metadata', type: 'json', required: false },
              ]
            },
            {
              name: 'stripe_payments',
              schema: [
                { name: 'customerId', type: 'text', required: true },
                { name: 'amount', type: 'number', required: true },
                { name: 'currency', type: 'text', required: true },
                { name: 'status', type: 'text', required: true },
                { name: 'stripePaymentIntentId', type: 'text', required: true },
                { name: 'description', type: 'text', required: false },
                { name: 'metadata', type: 'json', required: false },
              ]
            },
            {
              name: 'email_templates',
              schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'subject', type: 'text', required: true },
                { name: 'htmlContent', type: 'text', required: true },
                { name: 'textContent', type: 'text', required: false },
                { name: 'variables', type: 'json', required: false },
              ]
            },
            {
              name: 'email_logs',
              schema: [
                { name: 'to', type: 'email', required: true },
                { name: 'from', type: 'email', required: false },
                { name: 'subject', type: 'text', required: true },
                { name: 'template', type: 'text', required: false },
                { name: 'status', type: 'select', required: true, options: { values: ['sent', 'failed', 'pending'] } },
                { name: 'error', type: 'text', required: false },
                { name: 'variables', type: 'json', required: false },
              ]
            }
          ];

          const results = [];
          for (const collectionDef of collections) {
            try {
              // Check if collection exists
              try {
                await this.pb.collections.getOne(collectionDef.name);
                results.push({ collection: collectionDef.name, action: 'exists' });
              } catch {
                // Create collection if it doesn't exist
                await this.pb.collections.create({
                  name: collectionDef.name,
                  type: 'base',
                  schema: collectionDef.schema.map(field => ({
                    name: field.name,
                    type: field.type,
                    required: field.required,
                    options: field.options || {}
                  }))
                });
                results.push({ collection: collectionDef.name, action: 'created' });
              }
            } catch (error: any) {
              results.push({ collection: collectionDef.name, action: 'error', error: error.message });
            }
          }          return {
            content: [{ type: 'text', text: JSON.stringify({ setup: 'completed', results }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to setup advanced collections: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Stripe Product Management
    if (this.stripeService) {
      this.server.tool(
        'stripe_create_product',
        {
          name: z.string().describe('Product name'),
          description: z.string().optional().describe('Product description'),
          price: z.number().describe('Price in cents'),
          currency: z.string().default('usd').describe('Currency code'),
          recurring: z.boolean().optional().describe('Is this a subscription?'),
          interval: z.enum(['month', 'year', 'week', 'day']).optional().describe('Billing interval for subscriptions'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },
        async ({ name, description, price, currency, recurring, interval, metadata }) => {
          try {
            const product = await this.stripeService!.createProduct({
              name,
              description,
              price,
              currency,
              recurring,
              interval,
              metadata
            });

            return {
              content: [{ type: 'text', text: JSON.stringify(product, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create product: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'stripe_create_customer',
        {
          email: z.string().email().describe('Customer email'),
          name: z.string().optional().describe('Customer name'),
          userId: z.string().optional().describe('Associated user ID'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },
        async ({ email, name, userId, metadata }) => {
          try {
            const customer = await this.stripeService!.createCustomer({
              email,
              name,
              userId,
              metadata
            });

            return {
              content: [{ type: 'text', text: JSON.stringify(customer, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create customer: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'stripe_create_checkout_session',
        {
          priceId: z.string().describe('Stripe price ID'),
          customerId: z.string().optional().describe('Stripe customer ID'),
          customerEmail: z.string().email().optional().describe('Customer email if no customer ID'),
          successUrl: z.string().url().describe('Success redirect URL'),
          cancelUrl: z.string().url().describe('Cancel redirect URL'),
          mode: z.enum(['payment', 'subscription', 'setup']).default('payment').describe('Checkout mode'),
          metadata: z.record(z.any()).optional().describe('Session metadata')
        },
        async ({ priceId, customerId, customerEmail, successUrl, cancelUrl, mode, metadata }) => {
          try {
            const session = await this.stripeService!.createCheckoutSession({
              priceId,
              customerId,
              customerEmail,
              successUrl,
              cancelUrl,
              mode,
              metadata
            });

            return {
              content: [{ type: 'text', text: JSON.stringify(session, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create checkout session: ${error.message}` }],
              isError: true
            };
          }
        }      );

      this.server.tool(
        'stripe_create_payment_intent',
        {
          amount: z.number().describe('Amount in cents'),
          currency: z.string().default('usd').describe('Currency code'),
          customerId: z.string().optional().describe('Stripe customer ID'),
          description: z.string().optional().describe('Payment description'),
          metadata: z.record(z.any()).optional().describe('Payment metadata')
        },
        async ({ amount, currency, customerId, description, metadata }) => {
          try {
            const result = await this.stripeService!.createPaymentIntent({
              amount,
              currency,
              customerId,
              description,
              metadata
            });

            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create payment intent: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'stripe_retrieve_customer',
        {
          customerId: z.string().describe('Stripe customer ID')
        },
        async ({ customerId }) => {
          try {
            const customer = await this.stripeService!.retrieveCustomer(customerId);

            return {
              content: [{ type: 'text', text: JSON.stringify(customer, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to retrieve customer: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'stripe_update_customer',
        {
          customerId: z.string().describe('Stripe customer ID'),
          email: z.string().email().optional().describe('New customer email'),
          name: z.string().optional().describe('New customer name'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },
        async ({ customerId, email, name, metadata }) => {
          try {
            const customer = await this.stripeService!.updateCustomer(customerId, {
              email,
              name,
              metadata
            });

            return {
              content: [{ type: 'text', text: JSON.stringify(customer, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to update customer: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'stripe_cancel_subscription',
        {
          subscriptionId: z.string().describe('Stripe subscription ID'),
          cancelAtPeriodEnd: z.boolean().default(false).describe('Whether to cancel at period end or immediately')
        },
        async ({ subscriptionId, cancelAtPeriodEnd }) => {
          try {
            const subscription = await this.stripeService!.cancelSubscription(subscriptionId, cancelAtPeriodEnd);

            return {
              content: [{ type: 'text', text: JSON.stringify(subscription, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to cancel subscription: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'list_stripe_products',
        {
          page: z.number().optional().default(1).describe('Page number'),
          perPage: z.number().optional().default(50).describe('Records per page'),
          filter: z.string().optional().describe('Filter products (PocketBase filter syntax)')
        },
        async ({ page, perPage, filter }) => {
          try {
            const options: any = {};
            if (filter) options.filter = filter;

            const products = await this.pb.collection('stripe_products').getList(page, perPage, options);

            return {
              content: [{ type: 'text', text: JSON.stringify(products, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to list Stripe products: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'list_stripe_customers',
        {
          page: z.number().optional().default(1).describe('Page number'),
          perPage: z.number().optional().default(50).describe('Records per page'),
          filter: z.string().optional().describe('Filter customers (PocketBase filter syntax)')
        },
        async ({ page, perPage, filter }) => {
          try {
            const options: any = {};
            if (filter) options.filter = filter;

            const customers = await this.pb.collection('stripe_customers').getList(page, perPage, options);

            return {
              content: [{ type: 'text', text: JSON.stringify(customers, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to list Stripe customers: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'list_stripe_subscriptions',
        {
          page: z.number().optional().default(1).describe('Page number'),
          perPage: z.number().optional().default(50).describe('Records per page'),
          filter: z.string().optional().describe('Filter subscriptions (PocketBase filter syntax)')
        },
        async ({ page, perPage, filter }) => {
          try {
            const options: any = {};
            if (filter) options.filter = filter;

            const subscriptions = await this.pb.collection('stripe_subscriptions').getList(page, perPage, options);

            return {
              content: [{ type: 'text', text: JSON.stringify(subscriptions, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to list Stripe subscriptions: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'stripe_handle_webhook',
        {
          body: z.string().describe('Webhook request body'),
          signature: z.string().describe('Stripe signature header')
        },
        async ({ body, signature }) => {
          try {
            const result = await this.stripeService!.handleWebhook(body, signature);

            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to handle webhook: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'sync_stripe_products',
        {},
        async () => {
          try {
            const result = await this.stripeService!.syncProducts();

            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to sync products: ${error.message}` }],
              isError: true
            };
          }
        }
      );
    }

    // Email Management
    if (this.emailService) {
      this.server.tool(
        'create_email_template',
        {
          name: z.string().describe('Template name'),
          subject: z.string().describe('Email subject'),
          htmlContent: z.string().describe('HTML email content'),
          textContent: z.string().optional().describe('Plain text email content'),
          variables: z.array(z.string()).optional().describe('Template variables')
        },
        async ({ name, subject, htmlContent, textContent, variables }) => {
          try {
            const template = await this.emailService!.createTemplate({
              name,
              subject,
              htmlContent,
              textContent,
              variables
            });

            return {
              content: [{ type: 'text', text: JSON.stringify(template, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create email template: ${error.message}` }],
              isError: true
            };
          }
        }      );

      this.server.tool(
        'update_email_template',
        {
          name: z.string().describe('Template name to update'),
          subject: z.string().optional().describe('Email subject'),
          htmlContent: z.string().optional().describe('HTML email content'),
          textContent: z.string().optional().describe('Plain text email content'),
          variables: z.array(z.string()).optional().describe('Template variables')
        },
        async ({ name, subject, htmlContent, textContent, variables }) => {
          try {
            const template = await this.emailService!.updateTemplate(name, {
              subject,
              htmlContent,
              textContent,
              variables
            });

            return {
              content: [{ type: 'text', text: JSON.stringify(template, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to update email template: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'send_templated_email',
        {
          template: z.string().describe('Template name'),
          to: z.string().email().describe('Recipient email'),
          from: z.string().email().optional().describe('Sender email'),
          variables: z.record(z.any()).optional().describe('Template variables'),
          customSubject: z.string().optional().describe('Override template subject')
        },
        async ({ template, to, from, variables, customSubject }) => {
          try {
            const result = await this.emailService!.sendTemplatedEmail({
              template,
              to,
              from,
              variables,
              customSubject
            });

            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to send templated email: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'send_custom_email',
        {
          to: z.string().email().describe('Recipient email'),
          from: z.string().email().optional().describe('Sender email'),
          subject: z.string().describe('Email subject'),
          html: z.string().describe('HTML email content'),
          text: z.string().optional().describe('Plain text email content')
        },
        async ({ to, from, subject, html, text }) => {
          try {
            const result = await this.emailService!.sendCustomEmail({
              to,
              from,
              subject,
              html,
              text
            });

            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to send custom email: ${error.message}` }],
              isError: true
            };
          }
        }      );

      this.server.tool(
        'get_email_template',
        {
          name: z.string().describe('Template name to retrieve')
        },
        async ({ name }) => {
          try {
            const template = await this.emailService!.getTemplate(name);

            return {
              content: [{ type: 'text', text: JSON.stringify(template, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to get email template: ${error.message}` }],
              isError: true
            };
          }
        }      );

      this.server.tool(
        'list_email_templates',
        {
          page: z.number().optional().default(1).describe('Page number'),
          perPage: z.number().optional().default(50).describe('Records per page'),
          filter: z.string().optional().describe('Filter templates (PocketBase filter syntax)')
        },
        async ({ page, perPage, filter }) => {
          try {
            const options: any = {};
            if (filter) options.filter = filter;

            const templates = await this.pb.collection('email_templates').getList(page, perPage, options);

            return {
              content: [{ type: 'text', text: JSON.stringify(templates, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to list email templates: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'list_email_logs',
        {
          page: z.number().optional().default(1).describe('Page number'),
          perPage: z.number().optional().default(50).describe('Records per page'),
          filter: z.string().optional().describe('Filter logs (PocketBase filter syntax)')
        },
        async ({ page, perPage, filter }) => {
          try {
            const options: any = {};
            if (filter) options.filter = filter;

            const logs = await this.pb.collection('email_logs').getList(page, perPage, options);

            return {
              content: [{ type: 'text', text: JSON.stringify(logs, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to list email logs: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'delete_email_template',
        {
          name: z.string().describe('Template name to delete')
        },
        async ({ name }) => {
          try {
            // First get the template to get its ID
            const template = await this.emailService!.getTemplate(name);
            
            // Delete the template by ID
            await this.pb.collection('email_templates').delete(template.id);

            return {
              content: [{ type: 'text', text: `Successfully deleted email template: ${name}` }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to delete email template: ${error.message}` }],
              isError: true
            };
          }
        }      );

      this.server.tool(
        'test_email_connection',
        {},
        async () => {
          try {
            const result = await this.emailService!.testConnection();

            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to test email connection: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'setup_default_email_templates',
        {},
        async () => {
          try {
            const result = await this.emailService!.createDefaultTemplates();

            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to setup default templates: ${error.message}` }],
              isError: true
            };
          }
        }
      );    }

    // === FULL-STACK SAAS AUTOMATION TOOLS ===
    
    // Complete user registration with email and optional Stripe customer
    this.server.tool(
      'register_user_with_automation',
      {
        email: z.string().email().describe('User email'),
        password: z.string().describe('User password'),
        passwordConfirm: z.string().describe('Password confirmation'),
        name: z.string().optional().describe('User name'),
        sendWelcomeEmail: z.boolean().default(true).describe('Send welcome email'),
        createStripeCustomer: z.boolean().default(true).describe('Create Stripe customer'),
        welcomeEmailTemplate: z.string().default('welcome').describe('Welcome email template name'),
        metadata: z.record(z.any()).optional().describe('Additional metadata'),
        collection: z.string().optional().default('users').describe('Collection name')
      },
      async ({ email, password, passwordConfirm, name, sendWelcomeEmail, createStripeCustomer, welcomeEmailTemplate, metadata, collection }) => {
        try {
          const results: any = { user: null, stripeCustomer: null, emailLog: null };

          // 1. Create user account
          const user = await this.pb.collection(collection).create({
            email,
            password,
            passwordConfirm,
            name,
            ...metadata
          });
          results.user = user;

          // 2. Create Stripe customer if requested and service available
          if (createStripeCustomer && this.stripeService) {
            try {
              const stripeCustomer = await this.stripeService.createCustomer({
                email,
                name,
                userId: user.id,
                metadata: { userId: user.id, ...metadata }
              });
              results.stripeCustomer = stripeCustomer;
            } catch (error: any) {
              console.warn('Failed to create Stripe customer:', error.message);
              results.stripeCustomerError = error.message;
            }
          }

          // 3. Send welcome email if requested and service available
          if (sendWelcomeEmail && this.emailService) {
            try {
              const emailLog = await this.emailService.sendTemplatedEmail({
                template: welcomeEmailTemplate,
                to: email,
                variables: {
                  userName: name || email.split('@')[0],
                  appName: process.env.APP_NAME || 'Our Platform',
                  userEmail: email
                }
              });
              results.emailLog = emailLog;
            } catch (error: any) {
              console.warn('Failed to send welcome email:', error.message);
              results.emailError = error.message;
            }
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to register user: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Complete subscription flow with email notifications
    this.server.tool(
      'create_subscription_flow',
      {
        userEmail: z.string().email().describe('User email'),
        priceId: z.string().describe('Stripe price ID'),
        successUrl: z.string().url().describe('Success redirect URL'),
        cancelUrl: z.string().url().describe('Cancel redirect URL'),
        sendConfirmationEmail: z.boolean().default(true).describe('Send payment confirmation email'),
        emailTemplate: z.string().default('payment_success').describe('Email template for confirmation'),
        metadata: z.record(z.any()).optional().describe('Additional metadata')
      },
      async ({ userEmail, priceId, successUrl, cancelUrl, sendConfirmationEmail, emailTemplate, metadata }) => {
        try {
          if (!this.stripeService) {
            throw new Error('Stripe service not configured');
          }

          const results: any = { customer: null, checkoutSession: null, emailLog: null };

          // 1. Get or create Stripe customer
          let stripeCustomer;
          try {
            stripeCustomer = await this.pb.collection('stripe_customers')
              .getFirstListItem(`email="${userEmail}"`);
          } catch {
            // Create new customer if not found
            stripeCustomer = await this.stripeService.createCustomer({
              email: userEmail,
              metadata: metadata || {}
            });
          }
          results.customer = stripeCustomer;

          // 2. Create checkout session
          const checkoutSession = await this.stripeService.createCheckoutSession({
            priceId,
            customerId: stripeCustomer.stripeCustomerId,
            successUrl,
            cancelUrl,
            mode: 'subscription',
            metadata: metadata || {}
          });
          results.checkoutSession = checkoutSession;

          // 3. Send confirmation email (this will be triggered by webhook in real scenarios)
          if (sendConfirmationEmail && this.emailService) {
            try {
              const emailLog = await this.emailService.sendTemplatedEmail({
                template: emailTemplate,
                to: userEmail,
                variables: {
                  userName: stripeCustomer.name || userEmail.split('@')[0],
                  appName: process.env.APP_NAME || 'Our Platform',
                  checkoutUrl: checkoutSession.url
                }
              });
              results.emailLog = emailLog;
            } catch (error: any) {
              console.warn('Failed to send confirmation email:', error.message);
              results.emailError = error.message;
            }
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create subscription flow: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Process payment webhook and send notification email
    this.server.tool(
      'process_payment_webhook_with_email',
      {
        webhookBody: z.string().describe('Stripe webhook body'),
        webhookSignature: z.string().describe('Stripe webhook signature'),
        sendNotificationEmail: z.boolean().default(true).describe('Send notification email'),
        emailTemplate: z.string().default('payment_success').describe('Email template to use')
      },
      async ({ webhookBody, webhookSignature, sendNotificationEmail, emailTemplate }) => {
        try {
          if (!this.stripeService) {
            throw new Error('Stripe service not configured');
          }

          const results: any = { webhookResult: null, emailLog: null };

          // 1. Process webhook
          const webhookResult = await this.stripeService.handleWebhook(webhookBody, webhookSignature);
          results.webhookResult = webhookResult;

          // 2. Send notification email if successful payment
          if (sendNotificationEmail && this.emailService && webhookResult.processed) {
            try {
              // Parse webhook data to get customer email
              const event = JSON.parse(webhookBody);
              
              if (event.type === 'checkout.session.completed' || event.type === 'invoice.payment_succeeded') {
                const customerEmail = event.data.object.customer_email || 
                                     event.data.object.customer?.email;
                
                if (customerEmail) {
                  const emailLog = await this.emailService.sendTemplatedEmail({
                    template: emailTemplate,
                    to: customerEmail,
                    variables: {
                      userName: customerEmail.split('@')[0],
                      appName: process.env.APP_NAME || 'Our Platform',
                      amount: (event.data.object.amount_total || event.data.object.amount_paid) / 100,
                      currency: (event.data.object.currency || 'usd').toUpperCase(),
                      date: new Date().toLocaleDateString()
                    }
                  });
                  results.emailLog = emailLog;
                }
              }
            } catch (error: any) {
              console.warn('Failed to send payment notification email:', error.message);
              results.emailError = error.message;
            }
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to process webhook: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Setup complete SaaS backend (collections, templates, products)
    this.server.tool(
      'setup_complete_saas_backend',
      {
        appName: z.string().default('My SaaS App').describe('Application name'),
        products: z.array(z.object({
          name: z.string(),
          description: z.string().optional(),
          price: z.number(),
          currency: z.string().default('usd'),
          recurring: z.boolean().default(true),
          interval: z.enum(['month', 'year']).default('month')
        })).optional().describe('Products to create'),
        customEmailTemplates: z.array(z.object({
          name: z.string(),
          subject: z.string(),
          htmlContent: z.string(),
          textContent: z.string().optional(),
          variables: z.array(z.string()).optional()
        })).optional().describe('Custom email templates to create')
      },
      async ({ appName, products, customEmailTemplates }) => {
        try {
          const results: any = {
            collections: null,
            emailTemplates: null,
            stripeProducts: null,
            customTemplates: null
          };

          // 1. Setup required collections
          try {
            const collectionsResult = await this.pb.collection('_collections').create({
              name: 'setup_advanced_collections'
            });
            results.collections = 'setup completed';
          } catch (error: any) {
            // Collections might already exist, which is fine
            results.collections = 'collections already exist or setup completed';
          }

          // 2. Setup default email templates
          if (this.emailService) {
            try {
              const templatesResult = await this.emailService.createDefaultTemplates();
              results.emailTemplates = templatesResult;

              // Update templates with app name
              try {
                const templates = ['welcome', 'payment_success', 'subscription_expired'];
                for (const templateName of templates) {
                  const template = await this.emailService.getTemplate(templateName);
                  await this.emailService.updateTemplate(templateName, {
                    htmlContent: template.htmlContent.replace(/\{\{appName\}\}/g, appName),
                    textContent: template.textContent?.replace(/\{\{appName\}\}/g, appName)
                  });
                }
              } catch (error: any) {
                console.warn('Failed to update template app names:', error.message);
              }
            } catch (error: any) {
              results.emailTemplatesError = error.message;
            }

            // 3. Create custom email templates
            if (customEmailTemplates && customEmailTemplates.length > 0) {
              const customResults = [];
              for (const template of customEmailTemplates) {
                try {
                  const created = await this.emailService.createTemplate(template);
                  customResults.push({ template: template.name, action: 'created', id: created.id });
                } catch (error: any) {
                  customResults.push({ template: template.name, action: 'error', error: error.message });
                }
              }
              results.customTemplates = customResults;
            }
          }

          // 4. Create Stripe products
          if (this.stripeService && products && products.length > 0) {
            const productResults = [];
            for (const product of products) {
              try {
                const created = await this.stripeService.createProduct(product);
                productResults.push({ product: product.name, action: 'created', id: created.id });
              } catch (error: any) {
                productResults.push({ product: product.name, action: 'error', error: error.message });
              }
            }
            results.stripeProducts = productResults;
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to setup SaaS backend: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Cancel subscription with email notification
    this.server.tool(
      'cancel_subscription_with_email',
      {
        subscriptionId: z.string().describe('Stripe subscription ID'),
        userEmail: z.string().email().describe('User email'),
        cancelAtPeriodEnd: z.boolean().default(true).describe('Cancel at period end'),
        sendNotificationEmail: z.boolean().default(true).describe('Send cancellation email'),
        reason: z.string().optional().describe('Cancellation reason'),
        emailTemplate: z.string().default('subscription_expired').describe('Email template to use')
      },
      async ({ subscriptionId, userEmail, cancelAtPeriodEnd, sendNotificationEmail, reason, emailTemplate }) => {
        try {
          if (!this.stripeService) {
            throw new Error('Stripe service not configured');
          }

          const results: any = { subscription: null, emailLog: null };

          // 1. Cancel subscription
          const subscription = await this.stripeService.cancelSubscription(subscriptionId, cancelAtPeriodEnd);
          results.subscription = subscription;

          // 2. Send notification email
          if (sendNotificationEmail && this.emailService) {
            try {
              const emailLog = await this.emailService.sendTemplatedEmail({
                template: emailTemplate,
                to: userEmail,
                variables: {
                  userName: userEmail.split('@')[0],
                  appName: process.env.APP_NAME || 'Our Platform',
                  planName: 'Subscription',
                  expirationDate: cancelAtPeriodEnd ? 
                    new Date(subscription.current_period_end * 1000).toLocaleDateString() :
                    new Date().toLocaleDateString(),
                  reason: reason || 'User requested cancellation',
                  renewalUrl: process.env.APP_URL || 'https://yourapp.com'
                }
              });
              results.emailLog = emailLog;
            } catch (error: any) {
              console.warn('Failed to send cancellation email:', error.message);
              results.emailError = error.message;
            }
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to cancel subscription: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Component Generation Tools (Phase 3 - Coming Soon)
    this.server.tool(
      'generate_component',
      {
        type: z.enum(['form', 'table', 'card', 'modal', 'pricing', 'auth']).describe('Component type'),
        collection: z.string().optional().describe('PocketBase collection name'),
        fields: z.array(z.string()).optional().describe('Fields to include'),
        framework: z.enum(['react', 'svelte', 'vue', 'vanilla']).default('react').describe('Frontend framework'),
        styling: z.enum(['tailwind', 'daisyui', 'css']).default('tailwind').describe('Styling approach')
      },      async ({ type, collection, fields, framework, styling }) => {
        // TODO: Implement component generation in Phase 3
        return {
          content: [{ 
            type: 'text', 
            text: `Component generation for ${type} with ${framework} and ${styling} is coming in Phase 3. Check back soon!` 
          }]
        };
      }
    );

    // Advanced Features Info Tool
    this.server.tool(
      'get_saas_backend_status',
      {},
      async () => {
        const status: any = {
          services: {
            pocketbase: { status: 'active', url: this.pb.baseUrl },
            stripe: { status: this.stripeService ? 'active' : 'not configured' },
            email: { status: this.emailService ? 'active' : 'not configured' }
          },
          collections: { status: 'unknown', count: 0 },
          emailTemplates: { status: 'unknown', count: 0 },
          stripeProducts: { status: 'unknown', count: 0 },
          stripeCustomers: { status: 'unknown', count: 0 },
          readyForProduction: false
        };

        try {
          // Check collections
          const collections = await this.pb.collections.getList(1, 100);
          status.collections = { 
            status: 'active', 
            count: collections.items.length,
            hasAdvanced: collections.items.some((c: any) => 
              ['stripe_products', 'stripe_customers', 'email_templates'].includes(c.name)
            )
          };

          // Check email templates
          if (this.emailService) {
            try {
              const templates = await this.pb.collection('email_templates').getList(1, 100);
              status.emailTemplates = { 
                status: 'active', 
                count: templates.items.length,
                hasDefaults: templates.items.some((t: any) => 
                  ['welcome', 'payment_success', 'subscription_expired'].includes(t.name)
                )
              };
            } catch (error) {
              status.emailTemplates = { status: 'collection_missing', count: 0 };
            }
          }

          // Check Stripe data
          if (this.stripeService) {
            try {
              const products = await this.pb.collection('stripe_products').getList(1, 100);
              status.stripeProducts = { status: 'active', count: products.items.length };

              const customers = await this.pb.collection('stripe_customers').getList(1, 100);
              status.stripeCustomers = { status: 'active', count: customers.items.length };
            } catch (error) {
              status.stripeProducts = { status: 'collection_missing', count: 0 };
              status.stripeCustomers = { status: 'collection_missing', count: 0 };
            }
          }

          // Determine production readiness
          status.readyForProduction = 
            status.services.pocketbase.status === 'active' &&
            status.services.stripe.status === 'active' &&
            status.services.email.status === 'active' &&
            status.collections.hasAdvanced &&
            status.emailTemplates.hasDefaults;

          // Recommendations
          const recommendations: string[] = [];
          if (status.services.stripe.status !== 'active') {
            recommendations.push('Configure Stripe (add STRIPE_SECRET_KEY)');
          }
          if (status.services.email.status !== 'active') {
            recommendations.push('Configure email service (SMTP or SendGrid)');
          }
          if (!status.collections.hasAdvanced) {
            recommendations.push('Run setup_advanced_collections tool');
          }
          if (!status.emailTemplates.hasDefaults) {
            recommendations.push('Run setup_default_email_templates tool');
          }
          if (status.stripeProducts.count === 0 && status.services.stripe.status === 'active') {
            recommendations.push('Create some products with stripe_create_product');
          }

          status.recommendations = recommendations;

        } catch (error: any) {
          status.error = error.message;
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(status, null, 2) }]
        };
      }
    );

    this.server.tool(
      'get_advanced_features_info',
      {},
      async () => {
        const info: any = {
          version: '1.0.0',
          compatibility: 'Enhanced PocketBase Server',
          features: {
            payments: !!this.stripeService,
            email: !!this.emailService,
            backend: true,
            automation: true,
            components: false, // Phase 3
            deployment: false  // Phase 4
          },
          services: {
            stripe: this.stripeService ? 'initialized' : 'not configured',
            email: this.emailService ? 'initialized' : 'not configured',
            pocketbase: 'initialized'
          },
          automationTools: [
            'register_user_with_automation',
            'create_subscription_flow', 
            'process_payment_webhook_with_email',
            'setup_complete_saas_backend',
            'cancel_subscription_with_email'
          ],
          nextSteps: [] as string[]
        };

        if (!this.stripeService) {
          info.nextSteps.push('Add STRIPE_SECRET_KEY to enable payment features');
        }
        if (!this.emailService) {
          info.nextSteps.push('Add email configuration (SMTP or SendGrid) to enable email features');
        }
        if (this.stripeService && this.emailService) {
          info.nextSteps.push('Run setup_complete_saas_backend to initialize everything');
          info.nextSteps.push('Use automation tools for complete user workflows');
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(info, null, 2) }]
        };
      }
    );
  }

  async run() {
    console.error('[MCP DEBUG] Starting PocketBase MCP server...');
    
    // Log registered tools for debugging
    // @ts-ignore
    const toolNames = Object.keys(this.server._tools || {});
    console.error(`[MCP DEBUG] Registered tools: ${JSON.stringify(toolNames, null, 2)}`);
    
    const transport = new StdioServerTransport();
    console.error('[MCP DEBUG] Created StdioServerTransport, connecting...');
    
    try {
      await this.server.connect(transport);
      console.error('[MCP DEBUG] PocketBase MCP server running on stdio');
    } catch (error) {
      console.error(`[MCP DEBUG] Error connecting server: ${error}`);
    }
  }
}

const server = new PocketBaseServer();
server.run().catch(console.error);
