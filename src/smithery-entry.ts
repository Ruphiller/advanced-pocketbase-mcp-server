/**
 * Smithery Platform Entry Point
 * 
 * This file provides the Smithery-compatible entry point for the
 * Advanced PocketBase MCP Server, enabling deployment to Smithery's
 * managed hosting platform with all 100+ tools.
 */

import { z } from 'zod';
import { ComprehensivePocketBaseMCPAgent } from './agent-comprehensive.js';

// Configuration schema for Smithery (matches smithery.yaml)
export const configSchema = z.object({
  pocketbaseUrl: z.string().min(1).describe("PocketBase instance URL (e.g., https://your-pb.com)"),
  adminEmail: z.string().optional().describe("Admin email for elevated operations (enables super admin authentication)"),
  adminPassword: z.string().optional().describe("Admin password for elevated operations"),
  debug: z.boolean().default(false).describe("Enable debug logging for troubleshooting")
}).strict();

export default function ({ config }: { config: z.infer<typeof configSchema> }) {
  // Validate configuration
  const validatedConfig = configSchema.parse(config);
  
  // Additional validation for actual URLs (but allow test values during Smithery's validation)
  if (validatedConfig.pocketbaseUrl !== "string" && 
      !validatedConfig.pocketbaseUrl.startsWith('http://') && 
      !validatedConfig.pocketbaseUrl.startsWith('https://')) {
    console.warn(`Warning: Invalid PocketBase URL format: ${validatedConfig.pocketbaseUrl}`);
  }

  // Initialize the comprehensive agent with all 100+ tools
  const agent = new ComprehensivePocketBaseMCPAgent();
  
  // Set up environment variables for the agent
  const env = {
    POCKETBASE_URL: validatedConfig.pocketbaseUrl,
    POCKETBASE_ADMIN_EMAIL: validatedConfig.adminEmail,
    POCKETBASE_ADMIN_PASSWORD: validatedConfig.adminPassword,
    NODE_ENV: 'production'
  };

  // Initialize the agent asynchronously
  agent.init(env).then(() => {
    if (validatedConfig.debug) {
      console.log('🚀 Advanced PocketBase MCP Server initialized with Smithery configuration');
      console.log('📊 Configuration:', {
        pocketbaseUrl: validatedConfig.pocketbaseUrl,
        hasAdminCredentials: Boolean(validatedConfig.adminEmail && validatedConfig.adminPassword),
        debugMode: validatedConfig.debug,
        totalTools: '100+',
        features: [
          'PocketBase CRUD Operations (30+ tools)',
          'Admin & Authentication Tools (20+ tools)', 
          'Real-time & WebSocket Tools (10+ tools)',
          'Stripe Payment Processing (25+ tools)',
          'Email & Communication Tools (15+ tools)',
          'Utility & Diagnostic Tools (10+ tools)',
          'Resources & Prompts'
        ]
      });
    }
  }).catch((error) => {
    console.error('❌ Failed to initialize Advanced PocketBase MCP Server:', error);
    // Don't throw here - let the server start and handle errors gracefully per tool
  });

  // Return the comprehensive server with all 100+ tools, resources, and prompts
  return agent.server;
}
