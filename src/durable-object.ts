/**
 * Cloudflare Durable Object implementation for PocketBase MCP Server
 * 
 * This provides true stateful MCP server functionality with:
 * - Persistent state across requests
 * - Automatic hibernation when idle
 * - WebSocket support for real-time connections
 * - Proper lifecycle management
 */

/// <reference types="@cloudflare/workers-types" />

import { PocketBaseMCPAgent } from './agent-simple.js';

// Define types for Cloudflare Workers environment
export interface Env {
  POCKETBASE_MCP_DO: DurableObjectNamespace;
  POCKETBASE_URL?: string;
  POCKETBASE_ADMIN_EMAIL?: string;
  POCKETBASE_ADMIN_PASSWORD?: string;
  STRIPE_SECRET_KEY?: string;
  SENDGRID_API_KEY?: string;
  EMAIL_SERVICE?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
}

// Agent state interface for persistence
export interface AgentState {
  sessionId?: string;
  configuration?: any;
  initializationState?: any;
  customHeaders?: Record<string, string>;
  lastActiveTime: number;
}

export class PocketBaseMCPDurableObject {
  private agent: PocketBaseMCPAgent | null = null;
  private state: DurableObjectState;
  private env: Env;
  private sessions: Map<string, WebSocket> = new Map(); // WebSocket sessions
  private lastActivity: number = Date.now();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    
    // Set up alarm for hibernation
    this.scheduleHibernationCheck();
  }

  /**
   * Initialize the MCP agent with persistent state
   */
  private async initializeAgent(): Promise<PocketBaseMCPAgent> {
    if (this.agent) {
      return this.agent;
    }

    // Restore agent state from Durable Object storage
    const storedState = await this.state.storage.get('agentState') as AgentState;
    
    // Create agent with restored state
    this.agent = new PocketBaseMCPAgent(storedState);
    
    // Initialize with environment configuration
    const config = {
      pocketbaseUrl: this.env.POCKETBASE_URL,
      adminEmail: this.env.POCKETBASE_ADMIN_EMAIL,
      adminPassword: this.env.POCKETBASE_ADMIN_PASSWORD,
      stripeSecretKey: this.env.STRIPE_SECRET_KEY,
      emailService: this.env.EMAIL_SERVICE,
      smtpHost: this.env.SMTP_HOST,
    };

    await this.agent.init(config);
    
    // Update activity timestamp
    this.lastActivity = Date.now();
    
    return this.agent;
  }

  /**
   * Persist agent state to Durable Object storage
   */
  private async persistAgentState(): Promise<void> {
    if (this.agent) {
      const agentState = this.agent.getState();
      await this.state.storage.put('agentState', agentState);
      await this.state.storage.put('lastActivity', this.lastActivity);
    }
  }

  /**
   * Handle HTTP requests to the Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Handle WebSocket upgrade for MCP connections
      if (request.headers.get('Upgrade') === 'websocket') {
        return this.handleWebSocket(request);
      }

      // Handle HTTP requests
      switch (path) {
        case '/health':
          return this.handleHealth();
        
        case '/mcp':
          return this.handleMCPRequest(request);
        
        case '/status':
          return this.handleStatus();
        
        case '/hibernate':
          return this.handleHibernate();
        
        case '/wake':
          return this.handleWake();
        
        default:
          return new Response('Not Found', { status: 404 });
      }
    } catch (error: any) {
      console.error('Durable Object error:', error);
      return new Response(`Internal Server Error: ${error.message}`, { status: 500 });
    }
  }

  /**
   * Handle WebSocket connections for real-time MCP communication
   */
  private async handleWebSocket(request: Request): Promise<Response> {
    // Create WebSocket pair - note: this is Cloudflare Workers specific
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected websocket', { status: 400 });
    }

    // In Cloudflare Workers, WebSocket upgrade is handled differently
    // This is a simplified implementation for demonstration
    return new Response('WebSocket upgrade not fully implemented in this demo', { 
      status: 501,
      headers: { 'Content-Type': 'text/plain' }
    });
  }

  /**
   * Process MCP messages (simplified implementation)
   */
  private async processMCPMessage(message: any): Promise<any> {
    const agent = await this.initializeAgent();
    
    // This is a simplified message handler
    // In a full implementation, you'd need to properly implement the MCP protocol
    switch (message.method) {
      case 'tools/list':
        return {
          id: message.id,
          result: {
            tools: [
              {
                name: 'health_check',
                description: 'Check server health',
                inputSchema: {
                  type: 'object',
                  properties: {}
                }
              }
              // Add more tools from agent
            ]
          }
        };
      
      case 'tools/call':
        // Call the appropriate tool on the agent
        // This would need proper implementation based on the tool name
        return {
          id: message.id,
          result: {
            content: [{
              type: 'text',
              text: 'Tool execution result would go here'
            }]
          }
        };
      
      default:
        return {
          id: message.id,
          error: {
            code: -32601,
            message: 'Method not found'
          }
        };
    }
  }

  /**
   * Handle health check requests
   */
  private async handleHealth(): Promise<Response> {
    const agent = await this.initializeAgent();
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      durableObject: {
        id: this.state.id.toString(),
        lastActivity: new Date(this.lastActivity).toISOString(),
        activeSessions: this.sessions.size,
        shouldHibernate: agent.shouldHibernate()
      },
      agent: agent.getState()
    };

    return new Response(JSON.stringify(health, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Handle direct MCP HTTP requests
   */
  private async handleMCPRequest(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const agent = await this.initializeAgent();
    const message = await request.json();
    
    // Process MCP message
    const response = await this.processMCPMessage(message);
    
    // Update activity and persist state
    this.lastActivity = Date.now();
    await this.persistAgentState();
    
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Handle status requests
   */
  private async handleStatus(): Promise<Response> {
    const agent = this.agent ? this.agent.getState() : null;
    
    const status = {
      durableObject: {
        id: this.state.id.toString(),
        initialized: Boolean(this.agent),
        lastActivity: new Date(this.lastActivity).toISOString(),
        activeSessions: this.sessions.size,
        uptime: Date.now() - this.lastActivity
      },
      agent: agent
    };

    return new Response(JSON.stringify(status, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Handle manual hibernation
   */
  private async handleHibernate(): Promise<Response> {
    await this.hibernate();
    return new Response(JSON.stringify({ message: 'Hibernated successfully' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Handle wake up from hibernation
   */
  private async handleWake(): Promise<Response> {
    if (this.agent) {
      await this.agent.wakeUp();
    }
    this.lastActivity = Date.now();
    
    return new Response(JSON.stringify({ message: 'Woke up successfully' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Hibernate the Durable Object
   */
  private async hibernate(): Promise<void> {
    // Close all WebSocket connections
    for (const [sessionId, ws] of this.sessions) {
      ws.close(1001, 'Hibernating');
    }
    this.sessions.clear();

    // Persist final state
    await this.persistAgentState();

    // Clean up agent resources
    if (this.agent) {
      await this.agent.cleanup();
      this.agent = null;
    }

    console.log('Durable Object hibernated');
  }

  /**
   * Schedule hibernation check
   */
  private async scheduleHibernationCheck(): Promise<void> {
    // Check every 5 minutes
    const fiveMinutes = 5 * 60 * 1000;
    await this.state.storage.setAlarm(Date.now() + fiveMinutes);
  }

  /**
   * Handle scheduled alarms (for hibernation)
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    const inactiveTime = now - this.lastActivity;
    const hibernationThreshold = 30 * 60 * 1000; // 30 minutes

    if (inactiveTime > hibernationThreshold && this.sessions.size === 0) {
      console.log('Auto-hibernating due to inactivity');
      await this.hibernate();
    } else {
      // Schedule next check
      await this.scheduleHibernationCheck();
    }
  }

  /**
   * Handle WebSocket close events
   */
  async webSocketClose(ws: any, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Remove from sessions
    for (const [sessionId, socket] of this.sessions) {
      if (socket === ws) {
        this.sessions.delete(sessionId);
        break;
      }
    }

    // If no active sessions, consider hibernating
    if (this.sessions.size === 0) {
      setTimeout(() => {
        if (this.sessions.size === 0) {
          this.hibernate();
        }
      }, 60000); // Wait 1 minute before hibernating
    }
  }

  /**
   * Handle WebSocket error events
   */
  async webSocketError(ws: any, error: Error): Promise<void> {
    console.error('WebSocket error in Durable Object:', error);
    
    // Remove from sessions
    for (const [sessionId, socket] of this.sessions) {
      if (socket === ws) {
        this.sessions.delete(sessionId);
        break;
      }
    }
  }
}

// Export the Durable Object class for Cloudflare Workers
export default PocketBaseMCPDurableObject;
