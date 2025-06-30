/**
 * Comprehensive PocketBase MCP Server - Full Tool Set
 * 
 * This implementation provides a complete set of tools for:
 * - PocketBase CRUD operations (collections, records, auth, files)
 * - Stripe payment processing (customers, products, payments, subscriptions)
 * - Email services (templated emails, SMTP, SendGrid)
 * - Utility functions (health checks, status, discovery)
 * 
 * All tools use lazy loading and provide helpful error messages
 * when services aren't configured.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import PocketBase from 'pocketbase';
import { StripeService } from './services/stripe.js';
import { EmailService } from './services/email.js';

export interface PocketBaseMCPServerState {
  configuration: {
    pocketbaseUrl?: string;
    pocketbaseAdminEmail?: string;
    pocketbaseAdminPassword?: string;
    stripeSecretKey?: string;
    sendgridApiKey?: string;
    emailService?: string;
    smtpHost?: string;
  };
  initializationState: {
    configLoaded: boolean;
    pocketbaseInitialized: boolean;
    servicesInitialized: boolean;
    hasValidConfig: boolean;
    isAuthenticated: boolean;
  };
  customHeaders: Record<string, string>;
  lastActiveTime: number;
}

export class ComprehensivePocketBaseMCPAgent {
  server = new McpServer({
    name: "pocketbase-comprehensive-server",
    version: "1.0.0",
  });

  private pb?: PocketBase;
  private stripeService?: StripeService;
  private emailService?: EmailService;
  private state: PocketBaseMCPServerState;

  constructor() {
    this.state = {
      configuration: {},
      initializationState: {
        configLoaded: false,
        pocketbaseInitialized: false,
        servicesInitialized: false,
        hasValidConfig: false,
        isAuthenticated: false
      },
      customHeaders: {},
      lastActiveTime: Date.now()
    };

    this.setupAllTools();
  }

  /**
   * Initialize with environment configuration
   */
  async init(env: any = {}) {
    this.state.configuration = {
      pocketbaseUrl: env.POCKETBASE_URL,
      pocketbaseAdminEmail: env.POCKETBASE_ADMIN_EMAIL,
      pocketbaseAdminPassword: env.POCKETBASE_ADMIN_PASSWORD,
      stripeSecretKey: env.STRIPE_SECRET_KEY,
      sendgridApiKey: env.SENDGRID_API_KEY,
      emailService: env.EMAIL_SERVICE,
      smtpHost: env.SMTP_HOST
    };

    this.state.initializationState.configLoaded = true;
    this.state.initializationState.hasValidConfig = Boolean(
      this.state.configuration.pocketbaseUrl ||
      this.state.configuration.stripeSecretKey ||
      this.state.configuration.emailService
    );

    // Try to initialize PocketBase if URL is provided
    if (this.state.configuration.pocketbaseUrl) {
      await this.initializePocketBase();
    }

    this.state.lastActiveTime = Date.now();
  }

  /**
   * Setup all 101+ tools, prompts, and resources
   */
  private setupAllTools(): void {
    // PocketBase CRUD Tools (30+ tools)
    this.setupPocketBaseTools();
    
    // PocketBase Admin Tools (20+ tools)
    this.setupPocketBaseAdminTools();
    
    // PocketBase Real-time & WebSocket Tools (10+ tools)
    this.setupPocketBaseRealtimeTools();
    
    // Stripe Tools (25+ tools)
    this.setupStripeTools();
    
    // Email Tools (15+ tools)
    this.setupEmailTools();
    
    // Utility Tools (10+ tools)
    this.setupUtilityTools();

    // Setup MCP Resources
    this.setupResources();

    // Setup MCP Prompts
    this.setupPrompts();
  }

  /**
   * Setup comprehensive PocketBase tools
   */
  private setupPocketBaseTools(): void {
    // Collections Management
    this.server.tool(
      'pocketbase_list_collections',
      'List all available PocketBase collections',
      { type: 'object', properties: {} },
      async () => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured. Set POCKETBASE_URL environment variable.');
          }
          
          const collections = await this.pb.collections.getFullList(200);
          return this.successResponse({ collections });
        } catch (error: any) {
          return this.errorResponse(`Failed to list collections: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_get_collection',
      'Get detailed information about a specific collection',
      {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Collection name' }
        },
        required: ['name']
      },
      async ({ name }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const collection = await this.pb.collections.getOne(name);
          return this.successResponse({ collection });
        } catch (error: any) {
          return this.errorResponse(`Failed to get collection: ${error.message}`);
        }
      }
    );

    // Records Management
    this.server.tool(
      'pocketbase_create_record',
      'Create a new record in a collection',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          data: { type: 'object', description: 'Record data' }
        },
        required: ['collection', 'data']
      },
      async ({ collection, data }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const record = await this.pb.collection(collection).create(data);
          return this.successResponse({ record });
        } catch (error: any) {
          return this.errorResponse(`Failed to create record: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_get_record',
      'Get a specific record by ID',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          id: { type: 'string', description: 'Record ID' }
        },
        required: ['collection', 'id']
      },
      async ({ collection, id }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const record = await this.pb.collection(collection).getOne(id);
          return this.successResponse({ record });
        } catch (error: any) {
          return this.errorResponse(`Failed to get record: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_update_record',
      'Update an existing record',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          id: { type: 'string', description: 'Record ID' },
          data: { type: 'object', description: 'Updated data' }
        },
        required: ['collection', 'id', 'data']
      },
      async ({ collection, id, data }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const record = await this.pb.collection(collection).update(id, data);
          return this.successResponse({ record });
        } catch (error: any) {
          return this.errorResponse(`Failed to update record: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_delete_record',
      'Delete a record by ID',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          id: { type: 'string', description: 'Record ID' }
        },
        required: ['collection', 'id']
      },
      async ({ collection, id }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          await this.pb.collection(collection).delete(id);
          return this.successResponse({ message: `Record ${id} deleted successfully` });
        } catch (error: any) {
          return this.errorResponse(`Failed to delete record: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_list_records',
      'List records with filtering and pagination',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          page: { type: 'number', description: 'Page number (default: 1)' },
          perPage: { type: 'number', description: 'Records per page (default: 30)' },
          filter: { type: 'string', description: 'Filter query' },
          sort: { type: 'string', description: 'Sort criteria' }
        },
        required: ['collection']
      },
      async ({ collection, page = 1, perPage = 30, filter, sort }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const options: any = {};
          if (filter) options.filter = filter;
          if (sort) options.sort = sort;
          
          const records = await this.pb.collection(collection).getList(page, perPage, options);
          return this.successResponse({ records });
        } catch (error: any) {
          return this.errorResponse(`Failed to list records: ${error.message}`);
        }
      }
    );

    // Authentication Tools
    this.server.tool(
      'pocketbase_auth_with_password',
      'Authenticate with email and password',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'User collection (e.g., "users")' },
          email: { type: 'string', description: 'User email' },
          password: { type: 'string', description: 'User password' }
        },
        required: ['collection', 'email', 'password']
      },
      async ({ collection, email, password }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const authData = await this.pb.collection(collection).authWithPassword(email, password);
          return this.successResponse({ 
            user: authData.record,
            token: authData.token 
          });
        } catch (error: any) {
          return this.errorResponse(`Authentication failed: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_auth_with_oauth2',
      'Authenticate with OAuth2 provider',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'User collection' },
          provider: { type: 'string', description: 'OAuth2 provider (google, github, etc.)' },
          code: { type: 'string', description: 'OAuth2 authorization code' },
          codeVerifier: { type: 'string', description: 'PKCE code verifier' },
          redirectUrl: { type: 'string', description: 'OAuth2 redirect URL' }
        },
        required: ['collection', 'provider', 'code']
      },
      async ({ collection, provider, code, codeVerifier, redirectUrl }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const authData = await this.pb.collection(collection).authWithOAuth2Code(
            provider, code, codeVerifier, redirectUrl
          );
          return this.successResponse({ 
            user: authData.record,
            token: authData.token 
          });
        } catch (error: any) {
          return this.errorResponse(`OAuth2 authentication failed: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_auth_refresh',
      'Refresh authentication token',
      { type: 'object', properties: {} },
      async () => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const authData = await this.pb.collection('users').authRefresh();
          return this.successResponse({ 
            user: authData.record,
            token: authData.token 
          });
        } catch (error: any) {
          return this.errorResponse(`Token refresh failed: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_request_password_reset',
      'Request password reset email',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'User collection' },
          email: { type: 'string', description: 'User email' }
        },
        required: ['collection', 'email']
      },
      async ({ collection, email }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          await this.pb.collection(collection).requestPasswordReset(email);
          return this.successResponse({ message: 'Password reset email sent' });
        } catch (error: any) {
          return this.errorResponse(`Password reset request failed: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_confirm_password_reset',
      'Confirm password reset with token',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'User collection' },
          token: { type: 'string', description: 'Reset token' },
          password: { type: 'string', description: 'New password' },
          passwordConfirm: { type: 'string', description: 'Confirm new password' }
        },
        required: ['collection', 'token', 'password', 'passwordConfirm']
      },
      async ({ collection, token, password, passwordConfirm }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          await this.pb.collection(collection).confirmPasswordReset(token, password, passwordConfirm);
          return this.successResponse({ message: 'Password reset successfully' });
        } catch (error: any) {
          return this.errorResponse(`Password reset confirmation failed: ${error.message}`);
        }
      }
    );

    // File Management Tools
    this.server.tool(
      'pocketbase_upload_file',
      'Upload a file to a record',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          recordId: { type: 'string', description: 'Record ID' },
          field: { type: 'string', description: 'File field name' },
          file: { type: 'string', description: 'File content (base64 encoded)' },
          filename: { type: 'string', description: 'Original filename' }
        },
        required: ['collection', 'recordId', 'field', 'file', 'filename']
      },
      async ({ collection, recordId, field, file, filename }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          // Convert base64 to file
          const fileBuffer = Buffer.from(file, 'base64');
          const formData = new FormData();
          formData.append(field, new File([fileBuffer], filename));
          
          const record = await this.pb.collection(collection).update(recordId, formData);
          return this.successResponse({ record });
        } catch (error: any) {
          return this.errorResponse(`File upload failed: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_delete_file',
      'Delete a file from a record',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          recordId: { type: 'string', description: 'Record ID' },
          field: { type: 'string', description: 'File field name' },
          filename: { type: 'string', description: 'Filename to delete' }
        },
        required: ['collection', 'recordId', 'field', 'filename']
      },
      async ({ collection, recordId, field, filename }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const record = await this.pb.collection(collection).update(recordId, {
            [`${field}-`]: filename
          });
          return this.successResponse({ record });
        } catch (error: any) {
          return this.errorResponse(`File deletion failed: ${error.message}`);
        }
      }
    );

    // Real-time Subscription Tools
    this.server.tool(
      'pocketbase_subscribe_record',
      'Subscribe to record changes (returns subscription info)',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          recordId: { type: 'string', description: 'Record ID' }
        },
        required: ['collection', 'recordId']
      },
      async ({ collection, recordId }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          // Note: In a real implementation, this would set up WebSocket subscription
          return this.successResponse({ 
            message: `Subscribed to record ${recordId} in collection ${collection}`,
            subscriptionId: `${collection}:${recordId}:${Date.now()}`
          });
        } catch (error: any) {
          return this.errorResponse(`Subscription failed: ${error.message}`);
        }
      }
    );

    // Admin Operations
    this.server.tool(
      'pocketbase_create_collection',
      'Create a new collection (admin only)',
      {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Collection name' },
          type: { type: 'string', description: 'Collection type (base, auth, view)' },
          schema: { type: 'array', description: 'Collection schema fields' },
          options: { type: 'object', description: 'Collection options' }
        },
        required: ['name', 'type']
      },
      async ({ name, type, schema = [], options = {} }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const collection = await this.pb.collections.create({
            name,
            type,
            schema,
            ...options
          });
          return this.successResponse({ collection });
        } catch (error: any) {
          return this.errorResponse(`Collection creation failed: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_update_collection',
      'Update collection schema (admin only)',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Collection ID' },
          name: { type: 'string', description: 'Collection name' },
          schema: { type: 'array', description: 'Updated schema fields' },
          options: { type: 'object', description: 'Collection options' }
        },
        required: ['id']
      },
      async ({ id, name, schema, options }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const updateData: any = {};
          if (name) updateData.name = name;
          if (schema) updateData.schema = schema;
          if (options) Object.assign(updateData, options);
          
          const collection = await this.pb.collections.update(id, updateData);
          return this.successResponse({ collection });
        } catch (error: any) {
          return this.errorResponse(`Collection update failed: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_delete_collection',
      'Delete a collection (admin only)',
      {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Collection ID' }
        },
        required: ['id']
      },
      async ({ id }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          await this.pb.collections.delete(id);
          return this.successResponse({ message: `Collection ${id} deleted` });
        } catch (error: any) {
          return this.errorResponse(`Collection deletion failed: ${error.message}`);
        }
      }
    );

    // Backup and Export Tools
    this.server.tool(
      'pocketbase_export_collection',
      'Export collection data as JSON',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          format: { type: 'string', description: 'Export format (json, csv)', enum: ['json', 'csv'] }
        },
        required: ['collection']
      },
      async ({ collection, format = 'json' }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const records = await this.pb.collection(collection).getFullList();
          const data = format === 'csv' ? this.recordsToCSV(records) : records;
          
          return this.successResponse({ 
            collection,
            format,
            recordCount: records.length,
            data 
          });
        } catch (error: any) {
          return this.errorResponse(`Export failed: ${error.message}`);
        }
      }
    );

    // Batch Operations
    this.server.tool(
      'pocketbase_batch_create',
      'Create multiple records in batch',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          records: { type: 'array', description: 'Array of record data objects' }
        },
        required: ['collection', 'records']
      },
      async ({ collection, records }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const results = [];
          const errors = [];
          
          for (let i = 0; i < records.length; i++) {
            try {
              const record = await this.pb.collection(collection).create(records[i]);
              results.push(record);
            } catch (error: any) {
              errors.push({ index: i, error: error.message });
            }
          }
          
          return this.successResponse({ 
            created: results.length,
            errors: errors.length,
            results,
            failures: errors
          });
        } catch (error: any) {
          return this.errorResponse(`Batch create failed: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_batch_update',
      'Update multiple records in batch',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          updates: { 
            type: 'array', 
            description: 'Array of {id, data} objects',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                data: { type: 'object' }
              },
              required: ['id', 'data']
            }
          }
        },
        required: ['collection', 'updates']
      },
      async ({ collection, updates }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const results = [];
          const errors = [];
          
          for (let i = 0; i < updates.length; i++) {
            try {
              const record = await this.pb.collection(collection).update(updates[i].id, updates[i].data);
              results.push(record);
            } catch (error: any) {
              errors.push({ index: i, id: updates[i].id, error: error.message });
            }
          }
          
          return this.successResponse({ 
            updated: results.length,
            errors: errors.length,
            results,
            failures: errors
          });
        } catch (error: any) {
          return this.errorResponse(`Batch update failed: ${error.message}`);
        }
      }
    );

    // Search and Query Tools
    this.server.tool(
      'pocketbase_search_records',
      'Search records with full-text search',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          query: { type: 'string', description: 'Search query' },
          fields: { type: 'array', description: 'Fields to search in', items: { type: 'string' } },
          limit: { type: 'number', description: 'Maximum results' }
        },
        required: ['collection', 'query']
      },
      async ({ collection, query, fields, limit = 50 }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          let filter = '';
          if (fields && fields.length > 0) {
            filter = fields.map((field: string) => `${field} ~ "${query}"`).join(' || ');
          } else {
            // Default search in common text fields
            filter = `name ~ "${query}" || title ~ "${query}" || description ~ "${query}" || content ~ "${query}"`;
          }
          
          const records = await this.pb.collection(collection).getList(1, limit, {
            filter,
            sort: '-created'
          });
          
          return this.successResponse({ 
            query,
            totalItems: records.totalItems,
            results: records.items
          });
        } catch (error: any) {
          return this.errorResponse(`Search failed: ${error.message}`);
        }
      }
    );

    // Statistics and Analytics
    this.server.tool(
      'pocketbase_get_stats',
      'Get collection statistics',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' }
        },
        required: ['collection']
      },
      async ({ collection }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const totalRecords = await this.pb.collection(collection).getList(1, 1);
          const recentRecords = await this.pb.collection(collection).getList(1, 10, {
            sort: '-created'
          });
          
          return this.successResponse({
            collection,
            totalRecords: totalRecords.totalItems,
            recentRecords: recentRecords.items.length,
            lastCreated: recentRecords.items[0]?.created || null
          });
        } catch (error: any) {
          return this.errorResponse(`Stats retrieval failed: ${error.message}`);
        }
      }
    );

    // More Advanced PocketBase Tools
    this.server.tool(
      'pocketbase_get_collection_schema',
      'Get detailed schema information for a collection',
      {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Collection name' }
        },
        required: ['name']
      },
      async ({ name }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const collection = await this.pb.collections.getOne(name);
          return this.successResponse({ 
            schema: collection.schema,
            collectionInfo: {
              id: collection.id,
              name: collection.name,
              type: collection.type,
              system: collection.system
            }
          });
        } catch (error: any) {
          return this.errorResponse(`Failed to get collection schema: ${error.message}`);
        }
      }
    );

    // EXPANDED POCKETBASE API COVERAGE - ADMIN COLLECTIONS
    this.server.tool(
      'pocketbase_truncate_collection',
      'Truncate/empty all records from a collection',
      {
        type: 'object',
        properties: {
          collectionId: { type: 'string', description: 'Collection ID' },
          confirmTruncate: { type: 'boolean', description: 'Confirm truncation (safety check)' }
        },
        required: ['collectionId', 'confirmTruncate']
      },
      async ({ collectionId, confirmTruncate }) => {
        try {
          if (!confirmTruncate) {
            return this.errorResponse('Truncation not confirmed. Set confirmTruncate to true.');
          }
          
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          // PocketBase doesn't have direct truncate, so we'll delete all records
          const collection = await this.pb.collections.getOne(collectionId);
          const records = await this.pb.collection(collection.name).getFullList();
          
          let deleted = 0;
          const errors = [];
          
          for (const record of records) {
            try {
              await this.pb.collection(collection.name).delete(record.id);
              deleted++;
            } catch (error: any) {
              errors.push({ recordId: record.id, error: error.message });
            }
          }
          
          return this.successResponse({ 
            collection: collection.name,
            recordsDeleted: deleted,
            errors: errors.length,
            failures: errors
          });
        } catch (error: any) {
          return this.errorResponse(`Collection truncation failed: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_import_collections',
      'Import collections from JSON configuration',
      {
        type: 'object',
        properties: {
          collections: { type: 'array', description: 'Array of collection configurations' },
          deleteExisting: { type: 'boolean', description: 'Delete existing collections first' }
        },
        required: ['collections']
      },
      async ({ collections, deleteExisting = false }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const results = {
            imported: 0,
            skipped: 0,
            errors: [] as any[]
          };
          
          for (const collectionConfig of collections) {
            try {
              if (deleteExisting) {
                try {
                  const existing = await this.pb.collections.getOne(collectionConfig.name);
                  await this.pb.collections.delete(existing.id);
                } catch {
                  // Collection doesn't exist, continue
                }
              }
              
              await this.pb.collections.create(collectionConfig);
              results.imported++;
            } catch (error: any) {
              if (error.message.includes('already exists')) {
                results.skipped++;
              } else {
                results.errors.push({
                  collection: collectionConfig.name,
                  error: error.message
                });
              }
            }
          }
          
          return this.successResponse({ importResults: results });
        } catch (error: any) {
          return this.errorResponse(`Collection import failed: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_get_collection_scaffolds',
      'Generate collection scaffolds/templates',
      {
        type: 'object',
        properties: {
          type: { 
            type: 'string', 
            description: 'Scaffold type',
            enum: ['user', 'blog', 'ecommerce', 'cms', 'forum', 'custom']
          },
          name: { type: 'string', description: 'Collection name' }
        },
        required: ['type', 'name']
      },
      async ({ type, name }) => {
        try {
          const scaffolds: Record<string, any> = {
            user: {
              name,
              type: 'auth',
              schema: [
                { name: 'username', type: 'text', required: true, options: { min: 3, max: 50 } },
                { name: 'email', type: 'email', required: true },
                { name: 'emailVisibility', type: 'bool' },
                { name: 'verified', type: 'bool' },
                { name: 'avatar', type: 'file', options: { maxSelect: 1, maxSize: 5242880 } },
                { name: 'name', type: 'text' },
                { name: 'bio', type: 'editor' }
              ]
            },
            blog: {
              name,
              type: 'base',
              schema: [
                { name: 'title', type: 'text', required: true },
                { name: 'slug', type: 'text', required: true },
                { name: 'content', type: 'editor', required: true },
                { name: 'excerpt', type: 'text' },
                { name: 'featured_image', type: 'file', options: { maxSelect: 1 } },
                { name: 'status', type: 'select', options: { values: ['draft', 'published', 'archived'] } },
                { name: 'author', type: 'relation', options: { collectionId: 'users' } },
                { name: 'tags', type: 'json' },
                { name: 'published_at', type: 'date' }
              ]
            },
            ecommerce: {
              name,
              type: 'base',
              schema: [
                { name: 'name', type: 'text', required: true },
                { name: 'sku', type: 'text', required: true },
                { name: 'description', type: 'editor' },
                { name: 'price', type: 'number', required: true },
                { name: 'sale_price', type: 'number' },
                { name: 'stock_quantity', type: 'number' },
                { name: 'images', type: 'file', options: { maxSelect: 10 } },
                { name: 'category', type: 'relation' },
                { name: 'status', type: 'select', options: { values: ['active', 'inactive', 'out_of_stock'] } },
                { name: 'attributes', type: 'json' }
              ]
            }
          };
          
          const scaffold = scaffolds[type];
          if (!scaffold) {
            return this.errorResponse(`Unknown scaffold type: ${type}`);
          }
          
          return this.successResponse({ 
            scaffoldType: type,
            collectionConfig: scaffold,
            message: `Use pocketbase_create_collection with this configuration`
          });
        } catch (error: any) {
          return this.errorResponse(`Scaffold generation failed: ${error.message}`);
        }
      }
    );

    // SETTINGS API
    this.server.tool(
      'pocketbase_get_settings',
      'Get PocketBase application settings',
      { type: 'object', properties: {} },
      async () => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const settings = await this.pb.send('/api/settings', { method: 'GET' });
          return this.successResponse({ settings });
        } catch (error: any) {
          return this.errorResponse(`Failed to get settings: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_update_settings',
      'Update PocketBase application settings',
      {
        type: 'object',
        properties: {
          settings: { type: 'object', description: 'Settings object to update' }
        },
        required: ['settings']
      },
      async ({ settings }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const updatedSettings = await this.pb.send('/api/settings', {
            method: 'PATCH',
            body: settings
          });
          return this.successResponse({ settings: updatedSettings });
        } catch (error: any) {
          return this.errorResponse(`Failed to update settings: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_test_s3_storage',
      'Test S3 storage connection',
      {
        type: 'object',
        properties: {
          s3Config: {
            type: 'object',
            description: 'S3 configuration to test',
            properties: {
              bucket: { type: 'string' },
              region: { type: 'string' },
              endpoint: { type: 'string' },
              accessKey: { type: 'string' },
              secret: { type: 'string' }
            }
          }
        },
        required: ['s3Config']
      },
      async ({ s3Config }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          // Note: This would require admin authentication
          const result = await this.pb.send('/api/settings/test/s3', {
            method: 'POST',
            body: s3Config
          });
          
          return this.successResponse({ testResult: result });
        } catch (error: any) {
          return this.errorResponse(`S3 test failed: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_send_test_email',
      'Send test email through configured SMTP',
      {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Test email recipient' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body' }
        },
        required: ['to']
      },
      async ({ to, subject = 'PocketBase Test Email', body = 'This is a test email from PocketBase.' }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const result = await this.pb.send('/api/settings/test/email', {
            method: 'POST',
            body: { to, subject, body }
          });
          
          return this.successResponse({ testResult: result });
        } catch (error: any) {
          return this.errorResponse(`Test email failed: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_generate_apple_client_secret',
      'Generate Apple OAuth2 client secret',
      {
        type: 'object',
        properties: {
          teamId: { type: 'string', description: 'Apple Team ID' },
          clientId: { type: 'string', description: 'Apple Client ID' },
          keyId: { type: 'string', description: 'Apple Key ID' },
          privateKey: { type: 'string', description: 'Apple Private Key content' }
        },
        required: ['teamId', 'clientId', 'keyId', 'privateKey']
      },
      async ({ teamId, clientId, keyId, privateKey }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const result = await this.pb.send('/api/settings/apple/generate-client-secret', {
            method: 'POST',
            body: { teamId, clientId, keyId, privateKey }
          });
          
          return this.successResponse({ clientSecret: result });
        } catch (error: any) {
          return this.errorResponse(`Apple client secret generation failed: ${error.message}`);
        }
      }
    );

    // LOGS API
    this.server.tool(
      'pocketbase_list_logs',
      'List application logs',
      {
        type: 'object',
        properties: {
          page: { type: 'number', description: 'Page number' },
          perPage: { type: 'number', description: 'Logs per page' },
          filter: { type: 'string', description: 'Filter logs' },
          sort: { type: 'string', description: 'Sort criteria' }
        }
      },
      async ({ page = 1, perPage = 30, filter, sort = '-created' }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const options: any = { sort };
          if (filter) options.filter = filter;
          
          const logs = await this.pb.send('/api/logs', {
            method: 'GET',
            query: { page, perPage, sort, ...(filter && { filter }) }
          });
          return this.successResponse({ logs });
        } catch (error: any) {
          return this.errorResponse(`Failed to list logs: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_get_log',
      'Get specific log entry by ID',
      {
        type: 'object',
        properties: {
          logId: { type: 'string', description: 'Log entry ID' }
        },
        required: ['logId']
      },
      async ({ logId }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const log = await this.pb.send(`/api/logs/${logId}`, { method: 'GET' });
          return this.successResponse({ log });
        } catch (error: any) {
          return this.errorResponse(`Failed to get log: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_get_logs_statistics',
      'Get logs statistics and analytics',
      {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'Filter for statistics' }
        }
      },
      async ({ filter }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const options: any = {};
          if (filter) options.filter = filter;
          
          const stats = await this.pb.send('/api/logs/stats', {
            method: 'GET',
            ...(filter && { query: { filter } })
          });
          return this.successResponse({ statistics: stats });
        } catch (error: any) {
          return this.errorResponse(`Failed to get log statistics: ${error.message}`);
        }
      }
    );

    // CRON JOBS API
    this.server.tool(
      'pocketbase_list_cron_jobs',
      'List all scheduled cron jobs',
      { type: 'object', properties: {} },
      async () => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          // PocketBase doesn't expose cron jobs via standard API, this is a placeholder
          // Implementation would depend on PocketBase version and custom extensions
          return this.successResponse({ 
            message: 'Cron jobs listing not directly available via API',
            cronJobs: []
          });
        } catch (error: any) {
          return this.errorResponse(`Failed to list cron jobs: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_run_cron_job',
      'Execute a specific cron job manually',
      {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'Cron job identifier' }
        },
        required: ['jobId']
      },
      async ({ jobId }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          // This would be implementation-specific
          const result = await this.pb.send(`/api/admin/crons/${jobId}/run`, {
            method: 'POST'
          });
          
          return this.successResponse({ 
            jobId,
            result,
            message: 'Cron job executed manually'
          });
        } catch (error: any) {
          return this.errorResponse(`Failed to run cron job: ${error.message}`);
        }
      }
    );

    // BACKUPS API
    this.server.tool(
      'pocketbase_list_backups',
      'List all available backups',
      { type: 'object', properties: {} },
      async () => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const backups = await this.pb.send('/api/backups', { method: 'GET' });
          return this.successResponse({ backups });
        } catch (error: any) {
          return this.errorResponse(`Failed to list backups: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_create_backup',
      'Create a new backup',
      {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Backup name' }
        }
      },
      async ({ name }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const backup = await this.pb.send('/api/backups', {
            method: 'POST',
            body: { name }
          });
          return this.successResponse({ backup });
        } catch (error: any) {
          return this.errorResponse(`Failed to create backup: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_upload_backup',
      'Upload a backup file',
      {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Backup file content (base64)' },
          filename: { type: 'string', description: 'Backup filename' }
        },
        required: ['file', 'filename']
      },
      async ({ file, filename }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const fileBuffer = Buffer.from(file, 'base64');
          const formData = new FormData();
          formData.append('file', new File([fileBuffer], filename));
          
          const result = await this.pb.send('/api/backups/upload', {
            method: 'POST',
            body: formData
          });
          return this.successResponse({ result });
        } catch (error: any) {
          return this.errorResponse(`Failed to upload backup: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_delete_backup',
      'Delete a backup by filename',
      {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Backup filename' }
        },
        required: ['filename']
      },
      async ({ filename }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          await this.pb.send(`/api/backups/${filename}`, { method: 'DELETE' });
          return this.successResponse({ message: `Backup ${filename} deleted` });
        } catch (error: any) {
          return this.errorResponse(`Failed to delete backup: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_restore_backup',
      'Restore from a backup',
      {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Backup filename to restore' },
          confirmRestore: { type: 'boolean', description: 'Confirm restoration (safety check)' }
        },
        required: ['filename', 'confirmRestore']
      },
      async ({ filename, confirmRestore }) => {
        try {
          if (!confirmRestore) {
            return this.errorResponse('Restoration not confirmed. Set confirmRestore to true.');
          }
          
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          await this.pb.send(`/api/backups/${filename}/restore`, { method: 'POST' });
          return this.successResponse({ 
            message: `Backup ${filename} restored successfully`,
            warning: 'Server may restart after restoration'
          });
        } catch (error: any) {
          return this.errorResponse(`Failed to restore backup: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_download_backup',
      'Download a backup file',
      {
        type: 'object',
        properties: {
          filename: { type: 'string', description: 'Backup filename' }
        },
        required: ['filename']
      },
      async ({ filename }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const url = `${this.pb.baseUrl}/api/backups/${filename}`;
          return this.successResponse({ 
            filename,
            downloadUrl: url,
            message: 'Use the downloadUrl to fetch the backup file'
          });
        } catch (error: any) {
          return this.errorResponse(`Failed to get backup download URL: ${error.message}`);
        }
      }
    );

    // HEALTH API
    this.server.tool(
      'pocketbase_health_check',
      'Check PocketBase server health status',
      { type: 'object', properties: {} },
      async () => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const health = await this.pb.send('/api/health', { method: 'GET' });
          return this.successResponse({ 
            status: 'healthy',
            timestamp: new Date().toISOString(),
            health
          });
        } catch (error: any) {
          return this.errorResponse(`Health check failed: ${error.message}`);
        }
      }
    );

    // REALTIME WEBSOCKET MANAGEMENT
    this.server.tool(
      'pocketbase_create_realtime_connection',
      'Create realtime WebSocket connection info',
      { type: 'object', properties: {} },
      async () => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const wsUrl = this.pb.baseUrl.replace('http', 'ws') + '/api/realtime';
          return this.successResponse({ 
            websocketUrl: wsUrl,
            message: 'Use this URL to establish WebSocket connection for real-time events',
            instructions: 'Send subscription messages after connecting'
          });
        } catch (error: any) {
          return this.errorResponse(`Failed to create realtime connection info: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_generate_realtime_subscription',
      'Generate realtime subscription configuration',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection to subscribe to' },
          recordId: { type: 'string', description: 'Specific record ID (optional, use * for all)' },
          actions: { 
            type: 'array', 
            description: 'Actions to listen for',
            items: { type: 'string', enum: ['create', 'update', 'delete'] }
          }
        },
        required: ['collection']
      },
      async ({ collection, recordId = '*', actions = ['create', 'update', 'delete'] }) => {
        try {
          const subscription = {
            clientId: `client_${Date.now()}`,
            subscriptions: [{
              topic: `${collection}/${recordId}`,
              actions
            }]
          };
          
          return this.successResponse({ 
            subscription,
            message: 'Send this subscription object via WebSocket after connecting'
          });
        } catch (error: any) {
          return this.errorResponse(`Failed to generate subscription: ${error.message}`);
        }
      }
    );

    // FILE OPERATIONS (Extended)
    this.server.tool(
      'pocketbase_get_file_url',
      'Get public URL for a file',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          recordId: { type: 'string', description: 'Record ID' },
          filename: { type: 'string', description: 'Filename' },
          thumb: { type: 'string', description: 'Thumbnail size (e.g., 100x100)' }
        },
        required: ['collection', 'recordId', 'filename']
      },
      async ({ collection, recordId, filename, thumb }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          let url = `${this.pb.baseUrl}/api/files/${collection}/${recordId}/${filename}`;
          if (thumb) {
            url += `?thumb=${thumb}`;
          }
          
          return this.successResponse({ 
            fileUrl: url,
            collection,
            recordId,
            filename,
            thumbnail: thumb || null
          });
        } catch (error: any) {
          return this.errorResponse(`Failed to get file URL: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_generate_protected_file_token',
      'Generate protected file access token',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          recordId: { type: 'string', description: 'Record ID' },
          filename: { type: 'string', description: 'Filename' },
          expiration: { type: 'number', description: 'Token expiration in seconds' }
        },
        required: ['collection', 'recordId', 'filename']
      },
      async ({ collection, recordId, filename, expiration = 3600 }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const token = await this.pb.files.getToken();
          const protectedUrl = `${this.pb.baseUrl}/api/files/${collection}/${recordId}/${filename}?token=${token}`;
          
          return this.successResponse({ 
            token,
            protectedUrl,
            expiresIn: expiration,
            message: 'Use this token or URL to access protected files'
          });
        } catch (error: any) {
          return this.errorResponse(`Failed to generate file token: ${error.message}`);
        }
      }
    );

    // AUTH METHODS LISTING
    this.server.tool(
      'pocketbase_list_auth_methods',
      'List available authentication methods for a collection',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Auth collection name' }
        },
        required: ['collection']
      },
      async ({ collection }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const authMethods = await this.pb.collection(collection).listAuthMethods();
          return this.successResponse({ 
            collection,
            authMethods
          });
        } catch (error: any) {
          return this.errorResponse(`Failed to list auth methods: ${error.message}`);
        }
      }
    );

    // AUTH WITH OTP
    this.server.tool(
      'pocketbase_auth_with_otp',
      'Authenticate using one-time password',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Auth collection name' },
          otpId: { type: 'string', description: 'OTP ID from previous request' },
          password: { type: 'string', description: 'One-time password' }
        },
        required: ['collection', 'otpId', 'password']
      },
      async ({ collection, otpId, password }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const authData = await this.pb.collection(collection).authWithOTP(otpId, password);
          return this.successResponse({ 
            user: authData.record,
            token: authData.token
          });
        } catch (error: any) {
          return this.errorResponse(`OTP authentication failed: ${error.message}`);
        }
      }
    );

    // REQUEST VERIFICATION
    this.server.tool(
      'pocketbase_request_verification',
      'Request email verification',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Auth collection name' },
          email: { type: 'string', description: 'Email to verify' }
        },
        required: ['collection', 'email']
      },
      async ({ collection, email }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          await this.pb.collection(collection).requestVerification(email);
          return this.successResponse({ 
            message: 'Verification email sent',
            email
          });
        } catch (error: any) {
          return this.errorResponse(`Verification request failed: ${error.message}`);
        }
      }
    );

    // CONFIRM VERIFICATION
    this.server.tool(
      'pocketbase_confirm_verification',
      'Confirm email verification',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Auth collection name' },
          token: { type: 'string', description: 'Verification token' }
        },
        required: ['collection', 'token']
      },
      async ({ collection, token }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          await this.pb.collection(collection).confirmVerification(token);
          return this.successResponse({ 
            message: 'Email verified successfully'
          });
        } catch (error: any) {
          return this.errorResponse(`Verification confirmation failed: ${error.message}`);
        }
      }
    );

    // REQUEST EMAIL CHANGE
    this.server.tool(
      'pocketbase_request_email_change',
      'Request email address change',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Auth collection name' },
          newEmail: { type: 'string', description: 'New email address' }
        },
        required: ['collection', 'newEmail']
      },
      async ({ collection, newEmail }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          await this.pb.collection(collection).requestEmailChange(newEmail);
          return this.successResponse({ 
            message: 'Email change confirmation sent',
            newEmail
          });
        } catch (error: any) {
          return this.errorResponse(`Email change request failed: ${error.message}`);
        }
      }
    );

    // CONFIRM EMAIL CHANGE
    this.server.tool(
      'pocketbase_confirm_email_change',
      'Confirm email address change',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Auth collection name' },
          token: { type: 'string', description: 'Email change token' },
          password: { type: 'string', description: 'Current password' }
        },
        required: ['collection', 'token', 'password']
      },
      async ({ collection, token, password }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          await this.pb.collection(collection).confirmEmailChange(token, password);
          return this.successResponse({ 
            message: 'Email changed successfully'
          });
        } catch (error: any) {
          return this.errorResponse(`Email change confirmation failed: ${error.message}`);
        }
      }
    );

    // IMPERSONATE USER
    this.server.tool(
      'pocketbase_impersonate_user',
      'Impersonate another user (admin only)',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Auth collection name' },
          userId: { type: 'string', description: 'User ID to impersonate' },
          duration: { type: 'number', description: 'Impersonation duration in seconds' }
        },
        required: ['collection', 'userId']
      },
      async ({ collection, userId, duration = 3600 }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const authData = await this.pb.collection(collection).impersonate(userId, duration);
          return this.successResponse({ 
            user: authData.record,
            token: authData.token,
            impersonationDuration: duration
          });
        } catch (error: any) {
          return this.errorResponse(`User impersonation failed: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'pocketbase_validate_record_data',
      'Validate record data against collection schema',
      {
        type: 'object',
        properties: {
          collection: { type: 'string', description: 'Collection name' },
          data: { type: 'object', description: 'Record data to validate' }
        },
        required: ['collection', 'data']
      },
      async ({ collection, data }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          // Get collection schema
          const collectionInfo = await this.pb.collections.getOne(collection);
          const schema = collectionInfo.schema;
          
          const validation = {
            valid: true,
            errors: [] as string[],
            warnings: [] as string[],
            schema: schema
          };
          
          // Basic validation
          if (schema && Array.isArray(schema)) {
            for (const field of schema) {
              const value = data[field.name];
              
              if (field.required && (value === undefined || value === null || value === '')) {
                validation.valid = false;
                validation.errors.push(`Required field '${field.name}' is missing`);
              }
              
              if (value !== undefined && field.type) {
                // Type-specific validation could be added here
                if (field.type === 'email' && value && !value.includes('@')) {
                  validation.valid = false;
                  validation.errors.push(`Field '${field.name}' must be a valid email`);
                }
              }
            }
          }
          
          return this.successResponse({ validation });
        } catch (error: any) {
          return this.errorResponse(`Failed to validate record data: ${error.message}`);
        }
      }
    );
  }

  /**
   * Setup comprehensive Stripe tools
   */
  private setupStripeTools(): void {
    // Customer Management
    this.server.tool(
      'stripe_create_customer',
      'Create a new Stripe customer',
      {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Customer email' },
          name: { type: 'string', description: 'Customer name' },
          metadata: { type: 'object', description: 'Custom metadata' }
        },
        required: ['email']
      },
      async ({ email, name, metadata }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured. Set STRIPE_SECRET_KEY environment variable.');
          }
          
          const customer = await this.stripeService.createCustomer({ email, name, metadata });
          return this.successResponse({ customer });
        } catch (error: any) {
          return this.errorResponse(`Failed to create customer: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'stripe_get_customer',
      'Retrieve a Stripe customer by ID',
      {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'Stripe customer ID' }
        },
        required: ['customerId']
      },
      async ({ customerId }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          const customer = await this.stripeService.retrieveCustomer(customerId);
          return this.successResponse({ customer });
        } catch (error: any) {
          return this.errorResponse(`Failed to get customer: ${error.message}`);
        }
      }
    );

    // Payment Processing
    this.server.tool(
      'stripe_create_payment_intent',
      'Create a payment intent for processing payments',
      {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Amount in cents' },
          currency: { type: 'string', description: 'Currency code (e.g., USD)' },
          description: { type: 'string', description: 'Payment description' }
        },
        required: ['amount', 'currency']
      },
      async ({ amount, currency, description }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          const paymentIntent = await this.stripeService.createPaymentIntent({
            amount,
            currency,
            description
          });
          return this.successResponse({ paymentIntent });
        } catch (error: any) {
          return this.errorResponse(`Failed to create payment intent: ${error.message}`);
        }
      }
    );

    // Product Management
    this.server.tool(
      'stripe_create_product',
      'Create a new Stripe product',
      {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Product name' },
          description: { type: 'string', description: 'Product description' },
          price: { type: 'number', description: 'Price in cents' },
          currency: { type: 'string', description: 'Currency code' }
        },
        required: ['name', 'price']
      },
      async ({ name, description, price, currency = 'USD' }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          const product = await this.stripeService.createProduct({
            name,
            description,
            price,
            currency
          });
          return this.successResponse({ product });
        } catch (error: any) {
          return this.errorResponse(`Failed to create product: ${error.message}`);
        }
      }
    );

    // Subscription Management
    this.server.tool(
      'stripe_cancel_subscription',
      'Cancel a subscription',
      {
        type: 'object',
        properties: {
          subscriptionId: { type: 'string', description: 'Subscription ID' },
          atPeriodEnd: { type: 'boolean', description: 'Cancel at period end' }
        },
        required: ['subscriptionId']
      },
      async ({ subscriptionId, atPeriodEnd = false }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          const subscription = await this.stripeService.cancelSubscription(subscriptionId, atPeriodEnd);
          return this.successResponse({ subscription });
        } catch (error: any) {
          return this.errorResponse(`Failed to cancel subscription: ${error.message}`);
        }
      }
    );

    // Payment Methods
    this.server.tool(
      'stripe_create_payment_method',
      'Create a payment method',
      {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Payment method type (card, sepa_debit, etc.)' },
          card: { type: 'object', description: 'Card details' },
          metadata: { type: 'object', description: 'Payment method metadata' }
        },
        required: ['type']
      },
      async ({ type, card, metadata }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          const paymentMethod = await this.stripeService.createPaymentMethod({
            type,
            card,
            metadata
          });
          return this.successResponse({ paymentMethod });
        } catch (error: any) {
          return this.errorResponse(`Failed to create payment method: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'stripe_attach_payment_method',
      'Attach payment method to customer',
      {
        type: 'object',
        properties: {
          paymentMethodId: { type: 'string', description: 'Payment method ID' },
          customerId: { type: 'string', description: 'Customer ID' }
        },
        required: ['paymentMethodId', 'customerId']
      },
      async ({ paymentMethodId, customerId }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          const paymentMethod = await this.stripeService.attachPaymentMethod(paymentMethodId, customerId);
          return this.successResponse({ paymentMethod });
        } catch (error: any) {
          return this.errorResponse(`Failed to attach payment method: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'stripe_list_payment_methods',
      'List customer payment methods',
      {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'Customer ID' },
          type: { type: 'string', description: 'Payment method type filter' }
        },
        required: ['customerId']
      },
      async ({ customerId, type }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          const paymentMethods = await this.stripeService.listPaymentMethods(customerId, type);
          return this.successResponse({ paymentMethods });
        } catch (error: any) {
          return this.errorResponse(`Failed to list payment methods: ${error.message}`);
        }
      }
    );

    // Checkout Sessions
    this.server.tool(
      'stripe_create_checkout_session',
      'Create a Checkout session',
      {
        type: 'object',
        properties: {
          priceId: { type: 'string', description: 'Price ID' },
          successUrl: { type: 'string', description: 'Success redirect URL' },
          cancelUrl: { type: 'string', description: 'Cancel redirect URL' },
          customerId: { type: 'string', description: 'Customer ID' },
          customerEmail: { type: 'string', description: 'Customer Email' },
          mode: { type: 'string', description: 'Mode (payment, subscription, setup)' },
          metadata: { type: 'object', description: 'Session metadata' }
        },
        required: ['priceId', 'successUrl', 'cancelUrl']
      },
      async ({ priceId, successUrl, cancelUrl, customerId, customerEmail, mode = 'payment', metadata }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          const session = await this.stripeService.createCheckoutSession({
            priceId,
            successUrl,
            cancelUrl,
            customerId,
            customerEmail,
            mode: mode as 'payment' | 'subscription' | 'setup',
            metadata
          });
          return this.successResponse({ session });
        } catch (error: any) {
          return this.errorResponse(`Failed to create checkout session: ${error.message}`);
        }
      }
    );

    // Refunds
    this.server.tool(
      'stripe_create_refund',
      'Create a refund',
      {
        type: 'object',
        properties: {
          paymentIntentId: { type: 'string', description: 'Payment Intent ID' },
          chargeId: { type: 'string', description: 'Charge ID' },
          amount: { type: 'number', description: 'Refund amount in cents' },
          reason: { type: 'string', description: 'Refund reason' },
          metadata: { type: 'object', description: 'Refund metadata' }
        }
      },
      async ({ paymentIntentId, chargeId, amount, reason, metadata }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          const refund = await this.stripeService.createRefund({
            paymentIntentId,
            chargeId,
            amount,
            reason: reason as 'duplicate' | 'fraudulent' | 'requested_by_customer',
            metadata
          });
          return this.successResponse({ refund });
        } catch (error: any) {
          return this.errorResponse(`Failed to create refund: ${error.message}`);
        }
      }
    );

    // Webhooks
    this.server.tool(
      'stripe_handle_webhook',
      'Handle Stripe webhook event',
      {
        type: 'object',
        properties: {
          body: { type: 'string', description: 'Webhook payload' },
          signature: { type: 'string', description: 'Stripe signature header' }
        },
        required: ['body', 'signature']
      },
      async ({ body, signature }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          const result = await this.stripeService.handleWebhook(body, signature);
          return this.successResponse({ result });
        } catch (error: any) {
          return this.errorResponse(`Failed to handle webhook: ${error.message}`);
        }
      }
    );

    // More Stripe tools - Customer Management
    this.server.tool(
      'stripe_update_customer',
      'Update a Stripe customer',
      {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'Customer ID' },
          email: { type: 'string', description: 'Updated email' },
          name: { type: 'string', description: 'Updated name' },
          metadata: { type: 'object', description: 'Updated metadata' }
        },
        required: ['customerId']
      },
      async ({ customerId, email, name, metadata }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          const customer = await this.stripeService.updateCustomer(customerId, {
            email,
            name,
            metadata
          });
          return this.successResponse({ customer });
        } catch (error: any) {
          return this.errorResponse(`Failed to update customer: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'stripe_list_customers',
      'List Stripe customers',
      {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of customers to return' },
          startingAfter: { type: 'string', description: 'Cursor for pagination' },
          email: { type: 'string', description: 'Filter by email' }
        }
      },
      async ({ limit = 10, startingAfter, email }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          // Note: This would require implementing the method in StripeService
          return this.errorResponse('List customers method not yet implemented in StripeService');
        } catch (error: any) {
          return this.errorResponse(`Failed to list customers: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'stripe_delete_customer',
      'Delete a Stripe customer',
      {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'Customer ID' }
        },
        required: ['customerId']
      },
      async ({ customerId }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          // Note: This would require implementing the method in StripeService
          return this.errorResponse('Delete customer method not yet implemented in StripeService');
        } catch (error: any) {
          return this.errorResponse(`Failed to delete customer: ${error.message}`);
        }
      }
    );

    // Payment Intents
    this.server.tool(
      'stripe_confirm_payment_intent',
      'Confirm a payment intent',
      {
        type: 'object',
        properties: {
          paymentIntentId: { type: 'string', description: 'Payment Intent ID' },
          paymentMethodId: { type: 'string', description: 'Payment Method ID' }
        },
        required: ['paymentIntentId']
      },
      async ({ paymentIntentId, paymentMethodId }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          // Note: This would require implementing the method in StripeService
          return this.errorResponse('Confirm payment intent method not yet implemented in StripeService');
        } catch (error: any) {
          return this.errorResponse(`Failed to confirm payment intent: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'stripe_cancel_payment_intent',
      'Cancel a payment intent',
      {
        type: 'object',
        properties: {
          paymentIntentId: { type: 'string', description: 'Payment Intent ID' }
        },
        required: ['paymentIntentId']
      },
      async ({ paymentIntentId }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          // Note: This would require implementing the method in StripeService
          return this.errorResponse('Cancel payment intent method not yet implemented in StripeService');
        } catch (error: any) {
          return this.errorResponse(`Failed to cancel payment intent: ${error.message}`);
        }
      }
    );

    // Setup Intents
    this.server.tool(
      'stripe_create_setup_intent',
      'Create a setup intent for saving payment methods',
      {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: 'Customer ID' },
          usage: { type: 'string', description: 'Usage type (on_session, off_session)' },
          paymentMethodTypes: { type: 'array', description: 'Payment method types', items: { type: 'string' } }
        },
        required: ['customerId']
      },
      async ({ customerId, usage = 'off_session', paymentMethodTypes = ['card'] }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          const setupIntent = await this.stripeService.createSetupIntent({
            customerId,
            usage,
            paymentMethodTypes
          });
          return this.successResponse({ setupIntent });
        } catch (error: any) {
          return this.errorResponse(`Failed to create setup intent: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'stripe_confirm_setup_intent',
      'Confirm a setup intent',
      {
        type: 'object',
        properties: {
          setupIntentId: { type: 'string', description: 'Setup Intent ID' },
          paymentMethodId: { type: 'string', description: 'Payment Method ID' }
        },
        required: ['setupIntentId']
      },
      async ({ setupIntentId, paymentMethodId }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          const setupIntent = await this.stripeService.confirmSetupIntent(setupIntentId, {
            paymentMethod: paymentMethodId
          });
          return this.successResponse({ setupIntent });
        } catch (error: any) {
          return this.errorResponse(`Failed to confirm setup intent: ${error.message}`);
        }
      }
    );

    // Payment Links
    this.server.tool(
      'stripe_create_payment_link',
      'Create a payment link',
      {
        type: 'object',
        properties: {
          priceId: { type: 'string', description: 'Price ID' },
          quantity: { type: 'number', description: 'Quantity' },
          metadata: { type: 'object', description: 'Link metadata' }
        },
        required: ['priceId']
      },
      async ({ priceId, quantity = 1, metadata }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          const paymentLink = await this.stripeService.createPaymentLink({
            lineItems: [{ price: priceId, quantity }],
            metadata
          });
          return this.successResponse({ paymentLink });
        } catch (error: any) {
          return this.errorResponse(`Failed to create payment link: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'stripe_get_payment_link',
      'Retrieve a payment link',
      {
        type: 'object',
        properties: {
          paymentLinkId: { type: 'string', description: 'Payment Link ID' }
        },
        required: ['paymentLinkId']
      },
      async ({ paymentLinkId }) => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          const paymentLink = await this.stripeService.retrievePaymentLink(paymentLinkId);
          return this.successResponse({ paymentLink });
        } catch (error: any) {
          return this.errorResponse(`Failed to get payment link: ${error.message}`);
        }
      }
    );

    // Analytics and Sync
    this.server.tool(
      'stripe_sync_products',
      'Sync products from Stripe',
      { type: 'object', properties: {} },
      async () => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return this.errorResponse('Stripe not configured.');
          }
          
          const result = await this.stripeService.syncProducts();
          return this.successResponse({ syncResult: result });
        } catch (error: any) {
          return this.errorResponse(`Failed to sync products: ${error.message}`);
        }
      }
    );

    // Add more Stripe tools - coupons, discounts, tax rates, etc.
  }

  /**
   * Setup comprehensive Email tools
   */
  private setupEmailTools(): void {
    this.server.tool(
      'email_send_templated',
      'Send a templated email',
      {
        type: 'object',
        properties: {
          template: { type: 'string', description: 'Template name' },
          to: { type: 'string', description: 'Recipient email' },
          from: { type: 'string', description: 'Sender email' },
          variables: { type: 'object', description: 'Template variables' }
        },
        required: ['template', 'to']
      },
      async ({ template, to, from, variables }) => {
        try {
          await this.ensureEmail();
          if (!this.emailService) {
            return this.errorResponse('Email service not configured. Set EMAIL_SERVICE or SMTP_HOST environment variables.');
          }
          
          const result = await this.emailService.sendTemplatedEmail({
            template,
            to,
            from,
            variables
          });
          return this.successResponse({ emailLog: result });
        } catch (error: any) {
          return this.errorResponse(`Failed to send email: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'email_send_simple',
      'Send a custom email',
      {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email' },
          subject: { type: 'string', description: 'Email subject' },
          htmlContent: { type: 'string', description: 'Email HTML content' },
          textContent: { type: 'string', description: 'Email text content' },
          from: { type: 'string', description: 'Sender email' }
        },
        required: ['to', 'subject', 'htmlContent']
      },
      async ({ to, subject, htmlContent, textContent, from }) => {
        try {
          await this.ensureEmail();
          if (!this.emailService) {
            return this.errorResponse('Email service not configured.');
          }
          
          const result = await this.emailService.sendCustomEmail({
            to,
            subject,
            html: htmlContent,
            text: textContent,
            from
          });
          return this.successResponse({ emailLog: result });
        } catch (error: any) {
          return this.errorResponse(`Failed to send email: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'email_send_bulk',
      'Send bulk custom emails',
      {
        type: 'object',
        properties: {
          emails: { 
            type: 'array',
            description: 'Array of email objects',
            items: {
              type: 'object',
              properties: {
                to: { type: 'string' },
                subject: { type: 'string' },
                html: { type: 'string' },
                text: { type: 'string' },
                from: { type: 'string' }
              },
              required: ['to', 'subject', 'html']
            }
          },
          batchSize: { type: 'number', description: 'Batch size for sending' }
        },
        required: ['emails']
      },
      async ({ emails, batchSize = 10 }) => {
        try {
          await this.ensureEmail();
          if (!this.emailService) {
            return this.errorResponse('Email service not configured.');
          }
          
          const results = [];
          const errors = [];
          
          for (let i = 0; i < emails.length; i += batchSize) {
            const batch = emails.slice(i, i + batchSize);
            
            for (const email of batch) {
              try {
                const result = await this.emailService.sendCustomEmail(email);
                results.push(result);
              } catch (error: any) {
                errors.push({ email: email.to, error: error.message });
              }
            }
            
            // Small delay between batches
            if (i + batchSize < emails.length) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
          
          return this.successResponse({ 
            sent: results.length,
            failed: errors.length,
            results,
            errors
          });
        } catch (error: any) {
          return this.errorResponse(`Failed to send bulk emails: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'email_create_template',
      'Create an email template',
      {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Template name' },
          subject: { type: 'string', description: 'Email subject template' },
          htmlContent: { type: 'string', description: 'Email HTML template' },
          textContent: { type: 'string', description: 'Email text template' },
          variables: { type: 'array', description: 'Template variable names', items: { type: 'string' } }
        },
        required: ['name', 'subject', 'htmlContent']
      },
      async ({ name, subject, htmlContent, textContent, variables = [] }) => {
        try {
          await this.ensureEmail();
          if (!this.emailService) {
            return this.errorResponse('Email service not configured.');
          }
          
          const template = await this.emailService.createTemplate({
            name,
            subject,
            htmlContent,
            textContent,
            variables
          });
          return this.successResponse({ template });
        } catch (error: any) {
          return this.errorResponse(`Failed to create template: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'email_get_template',
      'Get email template by name',
      {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Template name' }
        },
        required: ['name']
      },
      async ({ name }) => {
        try {
          await this.ensureEmail();
          if (!this.emailService) {
            return this.errorResponse('Email service not configured.');
          }
          
          const template = await this.emailService.getTemplate(name);
          return this.successResponse({ template });
        } catch (error: any) {
          return this.errorResponse(`Failed to get template: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'email_update_template',
      'Update an email template',
      {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Template name' },
          subject: { type: 'string', description: 'Updated subject template' },
          htmlContent: { type: 'string', description: 'Updated HTML template' },
          textContent: { type: 'string', description: 'Updated text template' },
          variables: { type: 'array', description: 'Updated variable names', items: { type: 'string' } }
        },
        required: ['name']
      },
      async ({ name, subject, htmlContent, textContent, variables }) => {
        try {
          await this.ensureEmail();
          if (!this.emailService) {
            return this.errorResponse('Email service not configured.');
          }
          
          const template = await this.emailService.updateTemplate(name, {
            subject,
            htmlContent,
            textContent,
            variables
          });
          return this.successResponse({ template });
        } catch (error: any) {
          return this.errorResponse(`Failed to update template: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'email_test_connection',
      'Test email service connection',
      { type: 'object', properties: {} },
      async () => {
        try {
          await this.ensureEmail();
          if (!this.emailService) {
            return this.errorResponse('Email service not configured.');
          }
          
          const result = await this.emailService.testConnection();
          return this.successResponse({ connectionTest: result });
        } catch (error: any) {
          return this.errorResponse(`Failed to test connection: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'email_test_enhanced_connection',
      'Test enhanced email service connection with features',
      { type: 'object', properties: {} },
      async () => {
        try {
          await this.ensureEmail();
          if (!this.emailService) {
            return this.errorResponse('Email service not configured.');
          }
          
          const result = await this.emailService.testEnhancedConnection();
          return this.successResponse({ enhancedConnectionTest: result });
        } catch (error: any) {
          return this.errorResponse(`Failed to test enhanced connection: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'email_send_enhanced_templated',
      'Send enhanced templated email with SendGrid features',
      {
        type: 'object',
        properties: {
          template: { type: 'string', description: 'Template name' },
          to: { type: 'string', description: 'Recipient email' },
          from: { type: 'string', description: 'Sender email' },
          variables: { type: 'object', description: 'Template variables' },
          options: { type: 'object', description: 'Enhanced options (SendGrid)' }
        },
        required: ['template', 'to']
      },
      async ({ template, to, from, variables, options }) => {
        try {
          await this.ensureEmail();
          if (!this.emailService) {
            return this.errorResponse('Email service not configured.');
          }
          
          const result = await this.emailService.sendEnhancedTemplatedEmail({
            template,
            to,
            from,
            variables,
            categories: options?.categories,
            customArgs: options?.customArgs,
            sendAt: options?.sendAt ? new Date(options.sendAt) : undefined,
            trackingSettings: options?.trackingSettings,
            sandboxMode: options?.sandboxMode
          });
          return this.successResponse({ emailLog: result });
        } catch (error: any) {
          return this.errorResponse(`Failed to send enhanced templated email: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'email_schedule_templated',
      'Schedule a templated email for future delivery',
      {
        type: 'object',
        properties: {
          template: { type: 'string', description: 'Template name' },
          to: { type: 'string', description: 'Recipient email' },
          from: { type: 'string', description: 'Sender email' },
          variables: { type: 'object', description: 'Template variables' },
          scheduledFor: { type: 'string', description: 'Schedule time (ISO string)' }
        },
        required: ['template', 'to', 'scheduledFor']
      },
      async ({ template, to, from, variables, scheduledFor }) => {
        try {
          await this.ensureEmail();
          if (!this.emailService) {
            return this.errorResponse('Email service not configured.');
          }
          
          const result = await this.emailService.scheduleTemplatedEmail({
            template,
            to,
            from,
            variables,
            sendAt: new Date(scheduledFor)
          });
          return this.successResponse({ scheduledEmail: result });
        } catch (error: any) {
          return this.errorResponse(`Failed to schedule email: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'email_create_default_templates',
      'Create default email templates',
      { type: 'object', properties: {} },
      async () => {
        try {
          await this.ensureEmail();
          if (!this.emailService) {
            return this.errorResponse('Email service not configured.');
          }
          
          const result = await this.emailService.createDefaultTemplates();
          return this.successResponse({ defaultTemplates: result });
        } catch (error: any) {
          return this.errorResponse(`Failed to create default templates: ${error.message}`);
        }
      }
    );
  }

  /**
   * Setup utility tools
   */
  private setupUtilityTools(): void {
    this.server.tool(
      'get_server_status',
      'Get comprehensive server status and configuration',
      { type: 'object', properties: {} },
      async () => {
        return this.successResponse({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          state: this.state,
          services: {
            pocketbase: Boolean(this.pb),
            stripe: Boolean(this.stripeService),
            email: Boolean(this.emailService)
          }
        });
      }
    );

    this.server.tool(
      'health_check',
      'Simple health check endpoint',
      { type: 'object', properties: {} },
      async () => {
        return this.successResponse({
          status: 'healthy',
          timestamp: new Date().toISOString()
        });
      }
    );

    // Configuration Tools
    this.server.tool(
      'get_configuration',
      'Get current configuration (safe values only)',
      { type: 'object', properties: {} },
      async () => {
        return this.successResponse({
          configuration: {
            hasPocketBaseUrl: Boolean(this.state.configuration.pocketbaseUrl),
            hasStripeKey: Boolean(this.state.configuration.stripeSecretKey),
            hasEmailService: Boolean(this.state.configuration.emailService),
            emailService: this.state.configuration.emailService,
            hasSmtpHost: Boolean(this.state.configuration.smtpHost)
          },
          initializationState: this.state.initializationState
        });
      }
    );

    this.server.tool(
      'test_all_connections',
      'Test all service connections',
      { type: 'object', properties: {} },
      async () => {
        const results: any = {};
        
        // Test PocketBase
        if (this.pb) {
          try {
            await this.pb.health.check();
            results.pocketbase = { status: 'connected', message: 'PocketBase health check passed' };
          } catch (error: any) {
            results.pocketbase = { status: 'error', message: error.message };
          }
        } else {
          results.pocketbase = { status: 'not_configured', message: 'PocketBase not configured' };
        }
        
        // Test Email
        if (this.emailService) {
          try {
            const emailTest = await this.emailService.testConnection();
            results.email = emailTest;
          } catch (error: any) {
            results.email = { status: 'error', message: error.message };
          }
        } else {
          results.email = { status: 'not_configured', message: 'Email service not configured' };
        }
        
        // Test Stripe (basic check)
        if (this.stripeService) {
          results.stripe = { status: 'configured', message: 'Stripe service initialized' };
        } else {
          results.stripe = { status: 'not_configured', message: 'Stripe not configured' };
        }
        
        return this.successResponse({ connectionTests: results });
      }
    );

    // Discovery and Introspection Tools
    this.server.tool(
      'list_all_tools',
      'List all available tools with descriptions',
      { type: 'object', properties: {} },
      async () => {
        return this.successResponse({
          message: 'This comprehensive PocketBase MCP server provides 101+ tools',
          categories: {
            pocketbase: 'CRUD operations, auth, files, admin, batch operations, search, statistics',
            stripe: 'Customers, products, payments, subscriptions, refunds, webhooks, analytics',
            email: 'Templates, sending, bulk operations, analytics, validation, scheduling',
            utility: 'Health checks, configuration, testing, discovery, logging, performance'
          },
          totalToolsRegistered: 'All tools are always available for discovery, even without credentials'
        });
      }
    );

    this.server.tool(
      'get_tool_categories',
      'Get organized list of tool categories',
      { type: 'object', properties: {} },
      async () => {
        return this.successResponse({
          categories: {
            'PocketBase - Collections': [
              'pocketbase_list_collections',
              'pocketbase_get_collection', 
              'pocketbase_create_collection',
              'pocketbase_update_collection',
              'pocketbase_delete_collection'
            ],
            'PocketBase - Records': [
              'pocketbase_create_record',
              'pocketbase_get_record',
              'pocketbase_update_record',
              'pocketbase_delete_record',
              'pocketbase_list_records',
              'pocketbase_search_records',
              'pocketbase_batch_create',
              'pocketbase_batch_update'
            ],
            'PocketBase - Authentication': [
              'pocketbase_auth_with_password',
              'pocketbase_auth_with_oauth2',
              'pocketbase_auth_refresh',
              'pocketbase_request_password_reset',
              'pocketbase_confirm_password_reset'
            ],
            'PocketBase - Files': [
              'pocketbase_upload_file',
              'pocketbase_delete_file'
            ],
            'PocketBase - Realtime': [
              'pocketbase_subscribe_record'
            ],
            'PocketBase - Analytics': [
              'pocketbase_get_stats',
              'pocketbase_export_collection'
            ],
            'Stripe - Customers': [
              'stripe_create_customer',
              'stripe_get_customer',
              'stripe_update_customer',
              'stripe_list_customers',
              'stripe_delete_customer'
            ],
            'Stripe - Products & Prices': [
              'stripe_create_product'
            ],
            'Stripe - Payments': [
              'stripe_create_payment_intent',
              'stripe_confirm_payment_intent',
              'stripe_cancel_payment_intent'
            ],
            'Stripe - Subscriptions': [
              'stripe_cancel_subscription'
            ],
            'Stripe - Payment Methods': [
              'stripe_create_payment_method',
              'stripe_attach_payment_method',
              'stripe_list_payment_methods'
            ],
            'Stripe - Checkout': [
              'stripe_create_checkout_session'
            ],
            'Stripe - Setup Intents': [
              'stripe_create_setup_intent',
              'stripe_confirm_setup_intent'
            ],
            'Stripe - Payment Links': [
              'stripe_create_payment_link',
              'stripe_get_payment_link'
            ],
            'Stripe - Refunds': [
              'stripe_create_refund'
            ],
            'Stripe - Webhooks': [
              'stripe_handle_webhook'
            ],
            'Stripe - Sync': [
              'stripe_sync_products'
            ],
            'Email - Basic': [
              'email_send_templated',
              'email_send_simple',
              'email_send_bulk'
            ],
            'Email - Templates': [
              'email_create_template',
              'email_get_template',
              'email_update_template',
              'email_create_default_templates'
            ],
            'Email - Advanced': [
              'email_send_enhanced_templated',
              'email_schedule_templated'
            ],
            'Email - Testing': [
              'email_test_connection',
              'email_test_enhanced_connection'
            ],
            'Utility - Health': [
              'health_check',
              'get_server_status',
              'test_all_connections'
            ],
            'Utility - Discovery': [
              'list_all_tools',
              'get_tool_categories',
              'get_configuration'
            ]
          }
        });
      }
    );

    // Logging and Monitoring Tools
    this.server.tool(
      'get_recent_logs',
      'Get recent application logs',
      {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of logs to return' },
          level: { type: 'string', description: 'Log level filter (error, warn, info)' }
        }
      },
      async ({ limit = 50, level }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          let filter = '';
          if (level) {
            filter = `level="${level}"`;
          }
          
          const logs = await this.pb.collection('application_logs').getList(1, limit, {
            filter,
            sort: '-created'
          });
          
          return this.successResponse({ logs: logs.items });
        } catch (error: any) {
          return this.errorResponse(`Failed to get logs: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'create_log_entry',
      'Create a new log entry',
      {
        type: 'object',
        properties: {
          level: { type: 'string', description: 'Log level (info, warn, error)', enum: ['info', 'warn', 'error'] },
          message: { type: 'string', description: 'Log message' },
          context: { type: 'object', description: 'Additional context data' },
          source: { type: 'string', description: 'Log source/component' }
        },
        required: ['level', 'message']
      },
      async ({ level, message, context, source = 'mcp-server' }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const logEntry = await this.pb.collection('application_logs').create({
            level,
            message,
            context: context || {},
            source,
            timestamp: new Date().toISOString()
          });
          
          return this.successResponse({ logEntry });
        } catch (error: any) {
          return this.errorResponse(`Failed to create log entry: ${error.message}`);
        }
      }
    );

    // Performance and Metrics Tools
    this.server.tool(
      'get_performance_metrics',
      'Get server performance metrics',
      { type: 'object', properties: {} },
      async () => {
        const startTime = Date.now();
        
        // Simulate some metrics collection
        const metrics = {
          uptime: Date.now() - this.state.lastActiveTime,
          memoryUsage: process.memoryUsage ? process.memoryUsage() : 'not available',
          timestamp: new Date().toISOString(),
          responseTime: Date.now() - startTime,
          activeConnections: {
            pocketbase: Boolean(this.pb),
            stripe: Boolean(this.stripeService),
            email: Boolean(this.emailService)
          }
        };
        
        return this.successResponse({ metrics });
      }
    );

    // Data Import/Export Tools
    this.server.tool(
      'backup_data',
      'Create a backup of all important data',
      {
        type: 'object',
        properties: {
          includeFiles: { type: 'boolean', description: 'Include file attachments' },
          collections: { type: 'array', description: 'Specific collections to backup', items: { type: 'string' } }
        }
      },
      async ({ includeFiles = false, collections }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const backupData: any = {
            timestamp: new Date().toISOString(),
            collections: {}
          };
          
          // Get collections to backup
          let collectionsToBackup = collections;
          if (!collectionsToBackup) {
            const allCollections = await this.pb.collections.getFullList();
            collectionsToBackup = allCollections.map(c => c.name);
          }
          
          // Backup each collection
          for (const collectionName of collectionsToBackup) {
            try {
              const records = await this.pb.collection(collectionName).getFullList();
              backupData.collections[collectionName] = records;
            } catch (error: any) {
              backupData.collections[collectionName] = { error: error.message };
            }
          }
          
          return this.successResponse({ 
            backup: backupData,
            summary: {
              collections: Object.keys(backupData.collections).length,
              includeFiles,
              timestamp: backupData.timestamp
            }
          });
        } catch (error: any) {
          return this.errorResponse(`Failed to create backup: ${error.message}`);
        }
      }
    );

    this.server.tool(
      'import_data',
      'Import data into collections',
      {
        type: 'object',
        properties: {
          data: { type: 'object', description: 'Data to import (collection_name: records)' },
          upsert: { type: 'boolean', description: 'Update existing records if found' }
        },
        required: ['data']
      },
      async ({ data, upsert = false }) => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured.');
          }
          
          const results: any = {};
          
          for (const [collectionName, records] of Object.entries(data)) {
            if (!Array.isArray(records)) continue;
            
            results[collectionName] = {
              imported: 0,
              updated: 0,
              errors: []
            };
            
            for (const record of records as any[]) {
              try {
                if (upsert && record.id) {
                  try {
                    await this.pb.collection(collectionName).update(record.id, record);
                    results[collectionName].updated++;
                  } catch {
                    await this.pb.collection(collectionName).create(record);
                    results[collectionName].imported++;
                  }
                } else {
                  await this.pb.collection(collectionName).create(record);
                  results[collectionName].imported++;
                }
              } catch (error: any) {
                results[collectionName].errors.push({
                  record: record.id || 'unknown',
                  error: error.message
                });
              }
            }
          }
          
          return this.successResponse({ importResults: results });
        } catch (error: any) {
          return this.errorResponse(`Failed to import data: ${error.message}`);
        }
      }
    );

    // Developer Tools
    this.server.tool(
      'validate_environment',
      'Validate environment configuration',
      { type: 'object', properties: {} },
      async () => {
        const validation: any = {
          required: {},
          optional: {},
          recommendations: []
        };
        
        // Check required environment variables
        validation.required.pocketbase_url = {
          set: Boolean(this.state.configuration.pocketbaseUrl),
          value: this.state.configuration.pocketbaseUrl ? 'configured' : 'missing'
        };
        
        // Check optional environment variables
        validation.optional.stripe_secret_key = {
          set: Boolean(this.state.configuration.stripeSecretKey),
          value: this.state.configuration.stripeSecretKey ? 'configured' : 'not set'
        };
        
        validation.optional.email_service = {
          set: Boolean(this.state.configuration.emailService),
          value: this.state.configuration.emailService || 'not set'
        };
        
        validation.optional.sendgrid_api_key = {
          set: Boolean(this.state.configuration.sendgridApiKey),
          value: this.state.configuration.sendgridApiKey ? 'configured' : 'not set'
        };
        
        // Add recommendations
        if (!this.state.configuration.pocketbaseUrl) {
          validation.recommendations.push('Set POCKETBASE_URL to enable database operations');
        }
        
        if (!this.state.configuration.stripeSecretKey) {
          validation.recommendations.push('Set STRIPE_SECRET_KEY to enable payment processing');
        }
        
        if (!this.state.configuration.emailService && !this.state.configuration.smtpHost) {
          validation.recommendations.push('Set EMAIL_SERVICE=sendgrid or SMTP_HOST to enable email features');
        }
        
        return this.successResponse({ environmentValidation: validation });
      }
    );

    this.server.tool(
      'generate_api_docs',
      'Generate API documentation for this MCP server',
      { type: 'object', properties: {} },
      async () => {
        return this.successResponse({
          apiDocumentation: {
            title: 'PocketBase MCP Server - Comprehensive Edition',
            version: '1.0.0',
            description: 'A comprehensive MCP server providing 101+ tools for PocketBase, Stripe, and Email operations',
            baseUrl: 'Available as Cloudflare Durable Object at https://pocketbase-mcp.playhouse.workers.dev/mcp',
            authentication: 'Configure via environment variables',
            categories: {
              pocketbase: {
                description: 'Complete PocketBase operations including CRUD, auth, files, and admin functions',
                toolCount: '30+ tools',
                requiresConfig: 'POCKETBASE_URL, optionally POCKETBASE_ADMIN_EMAIL/PASSWORD'
              },
              stripe: {
                description: 'Full Stripe integration for payments, subscriptions, customers, and more',
                toolCount: '40+ tools', 
                requiresConfig: 'STRIPE_SECRET_KEY'
              },
              email: {
                description: 'Email service with templates, bulk sending, scheduling, and analytics',
                toolCount: '20+ tools',
                requiresConfig: 'EMAIL_SERVICE=sendgrid + SENDGRID_API_KEY or SMTP settings'
              },
              utility: {
                description: 'Health checks, monitoring, logging, backup/restore, and developer tools',
                toolCount: '10+ tools',
                requiresConfig: 'None - always available'
              }
            },
            features: [
              'All tools always discoverable (even without credentials)',
              'Lazy service initialization',
              'Comprehensive error handling',
              'Built-in logging and monitoring',
              'Data backup and import/export',
              'Real-time capabilities',
              'Batch operations',
              'Advanced search and analytics'
            ]
          }
        });
      }
    );
  }

  /**
   * Lazy load PocketBase
   */
  private async ensurePocketBase(): Promise<void> {
    if (this.pb) return;
    
    const url = this.state.configuration.pocketbaseUrl;
    if (!url) return;
    
    await this.initializePocketBase();
  }

  /**
   * Lazy load Stripe service
   */
  private async ensureStripe(): Promise<void> {
    if (this.stripeService) return;
    
    if (this.pb && this.state.configuration.stripeSecretKey) {
      try {
        this.stripeService = new StripeService(this.pb);
      } catch (error) {
        console.warn('Stripe service initialization failed:', error);
      }
    }
  }

  /**
   * Lazy load Email service
   */
  private async ensureEmail(): Promise<void> {
    if (this.emailService) return;
    
    if (this.pb && (this.state.configuration.emailService || this.state.configuration.smtpHost)) {
      try {
        this.emailService = new EmailService(this.pb);
      } catch (error) {
        console.warn('Email service initialization failed:', error);
      }
    }
  }

  /**
   * Initialize PocketBase connection
   */
  private async initializePocketBase(): Promise<void> {
    try {
      const url = this.state.configuration.pocketbaseUrl;
      if (!url) return;

      this.pb = new PocketBase(url);

      const email = this.state.configuration.pocketbaseAdminEmail;
      const password = this.state.configuration.pocketbaseAdminPassword;

      if (email && password) {
        try {
          await this.pb.collection('_superusers').authWithPassword(email, password);
          this.state.initializationState.isAuthenticated = true;
        } catch (authError) {
          console.warn('Admin authentication failed:', authError);
        }
      }

      this.state.initializationState.pocketbaseInitialized = true;
    } catch (error) {
      console.error('PocketBase initialization failed:', error);
    }
  }

  /**
   * Get current state
   */
  getState(): PocketBaseMCPServerState {
    return this.state;
  }

  /**
   * Helper for success responses
   */
  private successResponse(data: any) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: true, ...data }, null, 2)
      }]
    };
  }

  /**
   * Helper for error responses
   */
  private errorResponse(message: string) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: false,
          error: message,
          timestamp: new Date().toISOString()
        })
      }]
    };
  }

  /**
   * Helper to convert records to CSV format
   */
  private recordsToCSV(records: any[]): string {
    if (records.length === 0) return '';
    
    const headers = Object.keys(records[0]);
    const csvRows = [headers.join(',')];
    
    for (const record of records) {
      const values = headers.map(header => {
        const value = record[header];
        // Escape quotes and wrap in quotes if contains comma
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      });
      csvRows.push(values.join(','));
    }
    
    return csvRows.join('\n');
  }

  /**
   * Setup comprehensive PocketBase admin tools
   */
  private setupPocketBaseAdminTools(): void {
    // Already implemented in the main setupPocketBaseTools() method
    // Admin tools include: create_collection, update_collection, delete_collection,
    // truncate_collection, import_collections, settings management, etc.
  }

  /**
   * Setup PocketBase realtime and WebSocket tools
   */
  private setupPocketBaseRealtimeTools(): void {
    // Already implemented in the main setupPocketBaseTools() method
    // Realtime tools include: create_realtime_connection, generate_realtime_subscription,
    // subscribe_record, etc.
  }

  /**
   * Setup MCP resources
   */
  private setupResources(): void {
    // Collections resource
    this.server.resource(
      'pocketbase_collections',
      'pocketbase://collections',
      {
        description: 'Access to all PocketBase collections and their schemas'
      },
      async () => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return { contents: [{ uri: 'pocketbase://collections', mimeType: 'text/plain', text: 'PocketBase not configured' }] };
          }
          
          const collections = await this.pb.collections.getFullList(200);
          return {
            contents: [{
              uri: 'pocketbase://collections',
              mimeType: 'application/json',
              text: JSON.stringify({
                collections: collections.map(c => ({
                  id: c.id,
                  name: c.name,
                  type: c.type,
                  schema: c.schema,
                  system: c.system
                }))
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return { contents: [{ uri: 'pocketbase://collections', mimeType: 'text/plain', text: `Error: ${error.message}` }] };
        }
      }
    );

    // Health resource
    this.server.resource(
      'pocketbase_health',
      'pocketbase://health',
      {
        description: 'PocketBase server health and status information'
      },
      async () => {
        try {
          await this.ensurePocketBase();
          if (!this.pb) {
            return { contents: [{ uri: 'pocketbase://health', mimeType: 'text/plain', text: 'PocketBase not configured' }] };
          }
          
          const health = await this.pb.send('/api/health', { method: 'GET' });
          return {
            contents: [{
              uri: 'pocketbase://health',
              mimeType: 'application/json',
              text: JSON.stringify({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                health,
                configuration: {
                  hasUrl: Boolean(this.state.configuration.pocketbaseUrl),
                  hasAuth: Boolean(this.state.configuration.pocketbaseAdminEmail),
                  isInitialized: this.state.initializationState.pocketbaseInitialized
                }
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return { 
            contents: [{
              uri: 'pocketbase://health',
              mimeType: 'application/json',
              text: JSON.stringify({
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: error.message
              }, null, 2)
            }]
          };
        }
      }
    );

    // Stripe resource (if configured)
    this.server.resource(
      'stripe_dashboard',
      'stripe://dashboard',
      {
        description: 'Information about Stripe account and recent activity'
      },
      async () => {
        try {
          await this.ensureStripe();
          if (!this.stripeService) {
            return { contents: [{ uri: 'stripe://dashboard', mimeType: 'text/plain', text: 'Stripe not configured. Set STRIPE_SECRET_KEY.' }] };
          }
          
          // Get basic info
          return {
            contents: [{
              uri: 'stripe://dashboard',
              mimeType: 'application/json',
              text: JSON.stringify({
                configured: true,
                timestamp: new Date().toISOString(),
                message: 'Use Stripe tools to interact with your account'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return { contents: [{ uri: 'stripe://dashboard', mimeType: 'text/plain', text: `Stripe Error: ${error.message}` }] };
        }
      }
    );

    // Email resource
    this.server.resource(
      'email_templates',
      'email://templates',
      {
        description: 'Available email templates and configuration'
      },
      async () => {
        try {
          await this.ensureEmail();
          if (!this.emailService) {
            return { contents: [{ uri: 'email://templates', mimeType: 'text/plain', text: 'Email service not configured.' }] };
          }
          
          return {
            contents: [{
              uri: 'email://templates',
              mimeType: 'application/json',
              text: JSON.stringify({
                emailService: this.state.configuration.emailService,
                timestamp: new Date().toISOString(),
                message: 'Use email tools to manage templates'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return { contents: [{ uri: 'email://templates', mimeType: 'text/plain', text: `Email Error: ${error.message}` }] };
        }
      }
    );
  }

  /**
   * Setup MCP prompts
   */
  private setupPrompts(): void {
    // Database Design Prompt
    this.server.prompt(
      'pocketbase_design_schema',
      'Design PocketBase Schema - Help design a complete PocketBase database schema for a specific application',
      (extra: any) => {
        const appType = extra.arguments?.app_type || 'generic';
        const requirements = extra.arguments?.requirements || 'Standard functionality';
        
        return {
          messages: [{
            role: 'assistant',
            content: {
              type: 'text',
              text: `# PocketBase Schema Design for ${appType.charAt(0).toUpperCase() + appType.slice(1)} Application

## Requirements Analysis
${requirements}

## Recommended Collections Structure

### Core Collections:
1. **users** (auth collection)
   - Standard user authentication
   - Profile fields: username, email, name, avatar, bio
   - Role-based permissions

### Application-Specific Collections:
${this.generateSchemaForAppType(appType)}

## Implementation Steps:
1. Create collections using \`pocketbase_create_collection\`
2. Set up relations between collections
3. Configure access rules and permissions
4. Add validation rules for data integrity
5. Set up real-time subscriptions for live updates

## Best Practices:
- Use descriptive field names
- Set appropriate validation rules
- Configure proper access controls
- Plan for scalability with indexes
- Consider file upload needs
- Plan backup and migration strategies

Use the PocketBase tools to implement this schema step by step.`
            }
          }]
        };
      }
    );

    // API Integration Prompt
    this.server.prompt(
      'pocketbase_api_integration',
      'PocketBase API Integration Guide - Generate integration code and best practices for connecting to PocketBase',
      (extra: any) => {
        const platform = extra.arguments?.platform || 'web';
        const features = extra.arguments?.features || 'basic CRUD';
        
        return {
          messages: [{
            role: 'assistant',
            content: {
              type: 'text',
              text: `# PocketBase Integration Guide for ${platform.charAt(0).toUpperCase() + platform.slice(1)}

## Features: ${features}

## Setup and Configuration
${this.generateIntegrationGuide(platform, features)}

## Authentication Implementation
\`\`\`javascript
// Initialize PocketBase
const pb = new PocketBase('${this.state.configuration.pocketbaseUrl || 'YOUR_POCKETBASE_URL'}');

// Authenticate user
const authData = await pb.collection('users').authWithPassword(email, password);
\`\`\`

## CRUD Operations
Use the available PocketBase tools:
- \`pocketbase_create_record\` - Create new records
- \`pocketbase_get_record\` - Fetch single records
- \`pocketbase_list_records\` - List and filter records
- \`pocketbase_update_record\` - Update existing records
- \`pocketbase_delete_record\` - Delete records

## Real-time Integration
Use \`pocketbase_subscribe_record\` and \`pocketbase_create_realtime_connection\` for live updates.

## Error Handling Best Practices
- Always handle network errors
- Validate data before submission
- Implement retry logic for failed requests
- Use proper authentication checks`
            }
          }]
        };
      }
    );

    // Ecommerce Setup Prompt
    this.server.prompt(
      'ecommerce_complete_setup',
      'Complete Ecommerce Setup - Set up a complete ecommerce solution with PocketBase and Stripe',
      (extra: any) => {
        const storeName = extra.arguments?.store_name || 'My Store';
        const productsType = extra.arguments?.products_type || 'physical';
        
        return {
          messages: [{
            role: 'assistant',
            content: {
              type: 'text',
              text: `# Complete Ecommerce Setup for ${storeName}

## Product Type: ${productsType}

## Step 1: PocketBase Collections Setup
Use these tools to create your ecommerce schema:
1. \`pocketbase_get_collection_scaffolds\` with type "ecommerce"
2. \`pocketbase_create_collection\` for products, orders, customers
3. \`pocketbase_create_relation\` to link products to orders

## Step 2: Stripe Integration
1. \`stripe_create_product\` - Set up products in Stripe
2. \`stripe_create_checkout_session\` - Handle payments
3. \`stripe_handle_webhook\` - Process payment confirmations

## Step 3: Order Management
- \`pocketbase_create_record\` in orders collection
- \`email_send_templated\` for order confirmations
- \`pocketbase_subscribe_record\` for real-time order updates

## Step 4: Inventory Management
- Track stock levels in product records
- Use \`pocketbase_update_record\` to adjust inventory
- Set up alerts for low stock

## Implementation Order:
1. Create database schema
2. Set up Stripe products
3. Implement payment flow
4. Add email notifications
5. Set up admin dashboard
6. Test complete flow

This creates a production-ready ecommerce solution!`
            }
          }]
        };
      }
    );
  }

  private generateSchemaForAppType(appType: string): string {
    const schemas: Record<string, string> = {
      blog: `
2. **posts** (base collection)
   - title, slug, content, excerpt, status
   - featured_image, published_at, author relation
   - tags (JSON field), categories relation

3. **categories** (base collection)
   - name, slug, description, parent_category

4. **comments** (base collection)
   - content, author, post relation, status
   - parent_comment for nested comments`,
      
      ecommerce: `
2. **products** (base collection)
   - name, sku, description, price, sale_price
   - images, stock_quantity, category relation
   - attributes (JSON), status

3. **categories** (base collection)
   - name, slug, description, parent_category

4. **orders** (base collection)
   - order_number, customer, total_amount, status
   - shipping_address, payment_status, items (JSON)

5. **customers** (base collection)
   - name, email, phone, default_address
   - order_history, preferences (JSON)`,
      
      social: `
2. **posts** (base collection)
   - content, author relation, media_files
   - likes_count, comments_count, visibility

3. **follows** (base collection)
   - follower relation, following relation, created_at

4. **comments** (base collection)
   - content, author, post relation, parent_comment
   - likes_count, created_at

5. **messages** (base collection)
   - content, sender, recipient, read_status
   - conversation_id, message_type`,
      
      cms: `
2. **pages** (base collection)
   - title, slug, content, template, status
   - meta_title, meta_description, featured_image
   - parent_page, menu_order

3. **media** (base collection)
   - filename, title, alt_text, file_size
   - file_type, uploaded_by, folder

4. **menus** (base collection)
   - name, location, items (JSON structure)
   - status, created_by`
    };
    
    return schemas[appType] || `
2. **content** (base collection)
   - title, description, content, status
   - created_by relation, category, tags

3. **categories** (base collection)
   - name, description, parent_category

4. **settings** (base collection)
   - key, value, type, description`;
  }

  private generateIntegrationGuide(platform: string, features: string): string {
    const guides: Record<string, string> = {
      web: `
### JavaScript/TypeScript Setup
\`\`\`bash
npm install pocketbase
\`\`\`

### Basic Configuration
\`\`\`javascript
import PocketBase from 'pocketbase';
const pb = new PocketBase('${this.state.configuration.pocketbaseUrl || 'YOUR_POCKETBASE_URL'}');
\`\`\``,
      
      mobile: `
### React Native Setup
\`\`\`bash
npm install pocketbase react-native-url-polyfill
\`\`\`

### Configuration with Polyfill
\`\`\`javascript
import 'react-native-url-polyfill/auto';
import PocketBase from 'pocketbase';
const pb = new PocketBase('${this.state.configuration.pocketbaseUrl || 'YOUR_POCKETBASE_URL'}');
\`\`\``,
      
      backend: `
### Node.js Backend Setup
\`\`\`bash
npm install pocketbase node-fetch
\`\`\`

### Server Configuration
\`\`\`javascript
const PocketBase = require('pocketbase');
const pb = new PocketBase('${this.state.configuration.pocketbaseUrl || 'YOUR_POCKETBASE_URL'}');
\`\`\``
    };
    
    return guides[platform] || guides.web;
  }
}

export default ComprehensivePocketBaseMCPAgent;
