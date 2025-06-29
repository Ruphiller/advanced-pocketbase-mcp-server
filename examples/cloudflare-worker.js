// Example Cloudflare Worker implementation using the PocketBaseMCPAgent
// Save as worker.js in your Cloudflare Worker project

import { PocketBaseMCPAgent } from './agent-simple.js';

export default {
  async fetch(request, env, ctx) {
    // Handle MCP requests
    if (request.url.includes('/mcp')) {
      return handleMCPRequest(request, env, ctx);
    }
    
    // Health check endpoint
    if (request.url.includes('/health')) {
      return new Response('OK', { status: 200 });
    }
    
    return new Response('PocketBase MCP Server', { status: 200 });
  }
};

async function handleMCPRequest(request, env, ctx) {
  try {
    // Create agent with environment-based configuration
    const agent = new PocketBaseMCPAgent({
      configuration: {
        pocketbaseUrl: env.POCKETBASE_URL,
        adminEmail: env.POCKETBASE_ADMIN_EMAIL,
        adminPassword: env.POCKETBASE_ADMIN_PASSWORD,
        stripeSecretKey: env.STRIPE_SECRET_KEY,
        sendgridApiKey: env.SENDGRID_API_KEY,
      }
    });
    
    // Initialize the agent
    await agent.init();
    
    // Handle the MCP request
    // Note: You'll need to implement proper MCP transport handling here
    // This is a simplified example
    
    if (request.method === 'POST') {
      const body = await request.json();
      
      // Handle tools/list request
      if (body.method === 'tools/list') {
        // This would normally go through the MCP transport layer
        return new Response(JSON.stringify({
          id: body.id,
          result: {
            tools: [
              { name: 'health_check', description: 'Check server health' },
              { name: 'discover_tools', description: 'Discover available tools' },
              { name: 'smithery_discovery', description: 'Fast tool discovery for Smithery' }
            ]
          }
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    
    return new Response('Method not supported', { status: 405 });
    
  } catch (error) {
    console.error('MCP request failed:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// Example Durable Object implementation
export class MCPDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.agent = null;
  }
  
  async fetch(request) {
    // Restore agent state if needed
    if (!this.agent) {
      const savedState = await this.state.storage.get('agentState');
      this.agent = new PocketBaseMCPAgent(savedState);
      
      // Initialize with environment variables
      await this.agent.init({
        pocketbaseUrl: this.env.POCKETBASE_URL,
        adminEmail: this.env.POCKETBASE_ADMIN_EMAIL,
        adminPassword: this.env.POCKETBASE_ADMIN_PASSWORD,
        stripeSecretKey: this.env.STRIPE_SECRET_KEY,
        sendgridApiKey: this.env.SENDGRID_API_KEY,
      });
    }
    
    // Handle the request
    const response = await this.handleMCPRequest(request);
    
    // Save state periodically
    const agentState = this.agent.getState();
    await this.state.storage.put('agentState', agentState);
    
    // Check if agent should hibernate
    if (this.agent.shouldHibernate()) {
      // Clean up resources before hibernation
      await this.agent.cleanup();
    }
    
    return response;
  }
  
  async handleMCPRequest(request) {
    // Similar to the main worker implementation
    // but with persistent state management
    try {
      // Wake up the agent if needed
      await this.agent.wakeUp();
      
      // Process the request...
      return new Response('Processed by Durable Object', { status: 200 });
      
    } catch (error) {
      console.error('Durable Object MCP request failed:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
}
