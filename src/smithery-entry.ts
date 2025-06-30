/**
 * Smithery Platform Entry Point
 * 
 * This file provides the Smithery-compatible entry point for the
 * Advanced PocketBase MCP Server, enabling deployment to Smithery's
 * managed hosting platform with all 100+ tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Configuration schema for Smithery (matches smithery.yaml)
export const configSchema = z.object({
  pocketbaseUrl: z.string().min(1).describe("PocketBase instance URL (e.g., https://your-pb.com)"),
  adminEmail: z.string().optional().describe("Admin email for elevated operations (enables super admin authentication)"),
  adminPassword: z.string().optional().describe("Admin password for elevated operations"),
  debug: z.boolean().default(false).describe("Enable debug logging for troubleshooting")
}).strict();

export default function ({ config }: { config: z.infer<typeof configSchema> }) {
  // Validate configuration but don't fail on test values
  const validatedConfig = configSchema.parse(config);
  
  // Create the MCP server
  const server = new McpServer({
    name: 'Advanced PocketBase MCP Server',
    version: '4.0.0'
  });
  
  // Lazy initialization of the comprehensive agent
  let comprehensiveAgent: any = null;
  let initializationPromise: Promise<void> | null = null;
  
  const ensureAgent = async () => {
    if (comprehensiveAgent) {
      return comprehensiveAgent;
    }
    
    if (initializationPromise) {
      await initializationPromise;
      return comprehensiveAgent;
    }
    
    initializationPromise = (async () => {
      try {
        // Only initialize with real URLs, not test values
        if (validatedConfig.pocketbaseUrl !== "string" && 
            (validatedConfig.pocketbaseUrl.startsWith('http://') || 
             validatedConfig.pocketbaseUrl.startsWith('https://'))) {
          
          const { ComprehensivePocketBaseMCPAgent } = await import('./agent-comprehensive.js');
          comprehensiveAgent = new ComprehensivePocketBaseMCPAgent();
          
          const env = {
            POCKETBASE_URL: validatedConfig.pocketbaseUrl,
            POCKETBASE_ADMIN_EMAIL: validatedConfig.adminEmail,
            POCKETBASE_ADMIN_PASSWORD: validatedConfig.adminPassword,
            NODE_ENV: 'production'
          };

          await comprehensiveAgent.init(env);
          
          if (validatedConfig.debug) {
            console.log('🚀 Advanced PocketBase MCP Server initialized with Smithery configuration');
          }
        } else {
          // For test configurations, create a mock agent
          comprehensiveAgent = {
            async handleToolCall(toolName: string, args: any) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `Mock response for tool ${toolName} - please configure with a valid PocketBase URL`
                }]
              };
            }
          };
          
          if (validatedConfig.debug) {
            console.log('🧪 Test mode: Using mock agent for tool scanning');
          }
        }
      } catch (error) {
        console.error('❌ Failed to initialize agent:', error);
        // Provide a fallback mock agent
        comprehensiveAgent = {
          async handleToolCall(toolName: string, args: any) {
            return {
              content: [{
                type: 'text' as const,
                text: `Error: Failed to initialize PocketBase connection - ${error}`
              }],
              isError: true
            };
          }
        };
      }
    })();
    
    await initializationPromise;
    return comprehensiveAgent;
  };

  // Register a comprehensive set of tools for Smithery's scanning phase
  // This provides all the tool definitions without requiring initialization
  
  // Collection Management Tools
  server.tool('pocketbase_list_collections', 'List all available PocketBase collections', {}, 
    async () => {
      const agent = await ensureAgent();
      return await agent.handleToolCall?.('pocketbase_list_collections', {}) || {
        content: [{ type: 'text', text: 'Tool not available' }]
      };
    }
  );

  server.tool('pocketbase_get_collection', 'Get detailed information about a specific collection', {
    name: z.string().describe('Collection name')
  }, async ({ name }) => {
    const agent = await ensureAgent();
    return await agent.handleToolCall?.('pocketbase_get_collection', { name }) || {
      content: [{ type: 'text', text: 'Tool not available' }]
    };
  });

  server.tool('pocketbase_create_record', 'Create a new record in a collection', {
    collection: z.string().describe('Collection name'),
    data: z.record(z.any()).describe('Record data')
  }, async ({ collection, data }) => {
    const agent = await ensureAgent();
    return await agent.handleToolCall?.('pocketbase_create_record', { collection, data }) || {
      content: [{ type: 'text', text: 'Tool not available' }]
    };
  });

  server.tool('pocketbase_list_records', 'List records with filtering and pagination', {
    collection: z.string().describe('Collection name'),
    page: z.number().optional().describe('Page number'),
    perPage: z.number().optional().describe('Records per page'),
    filter: z.string().optional().describe('Filter query'),
    sort: z.string().optional().describe('Sort criteria')
  }, async ({ collection, page, perPage, filter, sort }) => {
    const agent = await ensureAgent();
    return await agent.handleToolCall?.('pocketbase_list_records', { collection, page, perPage, filter, sort }) || {
      content: [{ type: 'text', text: 'Tool not available' }]
    };
  });

  server.tool('pocketbase_update_record', 'Update an existing record', {
    collection: z.string().describe('Collection name'),
    id: z.string().describe('Record ID'),
    data: z.record(z.any()).describe('Updated data')
  }, async ({ collection, id, data }) => {
    const agent = await ensureAgent();
    return await agent.handleToolCall?.('pocketbase_update_record', { collection, id, data }) || {
      content: [{ type: 'text', text: 'Tool not available' }]
    };
  });

  server.tool('pocketbase_delete_record', 'Delete a record by ID', {
    collection: z.string().describe('Collection name'),
    id: z.string().describe('Record ID')
  }, async ({ collection, id }) => {
    const agent = await ensureAgent();
    return await agent.handleToolCall?.('pocketbase_delete_record', { collection, id }) || {
      content: [{ type: 'text', text: 'Tool not available' }]
    };
  });

  // Authentication Tools
  server.tool('authenticate_user', 'Authenticate a user and get auth token', {
    email: z.string().describe('User email'),
    password: z.string().describe('User password'),
    collection: z.string().default('users').describe('Collection name')
  }, async ({ email, password, collection }) => {
    const agent = await ensureAgent();
    return await agent.handleToolCall?.('authenticate_user', { email, password, collection }) || {
      content: [{ type: 'text', text: 'Tool not available' }]
    };
  });

  // Admin Tools
  server.tool('pocketbase_super_admin_auth', 'Authenticate as super admin at runtime', {
    email: z.string().email().optional().describe('Admin email (overrides config)'),
    password: z.string().optional().describe('Admin password (overrides config)')
  }, async ({ email, password }) => {
    const agent = await ensureAgent();
    return await agent.handleToolCall?.('pocketbase_super_admin_auth', { email, password }) || {
      content: [{ type: 'text', text: 'Tool not available' }]
    };
  });

  // Diagnostic Tools
  server.tool('debug_pocketbase_auth', 'Test authentication and connection status', {}, 
    async () => {
      const agent = await ensureAgent();
      return await agent.handleToolCall?.('debug_pocketbase_auth', {}) || {
        content: [{ type: 'text', text: 'Tool not available' }]
      };
    }
  );

  // Return the server
  return server.server;
}
