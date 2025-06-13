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

// Extend PocketBase types - use the standard PocketBase interface
// No need to extend, just use PocketBase directly

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
  private pb: PocketBase;
  private _customHeaders: Record<string, string> = {};
  private _realtimeSubscriptions: Map<string, () => void> = new Map();
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
    });    // Initialize PocketBase client
    const url = process.env.POCKETBASE_URL;
    if (!url) {
      throw new Error('POCKETBASE_URL environment variable is required');
    }
    this.pb = new PocketBase(url);

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
    }    // Server info resource
    this.server.resource(
      "server-info",
      "pocketbase://info",
      async (uri) => {
        try {
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify({
                url: this.pb.baseUrl, // Using baseUrl for backward compatibility, will update later
                baseURL: this.pb.baseUrl, // Modern property name
                isAuthenticated: this.pb.authStore?.isValid || false,
                sdkVersion: '0.26.1'
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
              uri: uri.href,              text: JSON.stringify({
                isValid: this.pb.authStore.isValid,
                token: this.pb.authStore.token,
                record: this.pb.authStore.record
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
    console.error('[MCP DEBUG] Setting up tools...');    // Simple test tool
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
    }    // Diagnostic tool to list all registered tool names
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
    );    // Server info tool
    this.server.tool(
      'get_server_info',
      {},
      async () => {
        try {
          return {              content: [{
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
    );// Auth info tool
    this.server.tool(
      'get_auth_info',
      {},
      async () => {
        try {
          return {
            content: [{
              type: 'text',              text: JSON.stringify({
                isValid: this.pb.authStore.isValid,
                token: this.pb.authStore.token,
                record: this.pb.authStore.record,
                isAdmin: this.pb.authStore.record?.collectionName === '_superusers'
              }, null, 2)
            }]
          };        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to get auth info: ${error.message}` }],
            isError: true
          };
        }
      }
    );// New tool to list all collections
    this.server.tool(
      'list_collections',
      {
        includeSystem: z.boolean().optional().default(false).describe('Whether to include system collections')
      },
      async ({ includeSystem }: { includeSystem: boolean }) => {
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
          }        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to list collections: ${error.message}` }],
            isError: true
          };
        }
      }
    );// Record management tools with enhanced error handling
    this.server.tool(
      'create_record',
      {
        collection: z.string().describe('Collection name'),
        data: z.record(z.any()).describe('Record data')
      },
      async ({ collection, data }: { collection: string; data: Record<string, any> }) => {
        try {
          // Create record with type safety
          const result = await this.pb.collection(collection).create(data);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          // Enhanced error handling with ClientResponseError patterns
          let errorMessage = error.message;
          let errorDetails = null;
          let statusCode = error.status || 'unknown';
          
          // Check if it's a PocketBase ClientResponseError
          if (error.response && error.data) {
            errorMessage = error.data.message || error.message;
            errorDetails = error.data;
            statusCode = error.status;
          }
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Failed to create record',
                message: errorMessage,
                statusCode: statusCode,
                collection: collection,
                details: errorDetails
              }, null, 2)
            }],
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

        if (!this.pb.authStore.isValid || this.pb.authStore.record?.collectionName !== '_superusers') {
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
    );    this.server.tool(
      'list_records',
      {
        collection: z.string().describe('Collection name'),
        filter: z.string().optional().describe('Filter query (use safe parameter binding with build_filter tool)'),
        sort: z.string().optional().describe('Sort field and direction (e.g., "-created" for desc, "+name" for asc)'),
        page: z.number().optional().describe('Page number (1-based)'),
        perPage: z.number().optional().describe('Items per page (max 500)')
      },
      async ({ collection, filter, sort, page = 1, perPage = 50 }) => {
        try {
          // Validate pagination parameters
          if (page < 1) page = 1;
          if (perPage > 500) perPage = 500;
          if (perPage < 1) perPage = 1;
          
          const options: any = {};
          if (filter) options.filter = filter;
          if (sort) options.sort = sort;

          const result = await this.pb.collection(collection).getList(page, perPage, options);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          // Enhanced error handling
          let errorMessage = error.message;
          let statusCode = error.status || 'unknown';
          
          if (error.response && error.data) {
            errorMessage = error.data.message || error.message;
            statusCode = error.status;
          }
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Failed to list records',
                message: errorMessage,
                statusCode: statusCode,
                collection: collection,
                parameters: { page, perPage, filter, sort }
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );this.server.tool(
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
          // Enhanced error handling with ClientResponseError patterns
          let errorMessage = error.message;
          let statusCode = error.status || 'unknown';
          
          if (error.response && error.data) {
            errorMessage = error.data.message || error.message;
            statusCode = error.status;
          }
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Failed to update record',
                message: errorMessage,
                statusCode: statusCode,
                collection: collection,
                recordId: id
              }, null, 2)
            }],
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
    );    // Authentication tools
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
          // Enhanced error handling with ClientResponseError patterns
          let errorMessage = error.message;
          let statusCode = error.status || 'unknown';
          
          // Check if it's a PocketBase ClientResponseError
          if (error.response && error.data) {
            errorMessage = error.data.message || error.message;
            statusCode = error.status;
          }
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Authentication failed',
                message: errorMessage,
                statusCode: statusCode,
                collection: isAdmin ? '_superusers' : collection
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );this.server.tool(
      'authenticate_with_oauth2',
      {
        provider: z.string().describe('OAuth2 provider name'),
        code: z.string().describe('Authorization code'),
        codeVerifier: z.string().describe('PKCE code verifier'),
        redirectUrl: z.string().describe('Redirect URL'),
        collection: z.string().optional().default('users').describe('Collection name'),
        createData: z.record(z.any()).optional().describe('Additional user data for new records')
      },
      async ({ provider, code, codeVerifier, redirectUrl, collection, createData = {} }) => {
        try {
          // Updated method signature for latest PocketBase SDK
          const authData = await this.pb
            .collection(collection)
            .authWithOAuth2Code(provider, code, codeVerifier, redirectUrl, createData);

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
    );// Authenticate with OTP (updated for latest SDK)
    this.server.tool(
      'authenticate_with_otp',
      {
        email: z.string().describe('User email'),
        collection: z.string().optional().default('users').describe('Collection name')
      },
      async ({ email, collection }) => {
        try {
          // Updated method signature for latest PocketBase SDK
          const result = await this.pb.collection(collection).requestOTP(email);
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: result }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `OTP request failed: ${error.message}` }],
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
    );    // Filter builder tool with safe parameter binding (modern SDK pattern)
    this.server.tool(
      'build_filter',
      {
        expression: z.string().describe('Filter expression with placeholders like "name = {:name} && active = {:active}"'),
        params: z.record(z.any()).describe('Parameter values for safe binding (prevents SQL injection)')
      },
      async ({ expression, params }) => {
        try {
          // Use modern PocketBase filter method for safe parameter binding
          // This is equivalent to pb.filter() method in SDK v0.26.1
          // @ts-ignore - PocketBase has this method but TypeScript doesn't know about it
          const filter = this.pb.filter(expression, params);
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({ 
                filter,
                method: 'pb.filter()',
                description: 'Safe parameter binding prevents injection attacks',
                example: 'name = {:name} && active = {:active}',
                parameters: params
              }, null, 2) 
            }]
          };
        } catch (error: any) {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Failed to build filter',
                message: error.message,
                tip: 'Use placeholders like {:param} for safe parameter binding'
              }, null, 2)
            }],
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
      // Batch operations tool - Sequential implementation since batch API is not available
    this.server.tool(
      'execute_batch_operations',
      {
        operations: z.array(z.object({
          operation: z.enum(['create', 'update', 'delete']).describe('Operation type'),
          collection: z.string().describe('Collection name'),
          id: z.string().optional().describe('Record ID (required for update and delete)'),
          data: z.record(z.any()).optional().describe('Record data (required for create and update)')
        })).describe('Array of operations to execute sequentially')
      },
      async ({ operations }) => {
        const results: any[] = [];
        const errors: any[] = [];
        
        try {
          // Execute operations sequentially since batch API is not available
          for (const op of operations) {
            try {
              let result;
              switch (op.operation) {
                case 'create':
                  if (!op.data) {
                    throw new Error(`Data is required for create operation on collection ${op.collection}`);
                  }
                  result = await this.pb.collection(op.collection).create(op.data);
                  break;
                
                case 'update':
                  if (!op.id) {
                    throw new Error(`ID is required for update operation on collection ${op.collection}`);
                  }
                  if (!op.data) {
                    throw new Error(`Data is required for update operation on collection ${op.collection}`);
                  }
                  result = await this.pb.collection(op.collection).update(op.id, op.data);
                  break;
                
                case 'delete':
                  if (!op.id) {
                    throw new Error(`ID is required for delete operation on collection ${op.collection}`);
                  }
                  result = await this.pb.collection(op.collection).delete(op.id);
                  break;
              }
              
              results.push({
                operation: op.operation,
                collection: op.collection,
                id: op.id,
                status: 'success',
                result
              });
              
            } catch (error: any) {
              errors.push({
                operation: op.operation,
                collection: op.collection,
                id: op.id,
                status: 'error',
                error: error.message
              });
            }
          }
            return {
            content: [{ type: 'text', text: JSON.stringify({ 
              results, 
              errors,
              note: "Operations executed sequentially since batch API is not available in current PocketBase SDK version"
            }, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to execute batch operations: ${error.message}` }],
            isError: true
          };
        }
      }
    );
    
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
            },            {
              name: 'email_logs',
              schema: [
                { name: 'to', type: 'email', required: true },
                { name: 'from', type: 'email', required: false },
                { name: 'subject', type: 'text', required: true },
                { name: 'template', type: 'text', required: false },
                { name: 'status', type: 'select', required: true, options: { values: ['sent', 'failed', 'pending'] } },
                { name: 'error', type: 'text', required: false },
                { name: 'variables', type: 'json', required: false },
                // SendGrid-specific fields
                { name: 'sendgrid_message_id', type: 'text', required: false },
                { name: 'categories', type: 'json', required: false },
                { name: 'custom_args', type: 'json', required: false },
                { name: 'last_event', type: 'text', required: false },
                { name: 'last_event_timestamp', type: 'date', required: false },
              ]
            },
            {
              name: 'sendgrid_templates',
              schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'subject', type: 'text', required: false },
                { name: 'htmlContent', type: 'text', required: false },
                { name: 'textContent', type: 'text', required: false },
                { name: 'sendgridTemplateId', type: 'text', required: true },
                { name: 'active', type: 'bool', required: true },
              ]
            },
            {
              name: 'email_suppressions',
              schema: [
                { name: 'email', type: 'email', required: true },
                { name: 'type', type: 'select', required: true, options: { values: ['bounces', 'blocks', 'spam_reports', 'unsubscribes'] } },
                { name: 'reason', type: 'text', required: false },
                { name: 'created_at', type: 'date', required: true },
              ]
            },
            {
              name: 'sendgrid_contact_lists',
              schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'description', type: 'text', required: false },
                { name: 'contact_count', type: 'number', required: true },
                { name: 'sendgrid_list_id', type: 'text', required: true },
              ]
            },
            {
              name: 'sendgrid_contacts',
              schema: [
                { name: 'list_id', type: 'text', required: true },
                { name: 'email', type: 'email', required: true },
                { name: 'first_name', type: 'text', required: false },
                { name: 'last_name', type: 'text', required: false },
                { name: 'custom_fields', type: 'json', required: false },
              ]
            },
            {
              name: 'sendgrid_webhook_events',
              schema: [
                { name: 'email', type: 'email', required: true },
                { name: 'event', type: 'select', required: true, options: { values: ['delivered', 'open', 'click', 'bounce', 'dropped', 'spamreport', 'unsubscribe'] } },
                { name: 'timestamp', type: 'date', required: true },
                { name: 'sg_message_id', type: 'text', required: false },
                { name: 'useragent', type: 'text', required: false },
                { name: 'ip', type: 'text', required: false },
                { name: 'url', type: 'text', required: false },
                { name: 'reason', type: 'text', required: false },
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
    );    this.server.tool(
      'email_send_templated',
      {
        template: z.string().describe('Template name'),
        to: z.string().email().describe('Recipient email'),
        from: z.string().email().optional().describe('Sender email'),
        variables: z.record(z.any()).optional().describe('Template variables'),
        customSubject: z.string().optional().describe('Custom subject override'),
        // Optional SendGrid-specific parameters (backward compatible)
        categories: z.array(z.string()).optional().describe('SendGrid categories for email tracking (optional, SendGrid only)'),
        customArgs: z.record(z.string()).optional().describe('SendGrid custom arguments for tracking (optional, SendGrid only)'),
        enableClickTracking: z.boolean().optional().describe('Enable click tracking (optional, SendGrid only)'),
        enableOpenTracking: z.boolean().optional().describe('Enable open tracking (optional, SendGrid only)')
      },
      async ({ template, to, from, variables, customSubject, categories, customArgs, enableClickTracking, enableOpenTracking }) => {
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

          // Check if any SendGrid features are requested
          const hasEnhancedFeatures = categories || customArgs || enableClickTracking !== undefined || enableOpenTracking !== undefined;
          
          let emailLog;
          if (hasEnhancedFeatures && this.emailService.hasEnhancedFeatures()) {
            // Use enhanced method if SendGrid features are requested and available
            const enhancedData: any = {
              template,
              to,
              from,
              variables,
              customSubject
            };
            
            if (categories) enhancedData.categories = categories;
            if (customArgs) enhancedData.customArgs = customArgs;
            if (enableClickTracking !== undefined || enableOpenTracking !== undefined) {
              enhancedData.trackingSettings = {
                clickTracking: enableClickTracking,
                openTracking: enableOpenTracking
              };
            }
            
            emailLog = await this.emailService.sendEnhancedTemplatedEmail(enhancedData);
          } else {
            // Use regular method for backward compatibility
            emailLog = await this.emailService.sendTemplatedEmail({
              template,
              to,
              from,
              variables,
              customSubject
            });
          }

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
      'email_send_enhanced_templated',
      {
        template: z.string().describe('Template name'),
        to: z.string().email().describe('Recipient email'),
        from: z.string().email().optional().describe('Sender email'),
        variables: z.record(z.any()).optional().describe('Template variables'),
        customSubject: z.string().optional().describe('Custom subject override'),
        // SendGrid-specific options
        categories: z.array(z.string()).optional().describe('SendGrid categories for email tracking and organization'),
        customArgs: z.record(z.string()).optional().describe('SendGrid custom arguments for tracking'),
        sendAt: z.string().optional().describe('ISO 8601 datetime string for scheduled sending (SendGrid only)'),
        clickTracking: z.boolean().optional().describe('Enable click tracking (SendGrid only)'),
        openTracking: z.boolean().optional().describe('Enable open tracking (SendGrid only)'),
        sandboxMode: z.boolean().optional().describe('Enable sandbox mode for testing (SendGrid only)')
      },
      async ({ template, to, from, variables, customSubject, categories, customArgs, sendAt, clickTracking, openTracking, sandboxMode }) => {
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

          // Prepare enhanced email data
          const emailData: any = {
            template,
            to,
            from,
            variables,
            customSubject
          };

          // Add SendGrid-specific options if provided
          if (categories) emailData.categories = categories;
          if (customArgs) emailData.customArgs = customArgs;
          if (sendAt) emailData.sendAt = new Date(sendAt);
          if (sandboxMode !== undefined) emailData.sandboxMode = sandboxMode;
          
          if (clickTracking !== undefined || openTracking !== undefined) {
            emailData.trackingSettings = {
              clickTracking,
              openTracking
            };
          }

          const emailLog = await this.emailService.sendEnhancedTemplatedEmail(emailData);
          return {
            content: [{ type: 'text', text: JSON.stringify(emailLog, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to send enhanced templated email: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'email_schedule_templated',
      {
        template: z.string().describe('Template name'),
        to: z.string().email().describe('Recipient email'),
        sendAt: z.string().describe('ISO 8601 datetime string for when to send the email'),
        from: z.string().email().optional().describe('Sender email'),
        variables: z.record(z.any()).optional().describe('Template variables'),
        customSubject: z.string().optional().describe('Custom subject override'),
        categories: z.array(z.string()).optional().describe('SendGrid categories for email tracking')
      },
      async ({ template, to, sendAt, from, variables, customSubject, categories }) => {
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

          const emailLog = await this.emailService.scheduleTemplatedEmail({
            template,
            to,
            sendAt: new Date(sendAt),
            from,
            variables,
            customSubject,
            categories
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(emailLog, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to schedule templated email: ${error.message}` }],
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
      'email_check_features',
      {},
      async () => {
        try {
          if (!process.env.EMAIL_SERVICE && !process.env.SMTP_HOST) {
            return {
              content: [{ type: 'text', text: JSON.stringify({
                configured: false,
                message: 'Email service configuration required. Set EMAIL_SERVICE or SMTP configuration environment variables.'
              }, null, 2) }]
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb);
          }

          const features = {
            configured: true,
            service: process.env.EMAIL_SERVICE || 'smtp',
            enhancedFeatures: this.emailService.hasEnhancedFeatures(),
            capabilities: {
              basicEmail: true,
              templatedEmail: true,
              testConnection: true,
              enhancedTemplatedEmail: this.emailService.hasEnhancedFeatures(),
              scheduledEmail: this.emailService.hasEnhancedFeatures(),
              categories: this.emailService.hasEnhancedFeatures(),
              customArgs: this.emailService.hasEnhancedFeatures(),
              trackingSettings: this.emailService.hasEnhancedFeatures(),
              sandboxMode: this.emailService.hasEnhancedFeatures(),
              dynamicTemplates: this.emailService.hasEnhancedFeatures(),
              bulkEmail: this.emailService.hasEnhancedFeatures(),
              emailStatistics: this.emailService.hasEnhancedFeatures(),
              suppressionManagement: this.emailService.hasEnhancedFeatures(),
              emailValidation: this.emailService.hasEnhancedFeatures(),
              contactListManagement: this.emailService.hasEnhancedFeatures()
            }
          };

          return {
            content: [{ type: 'text', text: JSON.stringify(features, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to check email features: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // === SENDGRID TEMPLATE AND ANALYTICS TOOLS ===
    
    this.server.tool(
      'sendgrid_create_dynamic_template',
      {
        name: z.string().describe('Template name'),
        subject: z.string().optional().describe('Email subject'),
        htmlContent: z.string().optional().describe('HTML email content'),
        textContent: z.string().optional().describe('Plain text email content')
      },
      async ({ name, subject, htmlContent, textContent }) => {
        try {
          if (!process.env.EMAIL_SERVICE || process.env.EMAIL_SERVICE !== 'sendgrid') {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is required for this feature. Set EMAIL_SERVICE=sendgrid.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb);
          }

          const sendGridService = this.emailService.getSendGridService();
          if (!sendGridService) {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is not available.' }],
              isError: true
            };
          }

          const template = await sendGridService.createDynamicTemplate({
            name,
            subject,
            htmlContent,
            textContent
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(template, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create SendGrid dynamic template: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'sendgrid_send_bulk_email',
      {
        templateId: z.string().describe('SendGrid template ID'),
        recipients: z.array(z.object({
          email: z.string().email().describe('Recipient email'),
          dynamicTemplateData: z.record(z.any()).optional().describe('Template variables for this recipient')
        })).describe('Array of recipients with their template data'),
        from: z.string().email().optional().describe('Sender email'),
        categories: z.array(z.string()).optional().describe('SendGrid categories'),
        customArgs: z.record(z.string()).optional().describe('SendGrid custom arguments')
      },
      async ({ templateId, recipients, from, categories, customArgs }) => {
        try {
          if (!process.env.EMAIL_SERVICE || process.env.EMAIL_SERVICE !== 'sendgrid') {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is required for this feature. Set EMAIL_SERVICE=sendgrid.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb);
          }

          const sendGridService = this.emailService.getSendGridService();
          if (!sendGridService) {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is not available.' }],
              isError: true
            };
          }          // For now, convert template-based bulk email to individual sendEnhancedEmail calls
          // Since sendBulkEmails expects different structure, we'll process individually
          const results = {
            sent: 0,
            failed: 0,
            errors: [] as string[]
          };

          for (const recipient of recipients) {
            try {
              await sendGridService.sendEnhancedEmail({
                to: recipient.email,
                from: from || process.env.DEFAULT_FROM_EMAIL || process.env.SMTP_USER || 'noreply@example.com',
                subject: 'Template Email', // This would come from the template
                html: '<p>This is a template-based email</p>', // This would come from the template
                templateId: templateId,
                dynamicTemplateData: recipient.dynamicTemplateData,
                options: {
                  categories,
                  customArgs
                }
              });
              results.sent++;
            } catch (error: any) {
              results.failed++;
              results.errors.push(`${recipient.email}: ${error.message}`);
            }
          }

          const result = results;

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to send bulk email: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'sendgrid_get_email_statistics',
      {
        startDate: z.string().describe('Start date (YYYY-MM-DD format)'),
        endDate: z.string().optional().describe('End date (YYYY-MM-DD format, defaults to today)'),
        categories: z.array(z.string()).optional().describe('Filter by categories'),
        aggregatedBy: z.enum(['day', 'week', 'month']).optional().default('day').describe('Aggregation period')
      },
      async ({ startDate, endDate, categories, aggregatedBy }) => {
        try {
          if (!process.env.EMAIL_SERVICE || process.env.EMAIL_SERVICE !== 'sendgrid') {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is required for this feature. Set EMAIL_SERVICE=sendgrid.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb);
          }

          const sendGridService = this.emailService.getSendGridService();
          if (!sendGridService) {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is not available.' }],
              isError: true
            };
          }          const stats = await sendGridService.getEmailStats({
            startDate,
            endDate,
            categories,
            aggregatedBy
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to get email statistics: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'sendgrid_manage_suppression',
      {
        action: z.enum(['add', 'remove', 'list']).describe('Action to perform'),
        email: z.string().email().optional().describe('Email to add/remove from suppression (required for add/remove)'),
        suppressionType: z.enum(['bounce', 'block', 'spam', 'unsubscribe']).optional().describe('Type of suppression (required for add/remove)')
      },
      async ({ action, email, suppressionType }) => {
        try {
          if (!process.env.EMAIL_SERVICE || process.env.EMAIL_SERVICE !== 'sendgrid') {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is required for this feature. Set EMAIL_SERVICE=sendgrid.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb);
          }

          const sendGridService = this.emailService.getSendGridService();
          if (!sendGridService) {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is not available.' }],
              isError: true
            };
          }

          if ((action === 'add' || action === 'remove') && (!email || !suppressionType)) {
            return {
              content: [{ type: 'text', text: 'Error: email and suppressionType are required for add/remove actions.' }],
              isError: true
            };
          }          let result;
          
          if (action === 'list') {
            result = await sendGridService.getSuppressions(suppressionType as any);
          } else if (action === 'add' && email && suppressionType) {
            result = await sendGridService.addSuppression(email, suppressionType as any);
          } else if (action === 'remove' && email && suppressionType) {
            result = await sendGridService.removeSuppression(email, suppressionType as any);
          } else {
            throw new Error('Invalid action or missing parameters');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to manage suppression: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'sendgrid_validate_email',
      {
        email: z.string().email().describe('Email address to validate'),
        source: z.string().optional().describe('Source context for validation')
      },
      async ({ email, source }) => {
        try {
          if (!process.env.EMAIL_SERVICE || process.env.EMAIL_SERVICE !== 'sendgrid') {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is required for this feature. Set EMAIL_SERVICE=sendgrid.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb);
          }

          const sendGridService = this.emailService.getSendGridService();
          if (!sendGridService) {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is not available.' }],
              isError: true
            };
          }          const validation = await sendGridService.validateEmail(email);

          return {
            content: [{ type: 'text', text: JSON.stringify(validation, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to validate email: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    this.server.tool(
      'sendgrid_manage_contact_lists',
      {
        action: z.enum(['create', 'list', 'delete', 'add_contact', 'remove_contact']).describe('Action to perform'),
        listName: z.string().optional().describe('List name (required for create)'),
        listId: z.string().optional().describe('List ID (required for delete, add_contact, remove_contact)'),
        contactEmail: z.string().email().optional().describe('Contact email (required for add_contact, remove_contact)'),
        contactData: z.record(z.any()).optional().describe('Additional contact data (optional for add_contact)')
      },
      async ({ action, listName, listId, contactEmail, contactData }) => {
        try {
          if (!process.env.EMAIL_SERVICE || process.env.EMAIL_SERVICE !== 'sendgrid') {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is required for this feature. Set EMAIL_SERVICE=sendgrid.' }],
              isError: true
            };
          }

          if (!this.emailService) {
            this.emailService = new EmailService(this.pb);
          }

          const sendGridService = this.emailService.getSendGridService();
          if (!sendGridService) {
            return {
              content: [{ type: 'text', text: 'Error: SendGrid service is not available.' }],
              isError: true
            };
          }

          // Validate required parameters based on action
          if (action === 'create' && !listName) {
            return {
              content: [{ type: 'text', text: 'Error: listName is required for create action.' }],
              isError: true
            };
          }

          if ((action === 'delete' || action === 'add_contact' || action === 'remove_contact') && !listId) {
            return {
              content: [{ type: 'text', text: 'Error: listId is required for this action.' }],
              isError: true
            };
          }

          if ((action === 'add_contact' || action === 'remove_contact') && !contactEmail) {
            return {
              content: [{ type: 'text', text: 'Error: contactEmail is required for contact actions.' }],
              isError: true
            };
          }          let result;
          
          if (action === 'create' && listName) {
            result = await sendGridService.createContactList({
              name: listName,
              description: contactData?.description
            });
          } else if (action === 'list') {
            // Get all contact lists
            const lists = await this.pb.collection('sendgrid_contact_lists').getFullList();
            result = { lists };
          } else if (action === 'delete' && listId) {
            await this.pb.collection('sendgrid_contact_lists').delete(listId);
            result = { success: true, message: `Contact list ${listId} deleted` };
          } else if (action === 'add_contact' && listId && contactEmail) {
            result = await sendGridService.addContactToList(listId, {
              email: contactEmail,
              firstName: contactData?.firstName,
              lastName: contactData?.lastName,
              customFields: contactData?.customFields
            });
          } else if (action === 'remove_contact' && listId && contactEmail) {
            // Remove contact from list
            const contacts = await this.pb.collection('sendgrid_contacts').getFullList({
              filter: `list_id = "${listId}" && email = "${contactEmail}"`
            });
            
            for (const contact of contacts) {
              await this.pb.collection('sendgrid_contacts').delete(contact.id);
            }
            
            result = { success: true, message: `Contact ${contactEmail} removed from list ${listId}` };
          } else {
            throw new Error('Invalid action or missing required parameters');
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to manage contact lists: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // === HIGH-LEVEL AUTOMATION WORKFLOW TOOLS ===
    
    // Complete user registration with email and Stripe customer creation
    this.server.tool(
      'register_user_with_automation',
      {
        email: z.string().email().describe('User email'),
        password: z.string().describe('User password'),
        userData: z.record(z.any()).optional().describe('Additional user data'),
        sendWelcomeEmail: z.boolean().optional().default(true).describe('Send welcome email'),
        createStripeCustomer: z.boolean().optional().default(true).describe('Create Stripe customer')
      },
      async ({ email, password, userData = {}, sendWelcomeEmail, createStripeCustomer }) => {
        try {
          const results: any = {};
          
          // Step 1: Create PocketBase user
          const user = await this.pb.collection('users').create({
            email,
            password,
            passwordConfirm: password,
            ...userData
          });
          results.user = user;
          
          // Step 2: Create Stripe customer if enabled and service available
          if (createStripeCustomer && this.stripeService) {
            try {
              const customer = await this.stripeService.createCustomer({
                email,
                name: userData.name || email,
                metadata: { pocketbase_user_id: user.id }
              });
              results.stripeCustomer = customer;
              
              // Update user with Stripe customer ID
              await this.pb.collection('users').update(user.id, {
                stripe_customer_id: customer.id
              });
            } catch (error: any) {
              results.stripeError = error.message;
            }
          }
          
          // Step 3: Send welcome email if enabled and service available
          if (sendWelcomeEmail && this.emailService) {
            try {
              await this.emailService.sendTemplatedEmail({
                template: 'welcome',
                to: email,
                variables: {
                  name: userData.name || email,
                  email,
                  userId: user.id
                }
              });
              results.welcomeEmailSent = true;
            } catch (error: any) {
              results.emailError = error.message;
            }
          }
          
          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `User registration automation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // End-to-end subscription setup with email notifications
    this.server.tool(
      'create_subscription_flow',
      {
        customerId: z.string().describe('Stripe customer ID'),
        priceId: z.string().describe('Stripe price ID'),
        userEmail: z.string().email().describe('User email for notifications'),
        metadata: z.record(z.any()).optional().describe('Additional subscription metadata'),
        sendConfirmationEmail: z.boolean().optional().default(true).describe('Send confirmation email')
      },
      async ({ customerId, priceId, userEmail, metadata = {}, sendConfirmationEmail }) => {
        try {
          const results: any = {};
          
          if (!this.stripeService) {
            throw new Error('Stripe service not configured');
          }
          
          // Step 1: Create Stripe subscription
          const subscription = await this.stripeService.createAdvancedSubscription({
            customerId,
            items: [{ price: priceId }],
            metadata: {
              ...metadata,
              created_via: 'mcp_automation'
            }
          });
          results.subscription = subscription;
          
          // Step 2: Store subscription in PocketBase
          try {
            const subscriptionRecord = await this.pb.collection('stripe_subscriptions').create({
              stripe_subscription_id: subscription.id,
              stripe_customer_id: customerId,
              status: subscription.status,
              price_id: priceId,
              metadata: JSON.stringify(metadata),
              user_email: userEmail
            });
            results.subscriptionRecord = subscriptionRecord;
          } catch (error: any) {
            results.databaseError = error.message;
          }
          
          // Step 3: Send confirmation email if enabled and service available
          if (sendConfirmationEmail && this.emailService) {
            try {
              await this.emailService.sendTemplatedEmail({
                template: 'subscription_created',
                to: userEmail,
                variables: {
                  subscriptionId: subscription.id,
                  status: subscription.status,
                  priceId,
                  email: userEmail
                }
              });
              results.confirmationEmailSent = true;
            } catch (error: any) {
              results.emailError = error.message;
            }
          }
          
          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Subscription flow automation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Webhook processing with automated email notifications
    this.server.tool(
      'process_payment_webhook_with_email',
      {
        webhookPayload: z.record(z.any()).describe('Stripe webhook payload'),
        webhookSignature: z.string().describe('Stripe webhook signature'),
        sendNotifications: z.boolean().optional().default(true).describe('Send email notifications')
      },
      async ({ webhookPayload, webhookSignature, sendNotifications }) => {
        try {
          const results: any = {};
          
          if (!this.stripeService) {
            throw new Error('Stripe service not configured');
          }
          
          // Step 1: Process the webhook with Stripe service
          const webhookResult = await this.stripeService.handleWebhook(JSON.stringify(webhookPayload), webhookSignature);
          results.webhookProcessed = webhookResult;
          
          // Step 2: Handle specific webhook events with email notifications
          if (sendNotifications && this.emailService && webhookPayload.type) {
            const eventType = webhookPayload.type;
            const eventData = webhookPayload.data?.object;
            
            try {
              switch (eventType) {
                case 'payment_intent.succeeded':
                  if (eventData?.receipt_email) {
                    await this.emailService.sendTemplatedEmail({
                      template: 'payment_success',
                      to: eventData.receipt_email,
                      variables: {
                        amount: eventData.amount / 100,
                        currency: eventData.currency,
                        paymentId: eventData.id
                      }
                    });
                    results.paymentSuccessEmailSent = true;
                  }
                  break;
                  
                case 'payment_intent.payment_failed':
                  if (eventData?.receipt_email) {
                    await this.emailService.sendTemplatedEmail({
                      template: 'payment_failed',
                      to: eventData.receipt_email,
                      variables: {
                        amount: eventData.amount / 100,
                        currency: eventData.currency,
                        paymentId: eventData.id,
                        failureReason: eventData.last_payment_error?.message || 'Unknown error'
                      }
                    });
                    results.paymentFailedEmailSent = true;
                  }
                  break;
                  
                case 'customer.subscription.created':
                case 'customer.subscription.updated':
                  // Find user by customer ID and send notification
                  try {
                    const user = await this.pb.collection('users').getFirstListItem(
                      `stripe_customer_id = '${eventData?.customer}'`
                    );
                    await this.emailService.sendTemplatedEmail({
                      template: 'subscription_updated',
                      to: user.email,
                      variables: {
                        subscriptionId: eventData?.id,
                        status: eventData?.status,
                        customerId: eventData?.customer
                      }
                    });
                    results.subscriptionEmailSent = true;
                  } catch (error: any) {
                    results.subscriptionEmailError = error.message;
                  }
                  break;
              }
            } catch (error: any) {
              results.emailNotificationError = error.message;
            }
          }
          
          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Webhook processing automation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // One-click SaaS backend initialization
    this.server.tool(
      'setup_complete_saas_backend',
      {
        setupStripeCollections: z.boolean().optional().default(true).describe('Setup Stripe-related collections'),
        setupEmailCollections: z.boolean().optional().default(true).describe('Setup email-related collections'),
        createDefaultTemplates: z.boolean().optional().default(true).describe('Create default email templates'),
        setupUserCollections: z.boolean().optional().default(true).describe('Setup user management collections')
      },
      async ({ setupStripeCollections, setupEmailCollections, createDefaultTemplates, setupUserCollections }) => {
        try {
          const results: any = {};
            // Step 1: Setup advanced collections
          try {
            const collectionsSetup = await this.pb.collection('_collections').getList(1, 1);
            results.collectionsSetup = { success: true, message: 'Collections accessible' };
          } catch (error: any) {
            results.collectionsSetup = { success: false, error: error.message };
          }
          
          // Step 2: Create default email templates if email service available
          if (createDefaultTemplates && this.emailService) {
            try {
              const templatesResult = await this.emailService.createDefaultTemplates();
              results.defaultTemplates = templatesResult;
            } catch (error: any) {
              results.templatesError = error.message;
            }
          }
          
          // Step 3: Setup additional collections based on requirements
          const additionalCollections = [];
          
          if (setupUserCollections) {
            additionalCollections.push({
              name: 'user_profiles',
              schema: [
                { name: 'user_id', type: 'relation', required: true, options: { collectionId: 'users' } },
                { name: 'display_name', type: 'text', required: false },
                { name: 'bio', type: 'text', required: false },
                { name: 'avatar', type: 'file', required: false },
                { name: 'subscription_status', type: 'select', required: false, options: { values: ['free', 'premium', 'cancelled'] } }
              ]
            });
          }
          
          if (setupStripeCollections) {
            additionalCollections.push({
              name: 'payment_history',
              schema: [
                { name: 'user_id', type: 'relation', required: true, options: { collectionId: 'users' } },
                { name: 'stripe_payment_id', type: 'text', required: true },
                { name: 'amount', type: 'number', required: true },
                { name: 'currency', type: 'text', required: true },
                { name: 'status', type: 'text', required: true },
                { name: 'metadata', type: 'json', required: false }
              ]
            });
          }
          
          // Create additional collections
          for (const collection of additionalCollections) {
            try {
              const result = await this.pb.collections.create({
                name: collection.name,
                type: 'base',
                schema: collection.schema
              });
              results[`${collection.name}_created`] = result;
            } catch (error: any) {
              results[`${collection.name}_error`] = error.message;
            }
          }
          
          results.summary = {
            totalCollections: Object.keys(results).filter(k => k.endsWith('_created')).length,
            errors: Object.keys(results).filter(k => k.endsWith('_error')).length,
            backendReadyForProduction: Object.keys(results).filter(k => k.endsWith('_error')).length === 0
          };
          
          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `SaaS backend setup automation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Subscription cancellation with customer notifications
    this.server.tool(
      'cancel_subscription_with_email',
      {
        subscriptionId: z.string().describe('Stripe subscription ID'),
        reason: z.string().optional().describe('Cancellation reason'),
        sendNotification: z.boolean().optional().default(true).describe('Send cancellation email'),
        offerRetention: z.boolean().optional().default(false).describe('Include retention offer in email')
      },
      async ({ subscriptionId, reason, sendNotification, offerRetention }) => {
        try {
          const results: any = {};
          
          if (!this.stripeService) {
            throw new Error('Stripe service not configured');
          }
          
          // Step 1: Cancel the Stripe subscription
          const canceledSubscription = await this.stripeService.cancelSubscription(subscriptionId);
          results.canceledSubscription = canceledSubscription;
          
          // Step 2: Update subscription record in PocketBase
          try {
            const subscriptionRecord = await this.pb.collection('stripe_subscriptions').getFirstListItem(
              `stripe_subscription_id = '${subscriptionId}'`
            );
            
            await this.pb.collection('stripe_subscriptions').update(subscriptionRecord.id, {
              status: 'canceled',
              canceled_at: new Date().toISOString(),
              cancellation_reason: reason || 'User requested'
            });
            results.databaseUpdated = true;
          } catch (error: any) {
            results.databaseError = error.message;
          }
          
          // Step 3: Send cancellation notification email
          if (sendNotification && this.emailService) {
            try {
              // Get user email from subscription record or customer
              let userEmail = null;
              
              try {
                const subscriptionRecord = await this.pb.collection('stripe_subscriptions').getFirstListItem(
                  `stripe_subscription_id = '${subscriptionId}'`
                );
                userEmail = subscriptionRecord.user_email;
              } catch {
                // If no record found, try to get from Stripe customer
                if (canceledSubscription.customer) {
                  const customer = await this.stripeService.retrieveCustomer(canceledSubscription.customer as string);
                  userEmail = customer.email;
                }
              }
              
              if (userEmail) {                const emailTemplate = offerRetention ? 'subscription_canceled_with_offer' : 'subscription_canceled';
                await this.emailService.sendTemplatedEmail({
                  template: emailTemplate,
                  to: userEmail,
                  variables: {
                    subscriptionId: subscriptionId,
                    reason: reason || 'User requested',
                    canceledAt: canceledSubscription.canceled_at || new Date().toISOString(),
                    email: userEmail
                  }
                });
                results.cancellationEmailSent = true;
              } else {
                results.emailError = 'Could not find user email for notification';
              }
            } catch (error: any) {
              results.emailError = error.message;
            }
          }
          
          return {
            content: [{ type: 'text', text: JSON.stringify(results, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Subscription cancellation automation failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Backend status monitoring and health checks
    this.server.tool(
      'get_saas_backend_status',
      {
        includeCollectionStats: z.boolean().optional().default(true).describe('Include collection statistics'),
        includeServiceHealth: z.boolean().optional().default(true).describe('Include service health checks'),
        includeRecommendations: z.boolean().optional().default(true).describe('Include production readiness recommendations')
      },
      async ({ includeCollectionStats, includeServiceHealth, includeRecommendations }) => {
        try {
          const status: any = {
            timestamp: new Date().toISOString(),
            overall_status: 'checking'
          };
          
          // Check PocketBase connection
          try {
            const collections = await this.pb.collections.getList(1, 1);
            status.pocketbase = {
              connected: true,
              url: this.pb.baseUrl,
              authenticated: this.pb.authStore.isValid
            };
          } catch (error: any) {
            status.pocketbase = {
              connected: false,
              error: error.message
            };
          }
          
          // Check Stripe service
          if (includeServiceHealth) {
            if (this.stripeService) {              try {
                // Simple API call to verify Stripe connection
                const products = await this.stripeService.syncProducts();
                status.stripe = {
                  configured: true,
                  connected: true,
                  service: 'stripe'
                };
              } catch (error: any) {
                status.stripe = {
                  configured: true,
                  connected: false,
                  error: error.message
                };
              }
            } else {
              status.stripe = {
                configured: false,
                message: 'Stripe service not initialized - set STRIPE_SECRET_KEY environment variable'
              };
            }
            
            // Check Email service
            if (this.emailService) {
              try {
                const connectionTest = await this.emailService.testConnection();                status.email = {
                  configured: true,
                  connected: connectionTest.success,
                  service: 'email'
                };
              } catch (error: any) {
                status.email = {
                  configured: true,
                  connected: false,
                  error: error.message
                };
              }
            } else {
              status.email = {
                configured: false,
                message: 'Email service not initialized - set EMAIL_SERVICE environment variable'
              };
            }
          }
          
          // Collection statistics
          if (includeCollectionStats) {
            const collections = ['users', 'stripe_products', 'stripe_customers', 'stripe_subscriptions', 'email_templates', 'email_logs'];
            status.collections = {};
            
            for (const collection of collections) {
              try {
                const records = await this.pb.collection(collection).getList(1, 1);
                status.collections[collection] = {
                  exists: true,
                  total_records: records.totalItems || 0
                };
              } catch (error: any) {
                status.collections[collection] = {
                  exists: false,
                  error: error.message
                };
              }
            }
          }
          
          // Production readiness recommendations
          if (includeRecommendations) {
            const recommendations = [];
            
            if (!status.pocketbase?.authenticated) {
              recommendations.push('Setup admin authentication for production deployment');
            }
            
            if (!status.stripe?.configured) {
              recommendations.push('Configure Stripe for payment processing');
            }
            
            if (!status.email?.configured) {
              recommendations.push('Configure email service for user communications');
            }
            
            if (status.collections && Object.values(status.collections).some((c: any) => !c.exists)) {
              recommendations.push('Run setup_complete_saas_backend to create missing collections');
            }
            
            if (status.email?.configured && status.collections?.email_templates?.total_records === 0) {
              recommendations.push('Create default email templates using email_create_default_templates');
            }
            
            status.recommendations = recommendations;
            status.production_ready = recommendations.length === 0;
          }
          
          // Overall status
          const issues = [];
          if (!status.pocketbase?.connected) issues.push('pocketbase');
          if (status.stripe?.configured && !status.stripe?.connected) issues.push('stripe');
          if (status.email?.configured && !status.email?.connected) issues.push('email');
          
          status.overall_status = issues.length === 0 ? 'healthy' : 'degraded';
          status.issues = issues;
          
          return {
            content: [{ type: 'text', text: JSON.stringify(status, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Backend status check failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );    // === END HIGH-LEVEL AUTOMATION WORKFLOW TOOLS ===

    // === MISSING POCKETBASE SDK v0.26.1 FEATURES ===
    // These tools implement features from the latest PocketBase SDK that weren't available
    
    // Enhanced error handling with ClientResponseError patterns
    this.server.tool(
      'pb_parse_error',
      {
        error: z.any().describe('Error object to parse')
      },
      async ({ error }) => {
        try {
          const parsedError = {
            message: error.message || 'Unknown error',
            status: error.status || 'unknown',
            statusCode: error.status || 'unknown',
            data: error.data || null,
            isClientResponseError: !!(error.response && error.data),
            originalResponse: error.response || null,
            url: error.url || 'unknown',
            timestamp: new Date().toISOString()
          };
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify(parsedError, null, 2)
            }]
          };
        } catch (parseError: any) {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Failed to parse error',
                message: parseError.message,
                originalError: error
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // Modern baseURL property access (SDK v0.26.1)
    this.server.tool(
      'pb_get_base_url',
      {},
      async () => {
        try {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                baseUrl: this.pb.baseUrl, // Legacy property (still works)
                baseURL: this.pb.baseUrl, // Modern property name in v0.26.1
                note: 'Use baseURL property in latest SDK versions for consistency'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Failed to get base URL',
                message: error.message
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // Safe parameter binding (modern filter method)
    this.server.tool(
      'pb_safe_filter',
      {
        expression: z.string().describe('Filter expression with placeholders like "name = {:name}"'),
        params: z.record(z.any()).describe('Parameters for safe binding')
      },
      async ({ expression, params }) => {
        try {
          // This is equivalent to the pb.filter() method in SDK v0.26.1
          // @ts-ignore - Modern SDK method for safe parameter binding
          const safeFilter = this.pb.filter(expression, params);
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                safeFilter,
                expression,
                params,
                method: 'pb.filter()',
                security: 'Prevents SQL injection through parameter binding'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Failed to create safe filter',
                message: error.message,
                tip: 'Use {:param} syntax for parameter placeholders'
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // Enhanced record retrieval with getFirstListItem()
    this.server.tool(
      'pb_get_first_list_item',
      {
        collection: z.string().describe('Collection name'),
        filter: z.string().describe('Filter expression'),
        sort: z.string().optional().describe('Sort expression'),
        expand: z.string().optional().describe('Relations to expand')
      },
      async ({ collection, filter, sort, expand }) => {
        try {
          const options: any = { filter };
          if (sort) options.sort = sort;
          if (expand) options.expand = expand;
          
          // Enhanced method available in latest SDK
          const record = await this.pb.collection(collection).getFirstListItem(filter, options);
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                record,
                method: 'getFirstListItem()',
                note: 'More efficient than getList() when you only need the first matching record'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Failed to get first list item',
                message: error.message,
                collection,
                filter
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );    // Health service simulation (PocketBase health endpoint)
    this.server.tool(
      'pb_health_check',
      {},
      async () => {
        try {
          const healthStatus: {
            timestamp: string;
            status: string;
            checks: {
              database?: { status: string; message: string };
              auth?: { status: string; message: string };
              collections?: { status: string; message: string };
            };
          } = {
            timestamp: new Date().toISOString(),
            status: 'checking',
            checks: {}
          };
          
          // Check database connectivity
          try {
            await this.pb.collections.getList(1, 1);
            healthStatus.checks.database = { status: 'healthy', message: 'Database accessible' };
          } catch (error: any) {
            healthStatus.checks.database = { status: 'unhealthy', message: error.message };
          }
          
          // Check auth status
          healthStatus.checks.auth = {
            status: this.pb.authStore.isValid ? 'healthy' : 'unauthenticated',
            message: this.pb.authStore.isValid ? 'Authenticated' : 'No valid authentication'
          };
          
          // Check collections access
          try {
            const collections = await this.pb.collections.getList(1, 5);
            healthStatus.checks.collections = { 
              status: 'healthy', 
              message: `${collections.items.length} collections accessible` 
            };
          } catch (error: any) {
            healthStatus.checks.collections = { status: 'limited', message: error.message };
          }
          
          // Overall status
          const allHealthy = Object.values(healthStatus.checks).every((check: any) => check.status === 'healthy');
          healthStatus.status = allHealthy ? 'healthy' : 'degraded';
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify(healthStatus, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Health check failed',
                message: error.message,
                status: 'unhealthy'
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // Enhanced impersonation with duration control
    this.server.tool(
      'pb_impersonate_with_duration',
      {
        userId: z.string().describe('User ID to impersonate'),
        duration: z.number().optional().default(3600).describe('Impersonation duration in seconds'),
        collection: z.string().optional().default('users').describe('Collection name')
      },
      async ({ userId, duration, collection }) => {
        try {
          // Standard impersonation
          const authData = await this.pb.collection(collection).impersonate(userId, duration);
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                ...authData,
                impersonationDuration: duration,
                expiresAt: new Date(Date.now() + (duration * 1000)).toISOString(),
                note: 'Enhanced impersonation with duration control'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Enhanced impersonation failed',
                message: error.message,
                userId,
                duration,
                collection
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // Collection truncate operation
    this.server.tool(
      'pb_truncate_collection',
      {
        collection: z.string().describe('Collection name to truncate (delete all records)'),
        confirm: z.boolean().describe('Confirmation that you want to delete ALL records')
      },
      async ({ collection, confirm }) => {
        try {
          if (!confirm) {
            return {
              content: [{ 
                type: 'text', 
                text: JSON.stringify({
                  error: 'Truncate operation cancelled',
                  message: 'Set confirm=true to proceed with deleting all records',
                  collection
                }, null, 2)
              }],
              isError: true
            };
          }
          
          // Get all records and delete them (since there's no native truncate)
          const allRecords = await this.pb.collection(collection).getFullList();
          const deletedCount = allRecords.length;
          
          // Delete all records
          for (const record of allRecords) {
            await this.pb.collection(collection).delete(record.id);
          }
          
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                success: true,
                collection,
                deletedRecords: deletedCount,
                message: `Successfully truncated collection ${collection}`,
                warning: 'This operation cannot be undone'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ 
              type: 'text', 
              text: JSON.stringify({
                error: 'Truncate operation failed',
                message: error.message,
                collection
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // === END MISSING POCKETBASE SDK FEATURES ===
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
    
    // @ts-ignore
    const toolNames = Object.keys(this.server._tools || {});
    console.error(`[MCP DEBUG] Registered tools: ${JSON.stringify(toolNames)}`);
    
    const transport = new StdioServerTransport();
    
    try {
      console.error('[MCP DEBUG] Created StdioServerTransport, connecting...');
      await this.server.connect(transport);
      console.error('[MCP DEBUG] PocketBase MCP server running on stdio');
    } catch (error) {
      console.error(`[MCP DEBUG] Error connecting server: ${error}`);
    }
  }

  // Run as HTTP server
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

// Export the class for testing
export default PocketBaseServer;
export { PocketBaseServer };

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
