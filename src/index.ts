#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
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
        // Make email and password optional to allow using env vars when isAdmin=true
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
    );    // === STRIPE PAYMENT PROCESSING TOOLS ===
    // Note: These tools are always registered for discovery, but require STRIPE_SECRET_KEY at runtime
    
    // Stripe Product Management
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
          if (!process.env.STRIPE_SECRET_KEY) {
            return {
              content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
              isError: true
            };
          }
          
          if (!this.stripeService) {
            this.stripeService = new StripeService(this.pb);
          }
          
          const product = await this.stripeService.createProduct({
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
    );      this.server.tool(
        'stripe_create_customer',
        {
          email: z.string().email().describe('Customer email'),
          name: z.string().optional().describe('Customer name'),
          userId: z.string().optional().describe('Associated user ID'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },
        async ({ email, name, userId, metadata }) => {
          try {
            if (!process.env.STRIPE_SECRET_KEY) {
              return {
                content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
                isError: true
              };
            }
            
            if (!this.stripeService) {
              this.stripeService = new StripeService(this.pb);
            }
            
            const customer = await this.stripeService.createCustomer({
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
        }      );

    // === LATEST STRIPE 2025 FEATURES ===
    // Note: These tools are always registered for discovery, but require STRIPE_SECRET_KEY at runtime
    
    // Treasury (for embedded finance)
    this.server.tool(
      'stripe_create_treasury_financial_account',
      {
        supportedCurrencies: z.array(z.string()).describe('Supported currencies for the account'),
        countryCode: z.string().describe('Country code for compliance'),
        metadata: z.record(z.any()).optional().describe('Additional metadata')
      },      async ({ supportedCurrencies, countryCode, metadata }: {
        supportedCurrencies: string[];
        countryCode: string;
        metadata?: Record<string, any>;
      }) => {
        try {
          if (!process.env.STRIPE_SECRET_KEY) {
            return {
              content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
              isError: true
            };
          }
          
          // Note: This requires Treasury enabled on your Stripe account
          const response = await fetch('https://api.stripe.com/v1/treasury/financial_accounts', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              'supported_currencies[]': supportedCurrencies.join(','),
              'country': countryCode,
              ...Object.fromEntries(Object.entries(metadata || {}).map(([k, v]) => [`metadata[${k}]`, String(v)]))
            }),
          });

          const account = await response.json();

          return {
            content: [{ type: 'text', text: JSON.stringify(account, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create treasury financial account: ${error.message}` }],
            isError: true
          };
        }
      }
    );

      // Climate - Carbon removal orders (Stripe Climate)
      this.server.tool(
        'stripe_create_climate_order',
        {
          amount: z.number().describe('Amount in smallest currency unit for carbon removal'),
          currency: z.string().default('usd').describe('Currency'),
          beneficiary: z.string().optional().describe('Beneficiary of the carbon removal'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },        async ({ amount, currency, beneficiary, metadata }: {
          amount: number;
          currency: string;
          beneficiary?: string;
          metadata?: Record<string, any>;
        }) => {
          try {
            if (!process.env.STRIPE_SECRET_KEY) {
              return {
                content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
                isError: true
              };
            }
            // Note: This requires Climate products enabled
            const response = await fetch('https://api.stripe.com/v1/climate/orders', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                amount: amount.toString(),
                currency,
                ...(beneficiary && { beneficiary }),
                ...Object.fromEntries(Object.entries(metadata || {}).map(([k, v]) => [`metadata[${k}]`, String(v)]))
              }),
            });

            const order = await response.json();

            return {
              content: [{ type: 'text', text: JSON.stringify(order, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create climate order: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Terminal - For in-person payments
      this.server.tool(
        'stripe_create_terminal_connection_token',
        {
          location: z.string().optional().describe('Terminal location ID')
        },        async ({ location }: { location?: string }) => {
          try {
            if (!process.env.STRIPE_SECRET_KEY) {
              return {
                content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
                isError: true
              };
            }
            const response = await fetch('https://api.stripe.com/v1/terminal/connection_tokens', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                ...(location && { location })
              }),
            });

            const token = await response.json();

            return {
              content: [{ type: 'text', text: JSON.stringify(token, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create terminal connection token: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Issuing - For card issuing
      this.server.tool(
        'stripe_create_issuing_card',
        {
          cardholderId: z.string().describe('Cardholder ID'),
          currency: z.string().describe('Currency for the card'),
          type: z.enum(['virtual', 'physical']).describe('Type of card'),
          spendingControls: z.object({
            spendingLimits: z.array(z.object({
              amount: z.number(),
              interval: z.enum(['per_authorization', 'daily', 'weekly', 'monthly', 'yearly', 'all_time'])
            })).optional(),
            allowedCategories: z.array(z.string()).optional(),
            blockedCategories: z.array(z.string()).optional()
          }).optional().describe('Spending controls'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },        async ({ cardholderId, currency, type, spendingControls, metadata }: {
          cardholderId: string;
          currency: string;
          type: 'virtual' | 'physical';
          spendingControls?: any;
          metadata?: Record<string, any>;
        }) => {
          try {
            if (!process.env.STRIPE_SECRET_KEY) {
              return {
                content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
                isError: true
              };
            }
            const response = await fetch('https://api.stripe.com/v1/issuing/cards', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                cardholder: cardholderId,
                currency,
                type,
                ...(spendingControls && {
                  'spending_controls[spending_limits][0][amount]': spendingControls.spendingLimits?.[0]?.amount?.toString() || '',
                  'spending_controls[spending_limits][0][interval]': spendingControls.spendingLimits?.[0]?.interval || ''
                }),
                ...Object.fromEntries(Object.entries(metadata || {}).map(([k, v]) => [`metadata[${k}]`, String(v)]))
              }),
            });

            const card = await response.json();

            return {
              content: [{ type: 'text', text: JSON.stringify(card, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create issuing card: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Apps - For marketplace/platform integrations
      this.server.tool(
        'stripe_create_app_secret',
        {
          name: z.string().describe('Name for the secret'),
          payload: z.string().describe('Secret payload'),
          scope: z.object({
            type: z.enum(['account', 'user']),
            account: z.string().optional()
          }).describe('Scope of the secret')
        },        async ({ name, payload, scope }: {
          name: string;
          payload: string;
          scope: { type: 'account' | 'user'; account?: string };
        }) => {
          try {
            if (!process.env.STRIPE_SECRET_KEY) {
              return {
                content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
                isError: true
              };
            }
            const response = await fetch('https://api.stripe.com/v1/apps/secrets', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                name,
                payload,
                'scope[type]': scope.type,
                ...(scope.account && { 'scope[account]': scope.account })
              }),
            });

            const secret = await response.json();

            return {
              content: [{ type: 'text', text: JSON.stringify(secret, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create app secret: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Identity - For identity verification
      this.server.tool(
        'stripe_create_identity_verification_session',
        {
          type: z.enum(['document', 'id_number']).describe('Type of verification'),
          providedDetails: z.object({
            email: z.string().email().optional(),
            phone: z.string().optional(),
            address: z.object({
              line1: z.string().optional(),
              city: z.string().optional(),
              state: z.string().optional(),
              postal_code: z.string().optional(),
              country: z.string().optional()
            }).optional()
          }).optional().describe('Pre-filled details'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },        async ({ type, providedDetails, metadata }: {
          type: 'document' | 'id_number';
          providedDetails?: any;
          metadata?: Record<string, any>;
        }) => {
          try {
            if (!process.env.STRIPE_SECRET_KEY) {
              return {
                content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
                isError: true
              };
            }
            const response = await fetch('https://api.stripe.com/v1/identity/verification_sessions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                type,
                ...(providedDetails?.email && { 'provided_details[email]': providedDetails.email }),
                ...(providedDetails?.phone && { 'provided_details[phone]': providedDetails.phone }),
                ...Object.fromEntries(Object.entries(metadata || {}).map(([k, v]) => [`metadata[${k}]`, String(v)]))
              }),
            });

            const session = await response.json();

            return {
              content: [{ type: 'text', text: JSON.stringify(session, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create identity verification session: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Tax - For automated tax calculation
      this.server.tool(
        'stripe_create_tax_calculation',
        {
          currency: z.string().describe('Currency for the calculation'),
          lineItems: z.array(z.object({
            amount: z.number(),
            reference: z.string().optional(),
            taxBehavior: z.enum(['exclusive', 'inclusive']).optional(),
            taxCode: z.string().optional()
          })).describe('Line items for tax calculation'),
          customerDetails: z.object({
            address: z.object({
              line1: z.string().optional(),
              city: z.string().optional(),
              state: z.string().optional(),
              postal_code: z.string().optional(),
              country: z.string()
            }),
            addressSource: z.enum(['billing', 'shipping']).optional()
          }).describe('Customer details for tax calculation'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },        async ({ currency, lineItems, customerDetails, metadata }: {
          currency: string;
          lineItems: Array<{
            amount: number;
            reference?: string;
            taxBehavior?: 'exclusive' | 'inclusive';
            taxCode?: string;
          }>;
          customerDetails: {
            address: {
              line1?: string;
              city?: string;
              state?: string;
              postal_code?: string;
              country: string;
            };
            addressSource?: 'billing' | 'shipping';
          };
          metadata?: Record<string, any>;
        }) => {
          try {
            if (!process.env.STRIPE_SECRET_KEY) {
              return {
                content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
                isError: true
              };
            }
            const params = new URLSearchParams({
              currency,
              'line_items[0][amount]': lineItems[0]?.amount?.toString() || '0',
              'customer_details[address][country]': customerDetails.address.country,
              ...(customerDetails.address.line1 && { 'customer_details[address][line1]': customerDetails.address.line1 }),
              ...(customerDetails.address.city && { 'customer_details[address][city]': customerDetails.address.city }),
              ...(customerDetails.address.state && { 'customer_details[address][state]': customerDetails.address.state }),
              ...(customerDetails.address.postal_code && { 'customer_details[address][postal_code]': customerDetails.address.postal_code }),
              ...Object.fromEntries(Object.entries(metadata || {}).map(([k, v]) => [`metadata[${k}]`, String(v)]))
            });
            
            const response = await fetch('https://api.stripe.com/v1/tax/calculations', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params,
            });

            const calculation = await response.json();

            return {
              content: [{ type: 'text', text: JSON.stringify(calculation, null, 2) }]
            };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create tax calculation: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // === COMPREHENSIVE STRIPE PAYMENT METHODS & MODERN FEATURES ===

      // Payment Methods - Modern payment method management
      this.server.tool(
        'stripe_create_payment_method',
        {
          type: z.enum(['card', 'us_bank_account', 'sepa_debit', 'ideal', 'fpx', 'acss_debit', 'bacs_debit']).describe('Payment method type'),
          card: z.object({
            number: z.string(),
            exp_month: z.number(),
            exp_year: z.number(),
            cvc: z.string()
          }).optional().describe('Card details if type is card'),
          customerId: z.string().optional().describe('Customer to attach to'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },        async ({ type, card, customerId, metadata }: {
          type: 'card' | 'us_bank_account' | 'sepa_debit' | 'ideal' | 'fpx' | 'acss_debit' | 'bacs_debit';
          card?: {
            number: string;
            exp_month: number;
            exp_year: number;
            cvc: string;
          };
          customerId?: string;
          metadata?: Record<string, any>;
        }) => {
          try {
            if (!process.env.STRIPE_SECRET_KEY) {
              return {
                content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
                isError: true
              };
            }
            const params = new URLSearchParams({ type });
            
            if (card && type === 'card') {
              params.append('card[number]', card.number);
              params.append('card[exp_month]', card.exp_month.toString());
              params.append('card[exp_year]', card.exp_year.toString());
              params.append('card[cvc]', card.cvc);
            }
            
            if (customerId) params.append('customer', customerId);
            
            Object.entries(metadata || {}).forEach(([k, v]) => {
              params.append(`metadata[${k}]`, String(v));
            });

            const response = await fetch('https://api.stripe.com/v1/payment_methods', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params,
            });

            const paymentMethod = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(paymentMethod, null, 2) }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create payment method: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'stripe_attach_payment_method',
        {
          paymentMethodId: z.string().describe('Payment method ID'),
          customerId: z.string().describe('Customer ID to attach to')
        },        async ({ paymentMethodId, customerId }: {
          paymentMethodId: string;
          customerId: string;
        }) => {
          try {
            if (!process.env.STRIPE_SECRET_KEY) {
              return {
                content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
                isError: true
              };
            }
            const response = await fetch(`https://api.stripe.com/v1/payment_methods/${paymentMethodId}/attach`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({ customer: customerId }),
            });

            const paymentMethod = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(paymentMethod, null, 2) }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to attach payment method: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'stripe_list_payment_methods',
        {
          customerId: z.string().describe('Customer ID'),
          type: z.enum(['card', 'us_bank_account', 'sepa_debit']).optional().describe('Payment method type filter')
        },        async ({ customerId, type }: {
          customerId: string;
          type?: 'card' | 'us_bank_account' | 'sepa_debit';
        }) => {
          try {
            if (!process.env.STRIPE_SECRET_KEY) {
              return {
                content: [{ type: 'text', text: 'Error: STRIPE_SECRET_KEY environment variable is required for Stripe operations' }],
                isError: true
              };
            }
            const params = new URLSearchParams({ customer: customerId });
            if (type) params.append('type', type);

            const response = await fetch(`https://api.stripe.com/v1/payment_methods?${params}`, {
              headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` },
            });

            const paymentMethods = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(paymentMethods, null, 2) }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to list payment methods: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Setup Intents - For saving payment methods without charging
      this.server.tool(
        'stripe_create_setup_intent',
        {
          customerId: z.string().optional().describe('Customer ID'),
          paymentMethodTypes: z.array(z.string()).default(['card']).describe('Allowed payment method types'),
          usage: z.enum(['off_session', 'on_session']).default('off_session').describe('How the payment method will be used'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },
        async ({ customerId, paymentMethodTypes, usage, metadata }) => {
          try {
            const params = new URLSearchParams({ usage });
            if (customerId) params.append('customer', customerId);
            
            paymentMethodTypes.forEach(type => params.append('payment_method_types[]', type));
            Object.entries(metadata || {}).forEach(([k, v]) => {
              params.append(`metadata[${k}]`, String(v));
            });

            const response = await fetch('https://api.stripe.com/v1/setup_intents', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params,
            });

            const setupIntent = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(setupIntent, null, 2) }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create setup intent: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Payment Links - Shareable payment links
      this.server.tool(
        'stripe_create_payment_link',
        {
          lineItems: z.array(z.object({
            price: z.string(),
            quantity: z.number()
          })).describe('Line items for the payment link'),
          afterCompletion: z.object({
            type: z.enum(['redirect', 'hosted_confirmation']),
            redirect: z.object({
              url: z.string()
            }).optional()
          }).optional().describe('After completion behavior'),
          allowPromotionCodes: z.boolean().default(false).describe('Allow promotion codes'),
          applicationFeeAmount: z.number().optional().describe('Application fee in cents'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },
        async ({ lineItems, afterCompletion, allowPromotionCodes, applicationFeeAmount, metadata }) => {
          try {
            const params = new URLSearchParams();
            
            lineItems.forEach((item, index) => {
              params.append(`line_items[${index}][price]`, item.price);
              params.append(`line_items[${index}][quantity]`, item.quantity.toString());
            });
            
            if (afterCompletion) {
              params.append('after_completion[type]', afterCompletion.type);
              if (afterCompletion.redirect?.url) {
                params.append('after_completion[redirect][url]', afterCompletion.redirect.url);
              }
            }
            
            params.append('allow_promotion_codes', allowPromotionCodes.toString());
            if (applicationFeeAmount) params.append('application_fee_amount', applicationFeeAmount.toString());
            
            Object.entries(metadata || {}).forEach(([k, v]) => {
              params.append(`metadata[${k}]`, String(v));
            });

            const response = await fetch('https://api.stripe.com/v1/payment_links', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params,
            });

            const paymentLink = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(paymentLink, null, 2) }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create payment link: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Prices - Modern price management
      this.server.tool(
        'stripe_create_price',
        {
          productId: z.string().describe('Product ID'),
          unitAmount: z.number().describe('Unit amount in cents'),
          currency: z.string().default('usd').describe('Currency'),
          recurring: z.object({
            interval: z.enum(['day', 'week', 'month', 'year']),
            intervalCount: z.number().optional()
          }).optional().describe('Recurring billing details'),
          nickname: z.string().optional().describe('Price nickname'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },
        async ({ productId, unitAmount, currency, recurring, nickname, metadata }) => {
          try {
            const params = new URLSearchParams({
              product: productId,
              unit_amount: unitAmount.toString(),
              currency
            });
            
            if (recurring) {
              params.append('recurring[interval]', recurring.interval);
              if (recurring.intervalCount) {
                params.append('recurring[interval_count]', recurring.intervalCount.toString());
              }
            }
            
            if (nickname) params.append('nickname', nickname);
            Object.entries(metadata || {}).forEach(([k, v]) => {
              params.append(`metadata[${k}]`, String(v));
            });

            const response = await fetch('https://api.stripe.com/v1/prices', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params,
            });

            const price = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(price, null, 2) }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create price: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Coupons - Discount management
      this.server.tool(
        'stripe_create_coupon',
        {
          id: z.string().optional().describe('Coupon ID (optional, auto-generated if not provided)'),
          percentOff: z.number().optional().describe('Percent off (1-100)'),
          amountOff: z.number().optional().describe('Amount off in cents'),
          currency: z.string().optional().describe('Currency for amount_off'),
          duration: z.enum(['forever', 'once', 'repeating']).describe('How long the coupon is valid'),
          durationInMonths: z.number().optional().describe('Duration in months if duration is repeating'),
          maxRedemptions: z.number().optional().describe('Maximum number of redemptions'),
          redeemBy: z.number().optional().describe('Unix timestamp for expiration'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },
        async ({ id, percentOff, amountOff, currency, duration, durationInMonths, maxRedemptions, redeemBy, metadata }) => {
          try {
            const params = new URLSearchParams({ duration });
            
            if (id) params.append('id', id);
            if (percentOff) params.append('percent_off', percentOff.toString());
            if (amountOff) {
              params.append('amount_off', amountOff.toString());
              if (currency) params.append('currency', currency);
            }
            if (durationInMonths) params.append('duration_in_months', durationInMonths.toString());
            if (maxRedemptions) params.append('max_redemptions', maxRedemptions.toString());
            if (redeemBy) params.append('redeem_by', redeemBy.toString());
            
            Object.entries(metadata || {}).forEach(([k, v]) => {
              params.append(`metadata[${k}]`, String(v));
            });

            const response = await fetch('https://api.stripe.com/v1/coupons', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params,
            });

            const coupon = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(coupon, null, 2) }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create coupon: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Invoices - Invoice management
      this.server.tool(
        'stripe_create_invoice',
        {
          customerId: z.string().describe('Customer ID'),
          description: z.string().optional().describe('Invoice description'),
          dueDate: z.number().optional().describe('Unix timestamp for due date'),
          autoAdvance: z.boolean().default(true).describe('Auto-finalize and send'),
          collectionMethod: z.enum(['charge_automatically', 'send_invoice']).default('charge_automatically').describe('Collection method'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },
        async ({ customerId, description, dueDate, autoAdvance, collectionMethod, metadata }) => {
          try {
            const params = new URLSearchParams({
              customer: customerId,
              auto_advance: autoAdvance.toString(),
              collection_method: collectionMethod
            });
            
            if (description) params.append('description', description);
            if (dueDate) params.append('due_date', dueDate.toString());
            
            Object.entries(metadata || {}).forEach(([k, v]) => {
              params.append(`metadata[${k}]`, String(v));
            });

            const response = await fetch('https://api.stripe.com/v1/invoices', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params,
            });

            const invoice = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(invoice, null, 2) }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create invoice: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      this.server.tool(
        'stripe_finalize_invoice',
        {
          invoiceId: z.string().describe('Invoice ID to finalize'),
          autoAdvance: z.boolean().default(false).describe('Auto-send after finalizing')
        },
        async ({ invoiceId, autoAdvance }) => {
          try {
            const response = await fetch(`https://api.stripe.com/v1/invoices/${invoiceId}/finalize`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                auto_advance: autoAdvance.toString()
              }),
            });

            const invoice = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(invoice, null, 2) }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to finalize invoice: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Refunds - Payment refunds
      this.server.tool(
        'stripe_create_refund',
        {
          paymentIntentId: z.string().optional().describe('Payment Intent ID'),
          chargeId: z.string().optional().describe('Charge ID'),
          amount: z.number().optional().describe('Amount to refund in cents (optional, full refund if not specified)'),
          reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']).optional().describe('Reason for refund'),
          refundApplicationFee: z.boolean().default(false).describe('Whether to refund application fee'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },
        async ({ paymentIntentId, chargeId, amount, reason, refundApplicationFee, metadata }) => {
          try {
            const params = new URLSearchParams();
            
            if (paymentIntentId) params.append('payment_intent', paymentIntentId);
            if (chargeId) params.append('charge', chargeId);
            if (amount) params.append('amount', amount.toString());
            if (reason) params.append('reason', reason);
            params.append('refund_application_fee', refundApplicationFee.toString());
            
            Object.entries(metadata || {}).forEach(([k, v]) => {
              params.append(`metadata[${k}]`, String(v));
            });

            const response = await fetch('https://api.stripe.com/v1/refunds', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params,
            });

            const refund = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(refund, null, 2) }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create refund: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Disputes - Manage payment disputes
      this.server.tool(
        'stripe_list_disputes',
        {
          limit: z.number().default(10).describe('Number of disputes to return'),
          created: z.object({
            gte: z.number().optional(),
            lte: z.number().optional()
          }).optional().describe('Filter by creation date')
        },
        async ({ limit, created }) => {
          try {
            const params = new URLSearchParams({ limit: limit.toString() });
            
            if (created?.gte) params.append('created[gte]', created.gte.toString());
            if (created?.lte) params.append('created[lte]', created.lte.toString());

            const response = await fetch(`https://api.stripe.com/v1/disputes?${params}`, {
              headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` },
            });

            const disputes = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(disputes, null, 2) }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to list disputes: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Transfers - Transfer funds to connected accounts
      this.server.tool(
        'stripe_create_transfer',
        {
          amount: z.number().describe('Amount in cents'),
          currency: z.string().default('usd').describe('Currency'),
          destination: z.string().describe('Connected account ID'),
          description: z.string().optional().describe('Transfer description'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },
        async ({ amount, currency, destination, description, metadata }) => {
          try {
            const params = new URLSearchParams({
              amount: amount.toString(),
              currency,
              destination
            });
            
            if (description) params.append('description', description);
            Object.entries(metadata || {}).forEach(([k, v]) => {
              params.append(`metadata[${k}]`, String(v));
            });

            const response = await fetch('https://api.stripe.com/v1/transfers', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params,
            });

            const transfer = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(transfer, null, 2) }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create transfer: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Balance - Account balance information
      this.server.tool(
        'stripe_get_balance',
        {},
        async () => {
          try {
            const response = await fetch('https://api.stripe.com/v1/balance', {
              headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` },
            });

            const balance = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(balance, null, 2) }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to get balance: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Balance Transactions - Transaction history
      this.server.tool(
        'stripe_list_balance_transactions',
        {
          limit: z.number().default(10).describe('Number of transactions to return'),
          type: z.enum(['charge', 'refund', 'adjustment', 'application_fee', 'application_fee_refund', 'transfer', 'payment', 'payout', 'payout_failure', 'stripe_fee', 'network_cost']).optional().describe('Transaction type filter'),
          created: z.object({
            gte: z.number().optional(),
            lte: z.number().optional()
          }).optional().describe('Filter by creation date')
        },
        async ({ limit, type, created }) => {
          try {
            const params = new URLSearchParams({ limit: limit.toString() });
            
            if (type) params.append('type', type);
            if (created?.gte) params.append('created[gte]', created.gte.toString());
            if (created?.lte) params.append('created[lte]', created.lte.toString());

            const response = await fetch(`https://api.stripe.com/v1/balance_transactions?${params}`, {
              headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` },
            });

            const transactions = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(transactions, null, 2) }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to list balance transactions: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Events - Webhook events and history
      this.server.tool(
        'stripe_list_events',
        {
          limit: z.number().default(10).describe('Number of events to return'),
          type: z.string().optional().describe('Event type filter (e.g., payment_intent.succeeded)'),
          created: z.object({
            gte: z.number().optional(),
            lte: z.number().optional()
          }).optional().describe('Filter by creation date')
        },
        async ({ limit, type, created }) => {
          try {
            const params = new URLSearchParams({ limit: limit.toString() });
            
            if (type) params.append('type', type);
            if (created?.gte) params.append('created[gte]', created.gte.toString());
            if (created?.lte) params.append('created[lte]', created.lte.toString());

            const response = await fetch(`https://api.stripe.com/v1/events?${params}`, {
              headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` },
            });

            const events = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(events, null, 2) }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to list events: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Accounts - Connected accounts (for platforms)
      this.server.tool(
        'stripe_create_account',
        {
          type: z.enum(['express', 'standard', 'custom']).describe('Account type'),
          country: z.string().describe('Country code'),
          email: z.string().email().optional().describe('Account email'),
          businessType: z.enum(['individual', 'company']).optional().describe('Business type'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },
        async ({ type, country, email, businessType, metadata }) => {
          try {
            const params = new URLSearchParams({
              type,
              country
            });
            
            if (email) params.append('email', email);
            if (businessType) params.append('business_type', businessType);
            
            Object.entries(metadata || {}).forEach(([k, v]) => {
              params.append(`metadata[${k}]`, String(v));
            });

            const response = await fetch('https://api.stripe.com/v1/accounts', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params,
            });

            const account = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(account, null, 2) }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create account: ${error.message}` }],
              isError: true
            };
          }
        }
      );

      // Account Links - Onboarding links for connected accounts
      this.server.tool(
        'stripe_create_account_link',
        {
          accountId: z.string().describe('Connected account ID'),
          refreshUrl: z.string().url().describe('URL for user to refresh onboarding'),
          returnUrl: z.string().url().describe('URL for user after completing onboarding'),
          type: z.enum(['account_onboarding', 'account_update']).describe('Link type')
        },
        async ({ accountId, refreshUrl, returnUrl, type }) => {
          try {
            const response = await fetch('https://api.stripe.com/v1/account_links', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams({
                account: accountId,
                refresh_url: refreshUrl,
                return_url: returnUrl,
                type
              }),
            });            const accountLink = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(accountLink, null, 2) }] };
          } catch (error: any) {            return {
              content: [{ type: 'text', text: `Failed to create account link: ${error.message}` }],
              isError: true
            };
          }
        }
      );

    // === EMAIL SERVICE TOOLS ===
    // Note: These tools are always registered for discovery, but require email configuration at runtime
    
    this.server.tool(
      'email_create_template',
      {
        name: z.string().describe('Template name'),
        subject: z.string().describe('Email subject'),
        htmlContent: z.string().describe('HTML email content'),
        textContent: z.string().optional().describe('Plain text email content'),
        variables: z.array(z.string()).optional().describe('Template variables')
      },
      async ({ name, subject, htmlContent, textContent, variables }) => {
        try {
          if (!process.env.EMAIL_SERVICE && !process.env.SMTP_HOST) {
            return {
              content: [{ type: 'text', text: 'Error: Email service configuration required. Set EMAIL_SERVICE or SMTP configuration environment variables.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb);
          }

          const template = await this.emailService.createTemplate({
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
      }
    );

    this.server.tool(
      'email_get_template',
      {
        name: z.string().describe('Template name')
      },
      async ({ name }) => {
        try {
          if (!process.env.EMAIL_SERVICE && !process.env.SMTP_HOST) {
            return {
              content: [{ type: 'text', text: 'Error: Email service configuration required. Set EMAIL_SERVICE or SMTP configuration environment variables.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb);
          }

          const template = await this.emailService.getTemplate(name);
          return {
            content: [{ type: 'text', text: JSON.stringify(template, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to get email template: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'email_update_template',
      {
        name: z.string().describe('Template name'),
        subject: z.string().optional().describe('New email subject'),
        htmlContent: z.string().optional().describe('New HTML email content'),
        textContent: z.string().optional().describe('New plain text email content'),
        variables: z.array(z.string()).optional().describe('New template variables')
      },
      async ({ name, subject, htmlContent, textContent, variables }) => {
        try {
          if (!process.env.EMAIL_SERVICE && !process.env.SMTP_HOST) {
            return {
              content: [{ type: 'text', text: 'Error: Email service configuration required. Set EMAIL_SERVICE or SMTP configuration environment variables.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb);
          }

          const template = await this.emailService.updateTemplate(name, {
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
      'email_send_templated',
      {
        template: z.string().describe('Template name'),
        to: z.string().email().describe('Recipient email'),
        from: z.string().email().optional().describe('Sender email'),
        variables: z.record(z.any()).optional().describe('Template variables'),
        customSubject: z.string().optional().describe('Custom subject override')
      },
      async ({ template, to, from, variables, customSubject }) => {
        try {
          if (!process.env.EMAIL_SERVICE && !process.env.SMTP_HOST) {
            return {
              content: [{ type: 'text', text: 'Error: Email service configuration required. Set EMAIL_SERVICE or SMTP configuration environment variables.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb);
          }

          const emailLog = await this.emailService.sendTemplatedEmail({
            template,
            to,
            from,
            variables,
            customSubject
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(emailLog, null, 2) }]
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
      'email_send_custom',
      {
        to: z.string().email().describe('Recipient email'),
        from: z.string().email().optional().describe('Sender email'),
        subject: z.string().describe('Email subject'),
        html: z.string().describe('HTML email content'),
        text: z.string().optional().describe('Plain text email content')
      },
      async ({ to, from, subject, html, text }) => {
        try {
          if (!process.env.EMAIL_SERVICE && !process.env.SMTP_HOST) {
            return {
              content: [{ type: 'text', text: 'Error: Email service configuration required. Set EMAIL_SERVICE or SMTP configuration environment variables.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb);
          }

          const emailLog = await this.emailService.sendCustomEmail({
            to,
            from,
            subject,
            html,
            text
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(emailLog, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to send custom email: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'email_test_connection',
      {},
      async () => {
        try {
          if (!process.env.EMAIL_SERVICE && !process.env.SMTP_HOST) {
            return {
              content: [{ type: 'text', text: 'Error: Email service configuration required. Set EMAIL_SERVICE or SMTP configuration environment variables.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb);
          }

          const result = await this.emailService.testConnection();
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
      'email_create_default_templates',
      {},
      async () => {
        try {
          if (!process.env.EMAIL_SERVICE && !process.env.SMTP_HOST) {
            return {
              content: [{ type: 'text', text: 'Error: Email service configuration required. Set EMAIL_SERVICE or SMTP configuration environment variables.' }],
              isError: true
            };
          }          if (!this.emailService) {
            this.emailService = new EmailService(this.pb);
          }

          const results = await this.emailService.createDefaultTemplates();
          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create default email templates: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // === ADDITIONAL AUTOMATION TOOLS ===
    // Note: These tools provide advanced automation capabilities

    // Enhanced email sending tool (replacement for old send_email)
    this.server.tool(
      'send_email',
      {
        to: z.string().email().describe('Recipient email address'),
        subject: z.string().describe('Email subject'),
        htmlContent: z.string().optional().describe('HTML email content'),
        textContent: z.string().optional().describe('Plain text email content'),
        template: z.string().optional().describe('Email template name'),
        variables: z.record(z.any()).optional().describe('Template variables'),
        attachments: z.array(z.object({
          filename: z.string(),
          content: z.string(),
          contentType: z.string().optional()
        })).optional().describe('Email attachments')
      },
      async ({ to, subject, htmlContent, textContent, template, variables, attachments }) => {
        try {
          if (!process.env.EMAIL_SERVICE && !process.env.SMTP_HOST) {
            return {
              content: [{ type: 'text', text: 'Error: Email configuration (EMAIL_SERVICE or SMTP configuration) is required for email operations' }],
              isError: true
            };
          }
          
          if (!this.emailService) {
            this.emailService = new EmailService(this.pb);
          }
          
          let result;
          
          if (template) {
            // Use template-based sending
            result = await this.emailService.sendTemplatedEmail({
              template,
              to,
              variables,
              customSubject: subject
            });
          } else {
            // Use custom email sending
            result = await this.emailService.sendCustomEmail({
              to,
              subject,
              html: htmlContent || '',
              text: textContent
            });
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to send email: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Create email template tool (enhanced version)
    this.server.tool(
      'create_email_template',
      {
        name: z.string().describe('Template name'),
        subject: z.string().describe('Email subject template'),
        htmlContent: z.string().describe('HTML content template'),
        textContent: z.string().optional().describe('Plain text content template'),
        variables: z.array(z.string()).optional().describe('Template variables definition')
      },
      async ({ name, subject, htmlContent, textContent, variables }) => {
        try {
          if (!this.emailService) {
            this.emailService = new EmailService(this.pb);
          }

          const template = await this.emailService.createTemplate({
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
      }
    );

    // List email templates tool
    this.server.tool(
      'list_email_templates',
      {
        page: z.number().optional().default(1).describe('Page number'),
        perPage: z.number().optional().default(50).describe('Records per page'),
        filter: z.string().optional().describe('Filter templates')
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
    );    // Get email logs tool
    this.server.tool(
      'get_email_logs',
      {
        page: z.number().optional().default(1).describe('Page number'),
        perPage: z.number().optional().default(50).describe('Records per page'),
        filter: z.string().optional().describe('Filter email logs')
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
            content: [{ type: 'text', text: `Failed to get email logs: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // === AUTOMATION & WORKFLOW TOOLS ===
    // Advanced automation tools for workflow management and business process automation

    // Webhook management tool
    this.server.tool(
      'create_webhook',
      {
        name: z.string().describe('Webhook name'),
        url: z.string().url().describe('Webhook URL endpoint'),
        events: z.array(z.string()).describe('Events to trigger webhook (e.g., ["create", "update", "delete"])'),
        collection: z.string().describe('Collection to monitor'),
        active: z.boolean().default(true).describe('Whether webhook is active'),
        headers: z.record(z.string()).optional().describe('Custom headers to send'),
        secret: z.string().optional().describe('Secret for webhook verification')
      },
      async ({ name, url, events, collection, active, headers, secret }) => {
        try {
          const webhook = await this.pb.collection('webhooks').create({
            name,
            url,
            events,
            collection,
            active,
            headers: headers || {},
            secret,
            created: new Date().toISOString(),
            updated: new Date().toISOString()
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(webhook, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create webhook: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Trigger webhook manually
    this.server.tool(
      'trigger_webhook',
      {
        webhookId: z.string().describe('Webhook ID'),
        payload: z.record(z.any()).describe('Data to send to webhook'),
        testMode: z.boolean().default(false).describe('Test mode (logs response without persisting)')
      },
      async ({ webhookId, payload, testMode }) => {
        try {
          const webhook = await this.pb.collection('webhooks').getOne(webhookId);
          
          const response = await fetch(webhook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...webhook.headers,
              ...(webhook.secret && { 'X-Webhook-Secret': webhook.secret })
            },
            body: JSON.stringify(payload)
          });

          const responseData = {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: await response.text()
          };

          if (!testMode) {
            await this.pb.collection('webhook_logs').create({
              webhookId,
              payload,
              response: responseData,
              success: response.ok,
              timestamp: new Date().toISOString()
            });
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(responseData, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to trigger webhook: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Scheduled task management
    this.server.tool(
      'create_scheduled_task',
      {
        name: z.string().describe('Task name'),
        schedule: z.string().describe('Cron expression (e.g., "0 9 * * 1-5" for weekdays at 9am)'),
        action: z.enum(['email', 'webhook', 'database_cleanup', 'custom']).describe('Action type'),
        config: z.record(z.any()).describe('Task configuration'),
        active: z.boolean().default(true).describe('Whether task is active'),
        timezone: z.string().default('UTC').describe('Timezone for schedule')
      },
      async ({ name, schedule, action, config, active, timezone }) => {
        try {
          const task = await this.pb.collection('scheduled_tasks').create({
            name,
            schedule,
            action,
            config,
            active,
            timezone,
            lastRun: null,
            nextRun: null, // Would be calculated by scheduler
            created: new Date().toISOString(),
            updated: new Date().toISOString()
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(task, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create scheduled task: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Data transformation pipeline
    this.server.tool(
      'create_data_pipeline',
      {
        name: z.string().describe('Pipeline name'),
        sourceCollection: z.string().describe('Source collection'),
        targetCollection: z.string().describe('Target collection'),
        transformations: z.array(z.object({
          field: z.string(),
          operation: z.enum(['map', 'filter', 'aggregate', 'join', 'custom']),
          config: z.record(z.any())
        })).describe('Data transformation steps'),
        schedule: z.string().optional().describe('Cron schedule for automatic execution'),
        active: z.boolean().default(true).describe('Whether pipeline is active')
      },
      async ({ name, sourceCollection, targetCollection, transformations, schedule, active }) => {
        try {
          const pipeline = await this.pb.collection('data_pipelines').create({
            name,
            sourceCollection,
            targetCollection,
            transformations,
            schedule,
            active,
            lastRun: null,
            status: 'created',
            created: new Date().toISOString(),
            updated: new Date().toISOString()
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(pipeline, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create data pipeline: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Execute data pipeline
    this.server.tool(
      'execute_data_pipeline',
      {
        pipelineId: z.string().describe('Pipeline ID'),
        dryRun: z.boolean().default(false).describe('Dry run mode (preview without executing)')
      },
      async ({ pipelineId, dryRun }) => {
        try {
          const pipeline = await this.pb.collection('data_pipelines').getOne(pipelineId);
          
          // Get source data
          const sourceData = await this.pb.collection(pipeline.sourceCollection).getFullList();
          
          // Apply transformations
          let transformedData = sourceData;
          const executionLog = [];
          
          for (const transformation of pipeline.transformations) {
            const stepLog = {
              step: transformation.operation,
              field: transformation.field,
              inputCount: transformedData.length,
              outputCount: 0,
              config: transformation.config
            };
            
            switch (transformation.operation) {
              case 'map':
                transformedData = transformedData.map(item => ({
                  ...item,
                  [transformation.field]: this.applyMapping(item[transformation.field], transformation.config)
                }));
                break;
              case 'filter':
                transformedData = transformedData.filter(item => 
                  this.applyFilter(item, transformation.config)
                );
                break;
              case 'aggregate':
                transformedData = this.applyAggregation(transformedData, transformation.config);
                break;
            }
            
            stepLog.outputCount = transformedData.length;
            executionLog.push(stepLog);
          }
          
          if (!dryRun) {
            // Insert transformed data
            const results = [];
            for (const item of transformedData) {
              const result = await this.pb.collection(pipeline.targetCollection).create(item);
              results.push(result);
            }
            
            // Update pipeline last run
            await this.pb.collection('data_pipelines').update(pipelineId, {
              lastRun: new Date().toISOString(),
              status: 'completed'
            });
            
            return {
              content: [{ type: 'text', text: JSON.stringify({ 
                executionLog, 
                processedRecords: transformedData.length,
                insertedRecords: results.length 
              }, null, 2) }]
            };
          }
          
          return {
            content: [{ type: 'text', text: JSON.stringify({ 
              executionLog, 
              previewData: transformedData.slice(0, 5),
              totalRecords: transformedData.length,
              dryRun: true 
            }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to execute data pipeline: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Business rule engine
    this.server.tool(
      'create_business_rule',
      {
        name: z.string().describe('Rule name'),
        collection: z.string().describe('Collection to apply rule to'),
        trigger: z.enum(['create', 'update', 'delete', 'schedule']).describe('When to trigger rule'),
        conditions: z.array(z.object({
          field: z.string(),
          operator: z.enum(['equals', 'not_equals', 'greater_than', 'less_than', 'contains', 'in', 'not_in']),
          value: z.any()
        })).describe('Conditions that must be met'),
        actions: z.array(z.object({
          type: z.enum(['email', 'webhook', 'update_field', 'create_record', 'custom']),
          config: z.record(z.any())
        })).describe('Actions to execute'),
        active: z.boolean().default(true).describe('Whether rule is active'),
        priority: z.number().default(100).describe('Rule priority (lower = higher priority)')
      },
      async ({ name, collection, trigger, conditions, actions, active, priority }) => {
        try {
          const rule = await this.pb.collection('business_rules').create({
            name,
            collection,
            trigger,
            conditions,
            actions,
            active,
            priority,
            executionCount: 0,
            lastExecuted: null,
            created: new Date().toISOString(),
            updated: new Date().toISOString()
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(rule, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create business rule: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Evaluate business rules
    this.server.tool(
      'evaluate_business_rules',
      {
        collection: z.string().describe('Collection name'),
        recordId: z.string().describe('Record ID'),
        trigger: z.enum(['create', 'update', 'delete']).describe('Trigger event'),
        testMode: z.boolean().default(false).describe('Test mode (evaluate without executing actions)')
      },
      async ({ collection, recordId, trigger, testMode }) => {
        try {
          // Get record data
          const record = await this.pb.collection(collection).getOne(recordId);
          
          // Get applicable rules
          const rules = await this.pb.collection('business_rules').getList(1, 100, {
            filter: `collection = "${collection}" && trigger = "${trigger}" && active = true`,
            sort: 'priority'
          });
          
          const evaluationResults = [];
          
          for (const rule of rules.items) {            const ruleResult = {
              ruleId: rule.id,
              ruleName: rule.name,
              conditionsMet: true,
              actionsExecuted: [] as any[],
              errors: [] as string[]
            };
            
            // Evaluate conditions
            for (const condition of rule.conditions) {
              const fieldValue = record[condition.field];
              const conditionMet = this.evaluateCondition(fieldValue, condition.operator, condition.value);
              
              if (!conditionMet) {
                ruleResult.conditionsMet = false;
                break;
              }
            }
            
            // Execute actions if conditions met
            if (ruleResult.conditionsMet && !testMode) {
              for (const action of rule.actions) {
                try {
                  const actionResult = await this.executeRuleAction(action, record, collection);
                  ruleResult.actionsExecuted.push(actionResult);
                } catch (error: any) {
                  ruleResult.errors.push(`Action ${action.type} failed: ${error.message}`);
                }
              }
              
              // Update rule execution count
              await this.pb.collection('business_rules').update(rule.id, {
                executionCount: rule.executionCount + 1,
                lastExecuted: new Date().toISOString()
              });
            }
            
            evaluationResults.push(ruleResult);
          }
          
          return {
            content: [{ type: 'text', text: JSON.stringify({ 
              recordId, 
              trigger, 
              testMode,
              rulesEvaluated: evaluationResults.length,
              results: evaluationResults 
            }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to evaluate business rules: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Workflow management
    this.server.tool(
      'create_workflow',
      {
        name: z.string().describe('Workflow name'),
        description: z.string().optional().describe('Workflow description'),
        steps: z.array(z.object({
          id: z.string(),
          name: z.string(),
          type: z.enum(['approval', 'email', 'webhook', 'delay', 'condition', 'custom']),
          config: z.record(z.any()),
          dependencies: z.array(z.string()).optional()
        })).describe('Workflow steps'),
        triggers: z.array(z.object({
          type: z.enum(['manual', 'record_created', 'record_updated', 'webhook', 'schedule']),
          config: z.record(z.any())
        })).describe('Workflow triggers'),
        active: z.boolean().default(true).describe('Whether workflow is active')
      },
      async ({ name, description, steps, triggers, active }) => {
        try {
          const workflow = await this.pb.collection('workflows').create({
            name,
            description,
            steps,
            triggers,
            active,
            executionCount: 0,
            lastExecuted: null,
            created: new Date().toISOString(),
            updated: new Date().toISOString()
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(workflow, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create workflow: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Execute workflow
    this.server.tool(
      'execute_workflow',
      {
        workflowId: z.string().describe('Workflow ID'),
        input: z.record(z.any()).optional().describe('Input data for workflow'),
        dryRun: z.boolean().default(false).describe('Dry run mode')
      },
      async ({ workflowId, input, dryRun }) => {
        try {
          const workflow = await this.pb.collection('workflows').getOne(workflowId);
          
          // Create workflow instance
          const instance = await this.pb.collection('workflow_instances').create({
            workflowId,
            status: 'running',
            input: input || {},
            currentStep: 0,
            startTime: new Date().toISOString(),
            endTime: null,
            output: {},
            logs: []
          });          const executionResults = {
            instanceId: instance.id,
            status: 'running',
            steps: [] as any[],
            dryRun
          };

          if (!dryRun) {
            // Execute workflow steps
            for (let i = 0; i < workflow.steps.length; i++) {
              const step = workflow.steps[i];
              const stepResult = await this.executeWorkflowStep(step, instance, input || {});
              executionResults.steps.push(stepResult);
              
              if (stepResult.status === 'failed') {
                break;
              }
            }
            
            // Update workflow execution count
            await this.pb.collection('workflows').update(workflowId, {
              executionCount: workflow.executionCount + 1,
              lastExecuted: new Date().toISOString()
            });
          } else {
            // Dry run - just validate steps
            for (const step of workflow.steps) {
              executionResults.steps.push({
                stepId: step.id,
                name: step.name,
                type: step.type,
                status: 'simulated',
                config: step.config
              });
            }
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(executionResults, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to execute workflow: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Advanced data aggregation and reporting
    this.server.tool(
      'create_report',
      {
        name: z.string().describe('Report name'),
        collection: z.string().describe('Collection to report on'),
        metrics: z.array(z.object({
          field: z.string(),
          operation: z.enum(['count', 'sum', 'avg', 'min', 'max', 'distinct_count']),
          alias: z.string().optional()
        })).describe('Metrics to calculate'),
        groupBy: z.array(z.string()).optional().describe('Fields to group by'),
        filters: z.array(z.object({
          field: z.string(),
          operator: z.string(),
          value: z.any()
        })).optional().describe('Report filters'),
        dateRange: z.object({
          field: z.string(),
          start: z.string().optional(),
          end: z.string().optional()
        }).optional().describe('Date range filter'),
        schedule: z.string().optional().describe('Cron schedule for automatic generation')
      },
      async ({ name, collection, metrics, groupBy, filters, dateRange, schedule }) => {
        try {
          const report = await this.pb.collection('reports').create({
            name,
            collection,
            metrics,
            groupBy: groupBy || [],
            filters: filters || [],
            dateRange,
            schedule,
            lastGenerated: null,
            created: new Date().toISOString(),
            updated: new Date().toISOString()
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(report, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create report: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Generate report
    this.server.tool(
      'generate_report',
      {
        reportId: z.string().describe('Report ID'),
        format: z.enum(['json', 'csv', 'pdf']).default('json').describe('Output format'),
        email: z.string().email().optional().describe('Email address to send report to')
      },
      async ({ reportId, format, email }) => {
        try {
          const report = await this.pb.collection('reports').getOne(reportId);
          
          // Build query options
          let queryOptions: any = {};
          
          if (report.filters && report.filters.length > 0) {
            const filterStrings = report.filters.map((f: any) => `${f.field} ${f.operator} ${JSON.stringify(f.value)}`);
            queryOptions.filter = filterStrings.join(' && ');
          }
          
          if (report.dateRange) {
            const dateFilter = [];
            if (report.dateRange.start) {
              dateFilter.push(`${report.dateRange.field} >= "${report.dateRange.start}"`);
            }
            if (report.dateRange.end) {
              dateFilter.push(`${report.dateRange.field} <= "${report.dateRange.end}"`);
            }
            if (dateFilter.length > 0) {
              queryOptions.filter = queryOptions.filter ? 
                `${queryOptions.filter} && (${dateFilter.join(' && ')})` : 
                dateFilter.join(' && ');
            }
          }
          
          // Get data
          const data = await this.pb.collection(report.collection).getFullList(queryOptions);
          
          // Process metrics and grouping
          let reportData;
          if (report.groupBy && report.groupBy.length > 0) {
            reportData = this.processGroupedMetrics(data, report.metrics, report.groupBy);
          } else {
            reportData = this.processMetrics(data, report.metrics);
          }
          
          // Format output
          let output;
          switch (format) {
            case 'csv':
              output = this.formatAsCSV(reportData);
              break;
            case 'pdf':
              output = await this.formatAsPDF(reportData, report.name);
              break;
            default:
              output = JSON.stringify(reportData, null, 2);
          }
          
          // Save report instance
          const reportInstance = await this.pb.collection('report_instances').create({
            reportId,
            data: reportData,
            format,
            generatedAt: new Date().toISOString(),
            recordCount: Array.isArray(reportData) ? reportData.length : 1
          });
          
          // Update report last generated
          await this.pb.collection('reports').update(reportId, {
            lastGenerated: new Date().toISOString()
          });
          
          // Email if requested
          if (email && this.emailService) {
            await this.emailService.sendCustomEmail({
              to: email,
              subject: `Report: ${report.name}`,
              html: `<h2>Report: ${report.name}</h2><pre>${output}</pre>`,
              text: `Report: ${report.name}\n\n${output}`
            });
          }
          
          return {
            content: [{ type: 'text', text: JSON.stringify({ 
              reportInstanceId: reportInstance.id,
              data: reportData,
              format,
              emailSent: !!email
            }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to generate report: ${error.message}` }],
            isError: true
          };
        }
      }
    );    console.error(`[MCP DEBUG] setupTools completed with automation tools. Total tools registered.`);
  }

  // Utility methods for automation features
  private evaluateCondition(fieldValue: any, operator: string, value: any): boolean {
    switch (operator) {
      case 'equals':
        return fieldValue === value;
      case 'not_equals':
        return fieldValue !== value;
      case 'greater_than':
        return Number(fieldValue) > Number(value);
      case 'less_than':
        return Number(fieldValue) < Number(value);
      case 'contains':
        return String(fieldValue).includes(String(value));
      case 'in':
        return Array.isArray(value) && value.includes(fieldValue);
      case 'not_in':
        return Array.isArray(value) && !value.includes(fieldValue);
      default:
        return false;
    }
  }

  private async executeRuleAction(action: any, record: any, collection: string): Promise<any> {
    switch (action.type) {
      case 'email':
        if (this.emailService) {
          return await this.emailService.sendTemplatedEmail({
            template: action.config.template,
            to: action.config.to || record.email,
            variables: { ...record, ...action.config.variables }
          });
        }
        throw new Error('Email service not configured');
      
      case 'webhook':
        const response = await fetch(action.config.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ record, action: action.type })
        });
        return await response.json();
      
      case 'update_field':
        return await this.pb.collection(collection).update(record.id, {
          [action.config.field]: action.config.value
        });
      
      case 'create_record':
        return await this.pb.collection(action.config.collection).create(action.config.data);
      
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  private async executeWorkflowStep(step: any, instance: any, input: any): Promise<any> {
    try {
      switch (step.type) {
        case 'email':
          if (this.emailService) {
            await this.emailService.sendTemplatedEmail({
              template: step.config.template,
              to: step.config.to,
              variables: { ...input, ...step.config.variables }
            });
          }
          return { stepId: step.id, status: 'completed', type: step.type };
        
        case 'webhook':
          const response = await fetch(step.config.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input, step: step.id })
          });
          return { stepId: step.id, status: 'completed', type: step.type, response: await response.json() };
        
        case 'delay':
          await new Promise(resolve => setTimeout(resolve, step.config.milliseconds || 1000));
          return { stepId: step.id, status: 'completed', type: step.type };
        
        case 'condition':
          const conditionMet = this.evaluateCondition(
            input[step.config.field],
            step.config.operator,
            step.config.value
          );
          return { stepId: step.id, status: conditionMet ? 'completed' : 'skipped', type: step.type };
        
        default:
          return { stepId: step.id, status: 'completed', type: step.type };
      }
    } catch (error: any) {
      return { stepId: step.id, status: 'failed', type: step.type, error: error.message };
    }
  }

  private applyFilter(item: any, config: any): boolean {
    // Simple filter implementation
    if (config.condition) {
      return eval(config.condition.replace(/\$\{(\w+)\}/g, (_: any, field: string) => JSON.stringify(item[field])));
    }
    return true;
  }

  private applyAggregation(data: any[], config: any): any[] {
    // Simple aggregation implementation
    if (config.groupBy) {
      const groups = data.reduce((acc, item) => {
        const key = config.groupBy.map((field: string) => item[field]).join('|');
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
      }, {});
      
      return Object.entries(groups).map(([key, items]: [string, any]) => ({
        group: key,
        count: items.length,
        items
      }));
    }
    return data;
  }
  // Helper methods for automation tools
  private applyMapping(value: any, config: any): any {
    // Simple value mapping implementation
    if (config.mappings && config.mappings[value]) {
      return config.mappings[value];
    }
    return value;
  }

  private processMetrics(data: any[], metrics: any[]): any {
    const result: any = {};
    
    metrics.forEach(metric => {
      const alias = metric.alias || `${metric.operation}_${metric.field}`;
      const values = data.map(item => item[metric.field]).filter(v => v != null);
      
      switch (metric.operation) {
        case 'count':
          result[alias] = data.length;
          break;
        case 'sum':
          result[alias] = values.reduce((a, b) => a + Number(b), 0);
          break;
        case 'avg':
          result[alias] = values.reduce((a, b) => a + Number(b), 0) / values.length;
          break;
        case 'min':
          result[alias] = Math.min(...values.map(Number));
          break;
        case 'max':
          result[alias] = Math.max(...values.map(Number));
          break;
        case 'distinct_count':
          result[alias] = new Set(values).size;
          break;
      }
    });
    
    return result;
  }

  private processGroupedMetrics(data: any[], metrics: any[], groupBy: string[]): any[] {
    const groups: any = {};
    
    data.forEach(item => {
      const key = groupBy.map(field => item[field]).join('|');
      if (!groups[key]) {
        groups[key] = { items: [], group: {} };
        groupBy.forEach(field => {
          groups[key].group[field] = item[field];
        });
      }
      groups[key].items.push(item);
    });
    
    return Object.values(groups).map((group: any) => ({
      ...group.group,
      ...this.processMetrics(group.items, metrics)
    }));
  }

  private formatAsCSV(data: any): string {
    if (Array.isArray(data) && data.length > 0) {
      const headers = Object.keys(data[0]);
      const rows = data.map(item => headers.map(h => JSON.stringify(item[h])).join(','));
      return [headers.join(','), ...rows].join('\n');
    }
    return JSON.stringify(data);
  }

  private async formatAsPDF(data: any, title: string): Promise<string> {
    // Simple PDF formatting - in a real implementation, you'd use a PDF library
    return `PDF Report: ${title}\n${JSON.stringify(data, null, 2)}`;
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
  async runHttp(port: number = 3000) {
    console.error(`[MCP DEBUG] Starting PocketBase MCP HTTP server on port ${port}...`);
    
    // Log registered tools for debugging
    // @ts-ignore
    const toolNames = Object.keys(this.server._tools || {});
    console.error(`[MCP DEBUG] Registered tools: ${JSON.stringify(toolNames, null, 2)}`);
    
    // Import express and create app
    const express = require('express');
    const app = express();
    app.use(express.json());

    // Store transports by session ID
    const transports: Record<string, any> = {};

    // Health check endpoint
    app.get('/health', (req: any, res: any) => {
      res.json({ 
        status: 'healthy', 
        server: 'pocketbase-mcp-server',
        version: '3.0.0',
        pocketbaseUrl: this.pb.baseUrl,
        isAuthenticated: this.pb.authStore?.isValid || false
      });
    });

    // SSE endpoint for MCP connection
    app.get('/mcp', async (req: any, res: any) => {
      console.log('Received GET request to /mcp - establishing SSE connection');
      
      try {
        const transport = new SSEServerTransport('/mcp', res);
        const sessionId = transport.sessionId;
        transports[sessionId] = transport;
        
        res.on("close", () => {
          console.log(`SSE connection closed for session ${sessionId}`);
          delete transports[sessionId];
        });

        await this.server.connect(transport);
        console.error(`[MCP DEBUG] SSE transport connected for session ${sessionId}`);
      } catch (error) {
        console.error(`[MCP DEBUG] Error establishing SSE connection: ${error}`);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to establish SSE connection' });
        }
      }
    });

    // Start the server
    app.listen(port, () => {
      console.error(`[MCP DEBUG] PocketBase MCP HTTP server running on port ${port}`);
      console.log(`
==============================================
PocketBase MCP Server - HTTP Mode
Port: ${port}
Health Check: http://localhost:${port}/health
MCP Endpoint: http://localhost:${port}/mcp
==============================================
`);
    });

    // Handle server shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down server...');
      for (const sessionId in transports) {
        try {
          console.log(`Closing transport for session ${sessionId}`);
          await transports[sessionId].close();
          delete transports[sessionId];
        } catch (error) {
          console.error(`Error closing transport for session ${sessionId}:`, error);
        }
      }
      console.log('Server shutdown complete');
      process.exit(0);
    });
  }
}

// Create and run server
const server = new PocketBaseServer();

// Check if we should run in HTTP mode (for Smithery container deployment)
if (process.env.HTTP_MODE === 'true' || process.env.PORT) {
  // Get port from environment variable or default to 3000
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  
  // Run HTTP server for Smithery compatibility
  server.runHttp(port).catch(console.error);
} else {
  // Run stdio server for local development
  server.run().catch(console.error);
}
