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
    // Tool registration moved to async setup()
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
   * Setup essential PocketBase tools with lazy loading
   */
  async setupBasicTools(): Promise<void> {
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

    // Dynamically import and register tools
    const toolModules = [
      './services/email',
      './services/sendgrid',
      './services/stripe'
    ];

    for (const modulePath of toolModules) {
      try {
        console.log(`Attempting to load tools from: ${modulePath}`);
        const module = await import(modulePath);
        if (module && module.registerTools) {
          console.log(`Registering tools from: ${modulePath}`);
          module.registerTools(this.server, this.pb);
        } else {
          console.warn(`No registerTools function found in: ${modulePath}`);
        }
      } catch (error) {
        console.error(`Failed to load tools from ${modulePath}:`, error);
      }
    }
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

export default async function ({ config }: { config: z.infer<typeof configSchema> }) {
  const parseResult = configSchema.safeParse(config);
  const serverInstance = new SimplePocketBaseMCPServer();

  if (parseResult.success) {
    const validatedConfig = parseResult.data;
    await serverInstance.init(validatedConfig);
  }
  await serverInstance.setupBasicTools();

  return serverInstance.server;
}
