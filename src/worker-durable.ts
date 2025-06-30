/**
 * Cloudflare Worker entry point for PocketBase MCP Server using Durable Objects
 * 
 * This worker routes requests to the appropriate Durable Object instance,
 * providing stateful MCP server functionality with proper persistence and scaling.
 */

import { PocketBaseMCPDurableObject, Env } from './durable-object.js';

export { PocketBaseMCPDurableObject };

/**
 * Main Worker fetch handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const url = new URL(request.url);
    
    try {
      // Handle different routes
      switch (url.pathname) {
        case '/':
          return handleRoot();
        
        case '/health':
          return handleGlobalHealth(env);
        
        case '/sse':
        case '/mcp':
        case '/ws':
        case '/status':
          return handleMCPRequest(request, env, ctx);
        
        default:
          return new Response('Not Found', { status: 404 });
      }
    } catch (error: any) {
      console.error('Worker error:', error);
      return new Response(`Internal Server Error: ${error.message}`, { status: 500 });
    }
  },

  /**
   * Handle scheduled events (cron jobs)
   */
  async scheduled(event: any, env: Env, ctx: any): Promise<void> {
    // You can implement scheduled cleanup or maintenance tasks here
    console.log('Scheduled event triggered:', event.cron);
  }
};

/**
 * Handle root path - return server information
 */
function handleRoot(): Response {
  const info = {
    name: 'PocketBase MCP Server',
    version: '1.0.0',
    description: 'Model Context Protocol server for PocketBase with Durable Object support',
    endpoints: {
      health: '/health',
      sse: '/sse',
      mcp: '/mcp',
      websocket: '/ws',
      status: '/status'
    },
    capabilities: [
      'pocketbase',
      'database', 
      'realtime',
      'auth',
      'files',
      'stripe',
      'email',
      'durable-objects',
      'hibernation'
    ],
    documentation: 'https://github.com/your-repo/advanced-pocketbase-mcp-server'
  };

  return new Response(JSON.stringify(info, null, 2), {
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

/**
 * Handle global health check (worker-level)
 */
function handleGlobalHealth(env: Env): Response {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    worker: {
      runtime: 'cloudflare-workers',
      durableObjects: Boolean(env.POCKETBASE_MCP_DO)
    },
    environment: {
      pocketbaseConfigured: Boolean(env.POCKETBASE_URL),
      stripeConfigured: Boolean(env.STRIPE_SECRET_KEY),
      emailConfigured: Boolean(env.EMAIL_SERVICE || env.SMTP_HOST)
    }
  };

  return new Response(JSON.stringify(health, null, 2), {
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

/**
 * Handle MCP requests by routing to appropriate Durable Object
 */
async function handleMCPRequest(request: Request, env: Env, ctx: any): Promise<Response> {
  // Get or create Durable Object instance
  // For simplicity, we use a single instance. In production, you might want to:
  // - Use user-specific instances
  // - Use session-based routing
  // - Implement load balancing across multiple instances
  
  const durableObjectId = env.POCKETBASE_MCP_DO.idFromName('main');
  const durableObject = env.POCKETBASE_MCP_DO.get(durableObjectId);
  
  // Forward the request to the Durable Object
  return await durableObject.fetch(request);
}

/**
 * Handle CORS preflight requests
 */
function handleCORS(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      }
    });
  }
  return null;
}
