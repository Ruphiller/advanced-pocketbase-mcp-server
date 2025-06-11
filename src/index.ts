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

    // === LATEST STRIPE 2025 FEATURES ===
    
    if (this.stripeService) {
      // Treasury (for embedded finance)
      this.server.tool(
        'stripe_create_treasury_financial_account',
        {
          supportedCurrencies: z.array(z.string()).describe('Supported currencies for the account'),
          countryCode: z.string().describe('Country code for compliance'),
          metadata: z.record(z.any()).optional().describe('Additional metadata')
        },
        async ({ supportedCurrencies, countryCode, metadata }) => {
          try {
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
        },
        async ({ amount, currency, beneficiary, metadata }) => {
          try {
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
        },
        async ({ location }) => {
          try {
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
        },
        async ({ cardholderId, currency, type, spendingControls, metadata }) => {
          try {
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
        },
        async ({ name, payload, scope }) => {
          try {
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
        },
        async ({ type, providedDetails, metadata }) => {
          try {
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
        },
        async ({ currency, lineItems, customerDetails, metadata }) => {
          try {
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
        },
        async ({ type, card, customerId, metadata }) => {
          try {
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
        },
        async ({ paymentMethodId, customerId }) => {
          try {
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
        },
        async ({ customerId, type }) => {
          try {
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
            });

            const accountLink = await response.json();
            return { content: [{ type: 'text', text: JSON.stringify(accountLink, null, 2) }] };
          } catch (error: any) {
            return {
              content: [{ type: 'text', text: `Failed to create account link: ${error.message}` }],
              isError: true
            };
          }
        }
      );
    }
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
