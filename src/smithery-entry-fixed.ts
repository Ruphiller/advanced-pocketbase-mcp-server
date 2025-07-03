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
   * Setup essential PocketBase tools with lazy loading
   */
  setupBasicTools(): void {
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

    // Synchronously require and register tools
    try {
      const email = require('./services/email');
      if (email && email.registerTools) email.registerTools(this.server, this.pb);
    } catch (e) { /* ignore */ }
    try {
      const sendgrid = require('./services/sendgrid');
      if (sendgrid && sendgrid.registerTools) sendgrid.registerTools(this.server, this.pb);
    } catch (e) { /* ignore */ }
    try {
      const stripe = require('./services/stripe');
      if (stripe && stripe.registerTools) stripe.registerTools(this.server, this.pb);
    } catch (e) { /* ignore */ }
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
  const parseResult = configSchema.safeParse(config);
  const serverInstance = new SimplePocketBaseMCPServer();

  if (parseResult.success) {
    const validatedConfig = parseResult.data;
    serverInstance.init(validatedConfig).catch(error => {
      console.error('Server initialization error:', error);
    });
  }
  return serverInstance.server;
}
