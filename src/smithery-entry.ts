/**
 * Smithery Platform Entry Point
 * 
 * This file provides the Smithery-compatible entry point for the
 * Advanced PocketBase MCP Server, enabling deployment to Smithery's
 * managed hosting platform with all 100+ tools including Stripe and Email/SendGrid.
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
  // Use safeParse instead of parse to avoid throwing errors during tool scanning
  const parseResult = configSchema.safeParse(config);
  
  // Create the comprehensive agent with all 100+ tools
  // This should work even without valid config for tool discovery
  const agent = new ComprehensivePocketBaseMCPAgent();
  
  // Only initialize with config if it's valid
  if (parseResult.success) {
    const validatedConfig = parseResult.data;
    
    if (validatedConfig.debug) {
      console.log('🚀 Initializing Advanced PocketBase MCP Server with Smithery configuration');
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
    
    // Set environment variables for the agent to use when tools are called
    // But DON'T call init() immediately to avoid connection failures during tool scanning
    if (typeof process !== 'undefined' && process.env) {
      // Store config in environment for later use by tools
      process.env.POCKETBASE_URL = validatedConfig.pocketbaseUrl;
      if (validatedConfig.adminEmail) process.env.POCKETBASE_ADMIN_EMAIL = validatedConfig.adminEmail;
      if (validatedConfig.adminPassword) process.env.POCKETBASE_ADMIN_PASSWORD = validatedConfig.adminPassword;
    }
  } else {
    // During tool scanning, config might be invalid/empty - this is expected
    console.log('🔍 Tool scanning mode - no valid config provided (this is normal for discovery)');
    console.log('📋 All 100+ tools are available for discovery even without configuration');
  }

  // Return the comprehensive server with all 100+ tools, resources, and prompts
  // The agent will lazy-load connections when individual tools are called
  return agent.server;
}
