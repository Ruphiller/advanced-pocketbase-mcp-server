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

  // Create and initialize the comprehensive agent with all 100+ tools
  const agent = new ComprehensivePocketBaseMCPAgent();
  
  // Set up environment variables for all services
  const env = {
    // PocketBase configuration
    POCKETBASE_URL: validatedConfig.pocketbaseUrl,
    POCKETBASE_ADMIN_EMAIL: validatedConfig.adminEmail,
    POCKETBASE_ADMIN_PASSWORD: validatedConfig.adminPassword,
    
    // Stripe configuration (will be configured via Smithery UI if needed)
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
    
    // Email configuration (will be configured via Smithery UI if needed)
    EMAIL_SERVICE: process.env.EMAIL_SERVICE || '',
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY || '',
    SMTP_HOST: process.env.SMTP_HOST || '',
    SMTP_PORT: process.env.SMTP_PORT || '587',
    SMTP_USER: process.env.SMTP_USER || '',
    SMTP_PASS: process.env.SMTP_PASS || '',
    DEFAULT_FROM_EMAIL: process.env.DEFAULT_FROM_EMAIL || '',
    
    // Application settings
    APP_NAME: process.env.APP_NAME || 'Advanced PocketBase App',
    APP_URL: process.env.APP_URL || '',
    NODE_ENV: 'production'
  };

  // Initialize the agent with full configuration
  // This is done asynchronously to not block server startup
  agent.init(env).then(() => {
    if (validatedConfig.debug) {
      console.log('✅ Advanced PocketBase MCP Server fully initialized');
      console.log('🔧 Available features:');
      console.log('   • PocketBase CRUD Operations (30+ tools)');
      console.log('   • Admin & Authentication Tools (20+ tools)');
      console.log('   • Real-time & WebSocket Tools (10+ tools)');
      console.log('   • Stripe Payment Processing (25+ tools)');
      console.log('   • Email & Communication Tools (15+ tools)');
      console.log('   • Utility & Diagnostic Tools (10+ tools)');
      console.log('   • Resources & Prompts');
      console.log('   • Full-Stack SaaS Automation Workflows');
    }
  }).catch((error) => {
    console.error('⚠️ Non-critical initialization error (tools will still work):', error.message);
    // Don't throw - let the server start and tools handle initialization individually
  });

  // Return the comprehensive server with all tools
  return agent.server;
}
