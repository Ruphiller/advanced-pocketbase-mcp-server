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
  // Parse and validate configuration
  const validatedConfig = configSchema.parse(config);
  
  if (validatedConfig.debug) {
    console.log('🚀 Initializing Advanced PocketBase MCP Server with Smithery configuration');
    console.log('📊 Configuration:', {
      pocketbaseUrl: validatedConfig.pocketbaseUrl,
      hasAdminCredentials: Boolean(validatedConfig.adminEmail && validatedConfig.adminPassword),
      debugMode: validatedConfig.debug
    });
  }

  // Create the comprehensive agent with all 100+ tools
  const agent = new ComprehensivePocketBaseMCPAgent();
  
  // Store configuration in environment variables for lazy initialization
  // The agent will initialize services when individual tools are called
  process.env.POCKETBASE_URL = validatedConfig.pocketbaseUrl;
  process.env.POCKETBASE_ADMIN_EMAIL = validatedConfig.adminEmail || '';
  process.env.POCKETBASE_ADMIN_PASSWORD = validatedConfig.adminPassword || '';
  
  // Set up additional environment variables for optional services
  // These will be available if configured via Smithery environment variables
  if (!process.env.STRIPE_SECRET_KEY) process.env.STRIPE_SECRET_KEY = '';
  if (!process.env.EMAIL_SERVICE) process.env.EMAIL_SERVICE = '';
  if (!process.env.SENDGRID_API_KEY) process.env.SENDGRID_API_KEY = '';
  if (!process.env.APP_NAME) process.env.APP_NAME = 'Advanced PocketBase App';
  process.env.NODE_ENV = 'production';

  if (validatedConfig.debug) {
    console.log('✅ Advanced PocketBase MCP Server ready with lazy initialization');
    console.log('🔧 Available features:');
    console.log('   • PocketBase CRUD Operations (30+ tools)');
    console.log('   • Admin & Authentication Tools (20+ tools)');
    console.log('   • Real-time & WebSocket Tools (10+ tools)');
    console.log('   • Stripe Payment Processing (25+ tools)');
    console.log('   • Email & Communication Tools (15+ tools)');
    console.log('   • Utility & Diagnostic Tools (10+ tools)');
    console.log('   • Resources & Prompts');
    console.log('   • Full-Stack SaaS Automation Workflows');
    console.log('📝 Note: Services will initialize when tools are first used');
  }

  // Return the comprehensive server with all tools
  return agent.server;
}
