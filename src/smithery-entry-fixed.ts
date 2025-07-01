/**
 * Fixed Smithery Platform Entry Point
 * 
 * This is a self-contained, simplified entry point that works with Smithery's
 * build system and avoids the import issues causing server initialization errors.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from 'zod';
import PocketBase from 'pocketbase';

// Configuration schema for Smithery (matches smithery.yaml)
export const configSchema = z.object({
  pocketbaseUrl: z.string().min(1).describe("PocketBase instance URL (e.g., https://your-pb.com)"),
  adminEmail: z.string().optional().describe("Admin email for elevated operations (enables super admin authentication)"),
  adminPassword: z.string().optional().describe("Admin password for elevated operations"),
  debug: z.boolean().default(false).describe("Enable debug logging for troubleshooting")
}).strict();

/**
 * Simple MCP Server for Smithery compatibility
 */
class SimplePocketBaseMCPServer {
  server = new McpServer({
    name: "pocketbase-simple-server",
    version: "1.0.0",
  });

  private pb?: PocketBase;
  private config?: z.infer<typeof configSchema>;

  constructor() {
    this.setupBasicTools();
  }

  /**
   * Initialize with configuration
   */
  async init(config: z.infer<typeof configSchema>) {
    this.config = config;
    
    if (config.debug) {
      console.log('🚀 Initializing Simple PocketBase MCP Server for Smithery');
      console.log('📊 Configuration:', {
        pocketbaseUrl: config.pocketbaseUrl,
        hasAdminCredentials: Boolean(config.adminEmail && config.adminPassword),
        debugMode: config.debug
      });
    }

    // Initialize PocketBase if URL is provided
    if (config.pocketbaseUrl) {
      try {
        this.pb = new PocketBase(config.pocketbaseUrl);
        
        // Try admin authentication if credentials provided
        if (config.adminEmail && config.adminPassword) {
          try {
            await this.pb.collection('_superusers').authWithPassword(config.adminEmail, config.adminPassword);
            if (config.debug) {
              console.log('✅ Admin authentication successful');
            }
          } catch (authError) {
            console.warn('⚠️ Admin authentication failed:', authError);
          }
        }
      } catch (error) {
        console.error('❌ PocketBase initialization failed:', error);
      }
    }
  }

  /**
   * Setup essential PocketBase tools
   */
  private setupBasicTools(): void {
    // Health Check Tool
    this.server.tool(
      'health_check',
      'Simple health check endpoint',
      { type: 'object', properties: {} },
      async () => {
        return this.successResponse({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          server: 'PocketBase MCP Server (Smithery)',
          configured: Boolean(this.pb)
        });
      }
    );

    // List Collections
    this.server.tool(
      'pocketbase_list_collections',
      'List all available PocketBase collections',
      { type: 'object', properties: {} },
      async () => {
        try {
          if (!this.pb) {
            return this.errorResponse('PocketBase not configured. Set pocketbaseUrl in config.');
          }
          
          const collections = await this.pb.collections.getFullList(200);
          return this.successResponse({ 
            collections: collections.map(c => ({
              id: c.id,
              name: c.name,
              type: c.type,
              created: c.created
            }))
          });
        } catch (error: any) {
          return this.errorResponse(`Failed to list collections: ${error.message}`);
        }
      }
    );

    // Get Collection
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

    // Create Record
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

    // Get Record
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

    // Update Record
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

    // Delete Record
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

    // List Records
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

    // Authentication
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

    // Server Status
    this.server.tool(
      'get_server_status',
      'Get comprehensive server status and configuration',
      { type: 'object', properties: {} },
      async () => {
        return this.successResponse({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          server: 'PocketBase MCP Server (Smithery Edition)',
          configuration: {
            hasPocketBaseUrl: Boolean(this.config?.pocketbaseUrl),
            hasAdminCredentials: Boolean(this.config?.adminEmail && this.config?.adminPassword),
            debugMode: this.config?.debug || false
          },
          services: {
            pocketbase: Boolean(this.pb)
          },
          toolsAvailable: 9,
          platform: 'Smithery'
        });
      }
    );
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
}

export default function ({ config }: { config: z.infer<typeof configSchema> }) {
  // Use safeParse to avoid throwing errors during tool scanning
  const parseResult = configSchema.safeParse(config);
  
  // Create the simple server
  const serverInstance = new SimplePocketBaseMCPServer();
  
  // Only initialize with config if it's valid
  if (parseResult.success) {
    const validatedConfig = parseResult.data;
    
    // Initialize asynchronously but don't await to avoid blocking tool discovery
    serverInstance.init(validatedConfig).catch(error => {
      console.error('Server initialization error:', error);
    });
  } else {
    // During tool scanning, config might be invalid/empty - this is expected
    console.log('🔍 Tool scanning mode - no valid config provided (this is normal for discovery)');
    console.log('📋 Essential PocketBase tools are available for discovery');
  }

  // Return the server immediately for tool discovery
  return serverInstance.server;
}
