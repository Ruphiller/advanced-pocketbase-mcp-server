/**
 * Cloudflare Worker Entry Point - Best Practices Implementation
 * 
 * This worker demonstrates the recommended patterns for deploying
 * MCP servers on Cloudflare Workers with Durable Objects.
 */

import { routeAgentRequest } from "agents";
import PocketBaseMCPAgentBestPractices from './agent-best-practices.js';

// Environment interface
interface Env {
  POCKETBASE_MCP_DO: DurableObjectNamespace;
  POCKETBASE_URL?: string;
  POCKETBASE_ADMIN_EMAIL?: string;
  POCKETBASE_ADMIN_PASSWORD?: string;
  STRIPE_SECRET_KEY?: string;
  SENDGRID_API_KEY?: string;
  EMAIL_SERVICE?: string;
  SMTP_HOST?: string;
}

/**
 * Best Practices Durable Object using Cloudflare Agents SDK
 * 
 * This follows the exact patterns from the official Cloudflare MCP servers:
 * - Extends Agent class for automatic state management
 * - Built-in hibernation support
 * - Proper SSE endpoint handling
 * - OAuth integration capabilities
 */
export class PocketBaseMCPBestPractices extends PocketBaseMCPAgentBestPractices {
  // The Agent class handles all the Durable Object lifecycle automatically
}

/**
 * Worker fetch handler using Agent.serveSSE
 * 
 * This follows the recommended pattern from Cloudflare MCP documentation
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Use the routeAgentRequest function for proper MCP handling
    const agentResponse = await routeAgentRequest(request, env, {
      cors: true
    });
    
    if (agentResponse) {
      return agentResponse;
    }

    // Handle health check
    if (request.url.endsWith('/health')) {
      return new Response(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '0.1.0'
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Handle root path
    if (new URL(request.url).pathname === '/') {
      return new Response(JSON.stringify({
        name: 'PocketBase MCP Server (Best Practices)',
        version: '0.1.0',
        endpoints: {
          sse: '/sse',
          health: '/health'
        },
        documentation: 'https://github.com/your-org/pocketbase-mcp-server'
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};
