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

import { WorkerCompatiblePocketBaseMCPAgent } from './agent-worker-compatible.js';
import PocketBase from 'pocketbase';

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
  private agent: WorkerCompatiblePocketBaseMCPAgent | null = null;
  private pb: PocketBase | null = null;
  private pbInitialized: boolean = false;
  private pbLastAuth: number = 0;
  private pbAuthValid: boolean = false;
  private state: DurableObjectState;
  private env: Env;
  private sessions: Map<string, WebSocket> = new Map(); // WebSocket sessions
  private lastActivity: number = Date.now();
  private initialized = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    
    // Set up alarm for hibernation
    this.scheduleHibernationCheck();
  }

  /**
   * Initialize the MCP agent with persistent state
   */
  private async initializeAgent(): Promise<WorkerCompatiblePocketBaseMCPAgent> {
    if (this.agent) {
      return this.agent;
    }

    // Restore agent state from Durable Object storage
    const storedState = await this.state.storage.get('agentState') as AgentState;
    
    // Create agent with restored state
    this.agent = new WorkerCompatiblePocketBaseMCPAgent();
    
    // Initialize with environment configuration
    const config = {
      pocketbaseUrl: this.env.POCKETBASE_URL,
      adminEmail: this.env.POCKETBASE_ADMIN_EMAIL,
      adminPassword: this.env.POCKETBASE_ADMIN_PASSWORD,
    };

    await this.agent.init(config);
    
    // Update activity timestamp
    this.lastActivity = Date.now();
    this.initialized = true;
    
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
        case '/sse':
          return this.handleSSE(request);
        
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
   * Process MCP messages using proper MCP protocol
   */
  private async processMCPMessage(message: any): Promise<any> {
    const agent = await this.initializeAgent();
    
    console.log('Processing MCP message:', message.method, message.id);
    
    try {
      // Handle MCP protocol messages
      switch (message.method) {
        case 'initialize':
          // MCP initialize request
          console.log('Handling initialize request');
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {},
                resources: {},
                prompts: {},
                logging: {}
              },
              serverInfo: {
                name: 'PocketBase MCP Server',
                version: '1.0.0'
              }
            }
          };

        case 'notifications/initialized':
          // Client confirming initialization
          console.log('Client initialized');
          return null; // No response needed for notifications

        case 'tools/list':
          // List available tools - get them from the agent
          console.log('Listing tools from comprehensive agent');
          try {
            // Get tools from the agent's MCP server
            const toolsList = await this.getToolsFromAgent();
            return {
              jsonrpc: '2.0',
              id: message.id,
              result: {
                tools: toolsList
              }
            };
          } catch (error: any) {
            console.error('Error getting tools from agent:', error);
            // Fallback to basic tools list
            return {
              jsonrpc: '2.0',
              id: message.id,
              result: {
                tools: await this.getFallbackTools()
              }
            };
          }

        case 'tools/call':
          // Execute a tool
          const toolName = message.params?.name;
          const toolArgs = message.params?.arguments || {};
          
          console.log('Calling tool:', toolName, 'with args:', toolArgs);
          
          try {
            const result = await this.executeTool(toolName, toolArgs);
            return {
              jsonrpc: '2.0',
              id: message.id,
              result: {
                content: [{
                  type: 'text',
                  text: JSON.stringify(result, null, 2)
                }]
              }
            };
          } catch (error: any) {
            console.error('Tool execution error:', error);
            return {
              jsonrpc: '2.0',
              id: message.id,
              error: {
                code: -32603,
                message: 'Tool execution failed',
                data: error.message
              }
            };
          }

        case 'resources/list':
          // List available resources
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              resources: []
            }
          };

        case 'prompts/list':
          // List available prompts
          return {
            jsonrpc: '2.0',
            id: message.id,
            result: {
              prompts: []
            }
          };

        default:
          console.warn('Unknown MCP method:', message.method);
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: -32601,
              message: 'Method not found',
              data: `Unknown method: ${message.method}`
            }
          };
      }
    } catch (error: any) {
      console.error('Error processing MCP message:', error);
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error.message
        }
      };
    }
  }

  /**
   * Execute a specific tool with given arguments
   */
  private async executeTool(toolName: string, args: any): Promise<any> {
    const agent = await this.initializeAgent();
    
    try {
      // Create a mock MCP request to the agent
      const mockRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args
        }
      };

      // Since the agent uses the MCP SDK internally, we need to manually invoke the tool
      // For now, we'll handle the most common tools directly and delegate others to specific implementations
      
      switch (toolName) {
        case 'get_server_status':
        case 'health_check':
          return await this.toolGetStatus();
          
        case 'debug_pocketbase_auth':
          return await this.debugPocketBaseAuth();
          
        case 'check_pocketbase_write_permissions':
          return await this.checkPocketBaseWritePermissions();
          
        case 'analyze_pocketbase_capabilities':
          return await this.analyzePocketBaseCapabilities();
          
        case 'pocketbase_super_admin_auth':
          return await this.pocketBaseSuperAdminAuth(args.email, args.password);
          
        // PocketBase tools that require direct implementation
        case 'pocketbase_list_collections':
          return await this.toolListCollections();
        case 'pocketbase_create_record':
          return await this.toolCreateRecord(args.collection, args.data);
        case 'pocketbase_get_record':
          return await this.toolGetRecord(args.collection, args.id);
        case 'pocketbase_list_records':
          return await this.toolListRecords(args.collection, args.filter, args.sort, args.page, args.perPage);
        case 'pocketbase_update_record':
          return await this.toolUpdateRecord(args.collection, args.id, args.data);
        case 'pocketbase_delete_record':
          return await this.toolDeleteRecord(args.collection, args.id);
          
        // For all other tools, return a helpful message indicating the tool exists but requires configuration
        default:
          return this.createToolResponse(toolName, args);
      }
    } catch (error: any) {
      console.error(`Tool execution error for ${toolName}:`, error);
      return {
        success: false,
        error: `Failed to execute tool ${toolName}: ${error.message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Create a response for tools that require specific service configuration
   */
  private createToolResponse(toolName: string, args: any): any {
    // Determine which service the tool belongs to
    if (toolName.startsWith('stripe_')) {
      return {
        success: false,
        error: 'Stripe tools require STRIPE_SECRET_KEY environment variable to be configured.',
        tool: toolName,
        arguments: args,
        hint: 'Set STRIPE_SECRET_KEY in your Cloudflare Worker environment variables to enable Stripe functionality.',
        timestamp: new Date().toISOString()
      };
    } else if (toolName.startsWith('email_')) {
      return {
        success: false,
        error: 'Email tools require EMAIL_SERVICE (sendgrid) or SMTP configuration.',
        tool: toolName,
        arguments: args,
        hint: 'Set SENDGRID_API_KEY or SMTP_HOST, SMTP_USER, SMTP_PASS environment variables to enable email functionality.',
        timestamp: new Date().toISOString()
      };
    } else if (toolName.startsWith('pocketbase_')) {
      return {
        success: false,
        error: 'PocketBase tools require POCKETBASE_URL environment variable to be configured.',
        tool: toolName,
        arguments: args,
        hint: 'Set POCKETBASE_URL (and optionally POCKETBASE_ADMIN_EMAIL, POCKETBASE_ADMIN_PASSWORD) in your Cloudflare Worker environment variables to enable PocketBase functionality.',
        timestamp: new Date().toISOString()
      };
    } else {
      return {
        success: false,
        error: `Tool ${toolName} is available but requires proper configuration.`,
        tool: toolName,
        arguments: args,
        hint: 'Check the documentation for required environment variables for this tool.',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Tool implementations with enhanced error handling and retry logic
   */
  private async toolListCollections(): Promise<any> {
    console.log('toolListCollections called');
    
    try {
      const collections = await this.executePBOperation(
        async (pb) => await pb.collections.getFullList(200),
        'toolListCollections'
      );
      
      console.log(`Found ${collections.length} collections`);
      
      return {
        success: true,
        count: collections.length,
        collections: collections.map((col: any) => ({
          id: col.id,
          name: col.name,
          type: col.type,
          system: col.system || false,
          schema: col.schema || [],
          listRule: col.listRule,
          viewRule: col.viewRule,
          createRule: col.createRule,
          updateRule: col.updateRule,
          deleteRule: col.deleteRule
        })),
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      console.error('toolListCollections error:', error);
      return { 
        success: false, 
        error: `Failed to list collections: ${error.message}`,
        code: error.status || 'UNKNOWN_ERROR',
        hint: error.status === 401 ? 'Authentication may be required or expired' : 
              error.status === 403 ? 'Insufficient permissions to list collections' :
              'Check PocketBase connection and configuration',
        timestamp: new Date().toISOString()
      };
    }
  }

  private async toolCreateRecord(collection: string, data: any): Promise<any> {
    console.log(`toolCreateRecord called for collection: ${collection}`);
    
    try {
      const record = await this.executePBOperation(
        async (pb) => await pb.collection(collection).create(data),
        `toolCreateRecord:${collection}`
      );
      
      console.log('Record created successfully:', record.id);
      
      return { 
        success: true, 
        record,
        message: `Record created successfully in collection '${collection}'`,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      console.error(`toolCreateRecord error for collection ${collection}:`, error);
      
      // Enhanced error handling for common PocketBase errors
      let userFriendlyError = error.message;
      let hint = 'Check your data and try again';
      
      if (error.status === 400) {
        userFriendlyError = `Invalid data provided for collection '${collection}': ${error.message}`;
        hint = 'Verify that all required fields are provided and data types are correct';
      } else if (error.status === 403) {
        userFriendlyError = `Access denied: You don't have permission to create records in collection '${collection}'`;
        hint = 'Check collection rules or authentication status';
      } else if (error.status === 404) {
        userFriendlyError = `Collection '${collection}' not found`;
        hint = 'Verify the collection name is correct';
      } else if (error.status === 401) {
        userFriendlyError = 'Authentication required or expired';
        hint = 'Check your authentication credentials';
      }
      
      return { 
        success: false, 
        error: userFriendlyError,
        collection,
        code: error.status || 'UNKNOWN_ERROR',
        hint,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async toolGetRecord(collection: string, id: string): Promise<any> {
    console.log(`toolGetRecord called for collection: ${collection}, id: ${id}`);
    
    try {
      const record = await this.executePBOperation(
        async (pb) => await pb.collection(collection).getOne(id),
        `toolGetRecord:${collection}:${id}`
      );
      
      console.log('Record fetched successfully');
      
      return { 
        success: true, 
        record,
        collection,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      console.error(`toolGetRecord error for collection ${collection}, id ${id}:`, error);
      
      let userFriendlyError = error.message;
      let hint = 'Check the record ID and try again';
      
      if (error.status === 404) {
        userFriendlyError = `Record with ID '${id}' not found in collection '${collection}'`;
        hint = 'Verify the record ID is correct and the record exists';
      } else if (error.status === 403) {
        userFriendlyError = `Access denied: You don't have permission to view this record in collection '${collection}'`;
        hint = 'Check collection view rules or authentication status';
      } else if (error.status === 401) {
        userFriendlyError = 'Authentication required or expired';
        hint = 'Check your authentication credentials';
      }
      
      return { 
        success: false, 
        error: userFriendlyError,
        collection,
        recordId: id,
        code: error.status || 'UNKNOWN_ERROR',
        hint,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async toolListRecords(collection: string, filter?: string, sort?: string, page?: number, perPage?: number): Promise<any> {
    console.log(`toolListRecords called for collection: ${collection}`);
    
    try {
      const pageNum = page || 1;
      const perPageNum = perPage || 30;
      
      const records = await this.executePBOperation(
        async (pb) => {
          const options: any = {};
          if (filter) {
            options.filter = filter;
            console.log('Applied filter:', filter);
          }
          if (sort) {
            options.sort = sort;
            console.log('Applied sort:', sort);
          }
          
          return await pb.collection(collection).getList(pageNum, perPageNum, options);
        },
        `toolListRecords:${collection}`
      );
      
      console.log(`Found ${records.items.length} records (total: ${records.totalItems})`);
      
      return {
        success: true,
        collection,
        page: records.page,
        perPage: records.perPage,
        totalItems: records.totalItems,
        totalPages: records.totalPages,
        items: records.items,
        filter: filter || null,
        sort: sort || null,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      console.error(`toolListRecords error for collection ${collection}:`, error);
      
      let userFriendlyError = error.message;
      let hint = 'Check your filter and sort parameters';
      
      if (error.status === 400) {
        userFriendlyError = `Invalid filter or sort parameters for collection '${collection}': ${error.message}`;
        hint = 'Verify filter syntax and field names in sort parameter';
      } else if (error.status === 403) {
        userFriendlyError = `Access denied: You don't have permission to list records in collection '${collection}'`;
        hint = 'Check collection list rules or authentication status';
      } else if (error.status === 404) {
        userFriendlyError = `Collection '${collection}' not found`;
        hint = 'Verify the collection name is correct';
      } else if (error.status === 401) {
        userFriendlyError = 'Authentication required or expired';
        hint = 'Check your authentication credentials';
      }
      
      return { 
        success: false, 
        error: userFriendlyError,
        collection,
        filter: filter || null,
        sort: sort || null,
        code: error.status || 'UNKNOWN_ERROR',
        hint,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async toolUpdateRecord(collection: string, id: string, data: any): Promise<any> {
    console.log(`toolUpdateRecord called for collection: ${collection}, id: ${id}`);
    
    try {
      const record = await this.executePBOperation(
        async (pb) => await pb.collection(collection).update(id, data),
        `toolUpdateRecord:${collection}:${id}`
      );
      
      console.log('Record updated successfully');
      
      return { 
        success: true, 
        record,
        collection,
        message: `Record '${id}' updated successfully in collection '${collection}'`,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      console.error(`toolUpdateRecord error for collection ${collection}, id ${id}:`, error);
      
      let userFriendlyError = error.message;
      let hint = 'Check your data and record ID';
      
      if (error.status === 400) {
        userFriendlyError = `Invalid data provided for updating record '${id}' in collection '${collection}': ${error.message}`;
        hint = 'Verify data types and required fields';
      } else if (error.status === 403) {
        userFriendlyError = `Access denied: You don't have permission to update this record in collection '${collection}'`;
        hint = 'Check collection update rules or authentication status';
      } else if (error.status === 404) {
        userFriendlyError = `Record with ID '${id}' not found in collection '${collection}'`;
        hint = 'Verify the record ID is correct and the record exists';
      } else if (error.status === 401) {
        userFriendlyError = 'Authentication required or expired';
        hint = 'Check your authentication credentials';
      }
      
      return { 
        success: false, 
        error: userFriendlyError,
        collection,
        recordId: id,
        code: error.status || 'UNKNOWN_ERROR',
        hint,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async toolDeleteRecord(collection: string, id: string): Promise<any> {
    console.log(`toolDeleteRecord called for collection: ${collection}, id: ${id}`);
    
    try {
      await this.executePBOperation(
        async (pb) => await pb.collection(collection).delete(id),
        `toolDeleteRecord:${collection}:${id}`
      );
      
      console.log('Record deleted successfully');
      
      return { 
        success: true, 
        message: `Record '${id}' deleted from collection '${collection}'`,
        collection,
        recordId: id,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      console.error(`toolDeleteRecord error for collection ${collection}, id ${id}:`, error);
      
      let userFriendlyError = error.message;
      let hint = 'Check the record ID and your permissions';
      
      if (error.status === 403) {
        userFriendlyError = `Access denied: You don't have permission to delete this record in collection '${collection}'`;
        hint = 'Check collection delete rules or authentication status';
      } else if (error.status === 404) {
        userFriendlyError = `Record with ID '${id}' not found in collection '${collection}'`;
        hint = 'Verify the record ID is correct and the record exists';
      } else if (error.status === 401) {
        userFriendlyError = 'Authentication required or expired';
        hint = 'Check your authentication credentials';
      }
      
      return { 
        success: false, 
        error: userFriendlyError,
        collection,
        recordId: id,
        code: error.status || 'UNKNOWN_ERROR',
        hint,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async toolGetStatus(): Promise<any> {
    console.log('toolGetStatus called');
    
    try {
      const agent = await this.initializeAgent();
      
      // Test PocketBase connection
      const pbConnectionTest = await this.testPocketBaseConnection();
      
      return {
        success: true,
        status: {
          durableObject: {
            id: this.state.id.toString(),
            lastActivity: new Date(this.lastActivity).toISOString(),
            activeSessions: this.sessions.size,
            initialized: this.initialized
          },
          agent: agent.getState(),
          pocketbase: {
            configured: Boolean(this.env.POCKETBASE_URL),
            connectionTest: pbConnectionTest,
            instance: {
              initialized: this.pbInitialized,
              authenticated: this.pbAuthValid,
              lastAuth: this.pbLastAuth ? new Date(this.pbLastAuth).toISOString() : null,
              authAge: this.pbLastAuth ? Date.now() - this.pbLastAuth : null
            }
          },
          capabilities: {
            pocketbaseUrl: Boolean(this.env.POCKETBASE_URL),
            hasAdminAuth: Boolean(this.env.POCKETBASE_ADMIN_EMAIL && this.env.POCKETBASE_ADMIN_PASSWORD),
            hasStripe: Boolean(this.env.STRIPE_SECRET_KEY),
            hasEmail: Boolean(this.env.EMAIL_SERVICE || this.env.SMTP_HOST)
          },
          environment: {
            pocketbaseUrl: this.env.POCKETBASE_URL ? 'configured' : 'missing',
            adminEmail: this.env.POCKETBASE_ADMIN_EMAIL ? 'configured' : 'missing',
            adminPassword: this.env.POCKETBASE_ADMIN_PASSWORD ? 'configured' : 'missing',
            stripeKey: this.env.STRIPE_SECRET_KEY ? 'configured' : 'missing',
            emailService: this.env.EMAIL_SERVICE || 'not configured'
          },
          timestamp: new Date().toISOString()
        }
      };
    } catch (error: any) {
      console.error('toolGetStatus error:', error);
      return {
        success: false,
        error: `Failed to get status: ${error.message}`,
        timestamp: new Date().toISOString()
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
        shouldHibernate: false // Comprehensive agent handles its own state
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
   * Handle MCP over HTTP requests (SSE endpoint)
   */
  private async handleSSE(request: Request): Promise<Response> {
    // Handle CORS preflight
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

    // Initialize agent if needed
    const agent = await this.initializeAgent();
    
    // Update activity
    this.lastActivity = Date.now();

    if (request.method === 'POST') {
      // Handle MCP message via POST request
      try {
        const message = await request.json();
        console.log('Received MCP message:', JSON.stringify(message, null, 2));
        
        // Process the MCP message using the agent's server
        const response = await this.processMCPMessage(message);
        console.log('Sending MCP response:', JSON.stringify(response, null, 2));
        
        // Persist state after processing
        await this.persistAgentState();
        
        return new Response(JSON.stringify(response), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
          }
        });
      } catch (error: any) {
        console.error('Error processing MCP message:', error);
        const errorResponse = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32603,
            message: 'Internal error',
            data: error.message
          }
        };
        
        return new Response(JSON.stringify(errorResponse), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    } else if (request.method === 'GET') {
      // Handle SSE connection for streaming (if needed)
      const headers = new Headers({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type'
      });

      const stream = new ReadableStream({
        start(controller) {
          // Send initial connection event
          const initEvent = `data: ${JSON.stringify({
            type: 'connected',
            server: 'PocketBase MCP Server',
            version: '1.0.0',
            timestamp: new Date().toISOString()
          })}\n\n`;
          
          controller.enqueue(new TextEncoder().encode(initEvent));
          
          // Send periodic heartbeat
          const heartbeatInterval = setInterval(() => {
            try {
              const heartbeat = `data: ${JSON.stringify({ 
                type: 'heartbeat', 
                timestamp: new Date().toISOString() 
              })}\n\n`;
              controller.enqueue(new TextEncoder().encode(heartbeat));
            } catch (error) {
              console.error('SSE heartbeat error:', error);
              clearInterval(heartbeatInterval);
              controller.close();
            }
          }, 30000);

          // Clean up after 5 minutes
          setTimeout(() => {
            clearInterval(heartbeatInterval);
            controller.close();
          }, 300000);
        }
      });

      return new Response(stream, { headers });
    } else {
      return new Response('Method not allowed', { status: 405 });
    }
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
      // Agent is now awake - no specific wakeUp method needed
    }
    this.lastActivity = Date.now();
    
    return new Response(JSON.stringify({ message: 'Woke up successfully' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Clean up agent resources
   */
  private async hibernate(): Promise<void> {
    console.log('Hibernating Durable Object...');
    
    // Close all WebSocket connections
    for (const [sessionId, ws] of this.sessions) {
      try {
        ws.close(1001, 'Hibernating');
      } catch (error) {
        console.warn(`Error closing WebSocket ${sessionId}:`, error);
      }
    }
    this.sessions.clear();

    // Persist final state
    await this.persistAgentState();

    // Clean up PocketBase connection
    if (this.pb) {
      try {
        // Clear any stored auth data
        this.pb.authStore.clear();
      } catch (error) {
        console.warn('Error clearing PocketBase auth:', error);
      }
      this.pb = null;
      this.pbInitialized = false;
      this.pbAuthValid = false;
      this.pbLastAuth = 0;
    }

    // Clean up agent resources
    if (this.agent) {
      // Cleanup resources - no specific cleanup method needed for this agent
      this.agent = null;
    }

    this.initialized = false;
    console.log('Durable Object hibernated successfully');
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

  /**
   * Get or create PocketBase instance with proper session management
   */
  private async getPocketBaseInstance(): Promise<PocketBase | null> {
    if (!this.env.POCKETBASE_URL) {
      console.warn('POCKETBASE_URL not configured');
      return null;
    }

    // Create new instance if needed
    if (!this.pb) {
      console.log('Creating new PocketBase instance:', this.env.POCKETBASE_URL);
      this.pb = new PocketBase(this.env.POCKETBASE_URL);
      this.pbInitialized = false;
      this.pbAuthValid = false;
    }

    // Check if we need to re-authenticate (every 30 minutes)
    const now = Date.now();
    const authAge = now - this.pbLastAuth;
    const thirtyMinutes = 30 * 60 * 1000;

    if (!this.pbAuthValid || authAge > thirtyMinutes) {
      console.log('Authenticating with PocketBase...');
      
      // Authenticate if credentials are available
      if (this.env.POCKETBASE_ADMIN_EMAIL && this.env.POCKETBASE_ADMIN_PASSWORD) {
        try {
          await this.pb.collection('_superusers').authWithPassword(
            this.env.POCKETBASE_ADMIN_EMAIL,
            this.env.POCKETBASE_ADMIN_PASSWORD
          );
          
          this.pbLastAuth = now;
          this.pbAuthValid = true;
          this.pbInitialized = true;
          
          console.log('PocketBase authentication successful');
        } catch (error: any) {
          console.error('PocketBase authentication failed:', error.message);
          this.pbAuthValid = false;
          
          // If auth fails, try without authentication for public operations
          console.log('Continuing without authentication for public operations only');
        }
      } else {
        console.log('No admin credentials provided, using unauthenticated access');
        this.pbAuthValid = false;
        this.pbInitialized = true;
      }
    }

    // Test connection with a simple operation
    if (this.pbInitialized) {
      try {
        // Try to fetch server health - this should work even without auth
        await this.pb.health.check();
        console.log('PocketBase connection verified');
      } catch (error: any) {
        console.error('PocketBase connection test failed:', error.message);
        
        // Reset the instance and try to reconnect
        this.pb = null;
        this.pbInitialized = false;
        this.pbAuthValid = false;
        
        // Recursive call to try again (only once)
        if (authAge < thirtyMinutes) {
          return await this.getPocketBaseInstance();
        }
        
        return null;
      }
    }

    return this.pb;
  }

  /**
   * Get tools from the comprehensive agent
   */
  private async getToolsFromAgent(): Promise<any[]> {
    const agent = await this.initializeAgent();
    
    // Since the agent uses the MCP SDK internally, we need to extract tool definitions
    // The agent.server should have the tools registered
    const tools: any[] = [];
    
    // Define all 77 tools that should be available
    const toolDefinitions = [
      // PocketBase tools
      { name: 'pocketbase_list_collections', description: 'List all available PocketBase collections', inputSchema: { type: 'object', properties: {} } },
      { name: 'pocketbase_get_collection', description: 'Get detailed information about a specific collection', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Collection name' } }, required: ['name'] } },
      { name: 'pocketbase_create_record', description: 'Create a new record in a collection', inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'Collection name' }, data: { type: 'object', description: 'Record data' } }, required: ['collection', 'data'] } },
      { name: 'pocketbase_get_record', description: 'Get a specific record by ID', inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'Collection name' }, id: { type: 'string', description: 'Record ID' } }, required: ['collection', 'id'] } },
      { name: 'pocketbase_update_record', description: 'Update an existing record', inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'Collection name' }, id: { type: 'string', description: 'Record ID' }, data: { type: 'object', description: 'Updated data' } }, required: ['collection', 'id', 'data'] } },
      { name: 'pocketbase_delete_record', description: 'Delete a record by ID', inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'Collection name' }, id: { type: 'string', description: 'Record ID' } }, required: ['collection', 'id'] } },
      { name: 'pocketbase_list_records', description: 'List records with filtering and pagination', inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'Collection name' }, page: { type: 'number', description: 'Page number (default: 1)' }, perPage: { type: 'number', description: 'Records per page (default: 30)' }, filter: { type: 'string', description: 'Filter query' }, sort: { type: 'string', description: 'Sort criteria' } }, required: ['collection'] } },
      { name: 'pocketbase_auth_with_password', description: 'Authenticate with email and password', inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'User collection (e.g., "users")' }, email: { type: 'string', description: 'User email' }, password: { type: 'string', description: 'User password' } }, required: ['collection', 'email', 'password'] } },
      { name: 'pocketbase_auth_with_oauth2', description: 'Authenticate with OAuth2 provider', inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'User collection' }, provider: { type: 'string', description: 'OAuth2 provider (google, github, etc.)' }, code: { type: 'string', description: 'OAuth2 authorization code' }, codeVerifier: { type: 'string', description: 'PKCE code verifier' }, redirectUrl: { type: 'string', description: 'OAuth2 redirect URL' } }, required: ['collection', 'provider', 'code'] } },
      { name: 'pocketbase_auth_refresh', description: 'Refresh authentication token', inputSchema: { type: 'object', properties: {} } },
      { name: 'pocketbase_request_password_reset', description: 'Request password reset email', inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'User collection' }, email: { type: 'string', description: 'User email' } }, required: ['collection', 'email'] } },
      { name: 'pocketbase_confirm_password_reset', description: 'Confirm password reset with token', inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'User collection' }, token: { type: 'string', description: 'Reset token' }, password: { type: 'string', description: 'New password' }, passwordConfirm: { type: 'string', description: 'Confirm new password' } }, required: ['collection', 'token', 'password', 'passwordConfirm'] } },
      { name: 'pocketbase_upload_file', description: 'Upload a file to a record', inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'Collection name' }, recordId: { type: 'string', description: 'Record ID' }, field: { type: 'string', description: 'File field name' }, file: { type: 'string', description: 'File content (base64 encoded)' }, filename: { type: 'string', description: 'Original filename' } }, required: ['collection', 'recordId', 'field', 'file', 'filename'] } },
      { name: 'pocketbase_delete_file', description: 'Delete a file from a record', inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'Collection name' }, recordId: { type: 'string', description: 'Record ID' }, field: { type: 'string', description: 'File field name' }, filename: { type: 'string', description: 'Filename to delete' } }, required: ['collection', 'recordId', 'field', 'filename'] } },
      { name: 'pocketbase_subscribe_record', description: 'Subscribe to record changes (returns subscription info)', inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'Collection name' }, recordId: { type: 'string', description: 'Record ID' } }, required: ['collection', 'recordId'] } },
      { name: 'pocketbase_create_collection', description: 'Create a new collection (admin only)', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Collection name' }, type: { type: 'string', description: 'Collection type (base, auth, view)' }, schema: { type: 'array', items: { type: 'object' }, description: 'Collection schema fields' }, options: { type: 'object', description: 'Collection options' } }, required: ['name', 'type'] } },
      { name: 'pocketbase_update_collection', description: 'Update collection schema (admin only)', inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Collection ID' }, name: { type: 'string', description: 'Collection name' }, schema: { type: 'array', items: { type: 'object' }, description: 'Updated schema fields' }, options: { type: 'object', description: 'Collection options' } }, required: ['id'] } },
      { name: 'pocketbase_delete_collection', description: 'Delete a collection (admin only)', inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Collection ID' } }, required: ['id'] } },
      { name: 'pocketbase_export_collection', description: 'Export collection data as JSON', inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'Collection name' }, format: { type: 'string', description: 'Export format (json, csv)', enum: ['json', 'csv'] } }, required: ['collection'] } },
      { name: 'pocketbase_batch_create', description: 'Create multiple records in batch', inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'Collection name' }, records: { type: 'array', items: { type: 'object' }, description: 'Array of record data objects' } }, required: ['collection', 'records'] } },
      { name: 'pocketbase_batch_update', description: 'Update multiple records in batch', inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'Collection name' }, updates: { type: 'array', items: { type: 'object' }, description: 'Array of {id, data} objects' } }, required: ['collection', 'updates'] } },
      { name: 'pocketbase_search_records', description: 'Search records with full-text search', inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'Collection name' }, query: { type: 'string', description: 'Search query' }, fields: { type: 'array', items: { type: 'string' }, description: 'Fields to search in' }, limit: { type: 'number', description: 'Maximum results' } }, required: ['collection', 'query'] } },
      { name: 'pocketbase_get_stats', description: 'Get collection statistics', inputSchema: { type: 'object', properties: { collection: { type: 'string', description: 'Collection name' } }, required: ['collection'] } },
      
      // Stripe tools
      { name: 'stripe_create_customer', description: 'Create a new Stripe customer', inputSchema: { type: 'object', properties: { email: { type: 'string', description: 'Customer email' }, name: { type: 'string', description: 'Customer name' }, metadata: { type: 'object', description: 'Custom metadata' } }, required: ['email'] } },
      { name: 'stripe_get_customer', description: 'Retrieve a Stripe customer by ID', inputSchema: { type: 'object', properties: { customerId: { type: 'string', description: 'Stripe customer ID' } }, required: ['customerId'] } },
      { name: 'stripe_create_payment_intent', description: 'Create a payment intent for processing payments', inputSchema: { type: 'object', properties: { amount: { type: 'number', description: 'Amount in cents' }, currency: { type: 'string', description: 'Currency code (e.g., USD)' }, description: { type: 'string', description: 'Payment description' } }, required: ['amount', 'currency'] } },
      { name: 'stripe_create_product', description: 'Create a new Stripe product', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Product name' }, description: { type: 'string', description: 'Product description' }, price: { type: 'number', description: 'Price in cents' }, currency: { type: 'string', description: 'Currency code' } }, required: ['name', 'price'] } },
      { name: 'stripe_cancel_subscription', description: 'Cancel a subscription', inputSchema: { type: 'object', properties: { subscriptionId: { type: 'string', description: 'Subscription ID' }, atPeriodEnd: { type: 'boolean', description: 'Cancel at period end' } }, required: ['subscriptionId'] } },
      { name: 'stripe_create_payment_method', description: 'Create a payment method', inputSchema: { type: 'object', properties: { type: { type: 'string', description: 'Payment method type (card, sepa_debit, etc.)' }, card: { type: 'object', description: 'Card details' }, metadata: { type: 'object', description: 'Payment method metadata' } }, required: ['type'] } },
      { name: 'stripe_attach_payment_method', description: 'Attach payment method to customer', inputSchema: { type: 'object', properties: { paymentMethodId: { type: 'string', description: 'Payment method ID' }, customerId: { type: 'string', description: 'Customer ID' } }, required: ['paymentMethodId', 'customerId'] } },
      { name: 'stripe_list_payment_methods', description: 'List customer payment methods', inputSchema: { type: 'object', properties: { customerId: { type: 'string', description: 'Customer ID' }, type: { type: 'string', description: 'Payment method type filter' } }, required: ['customerId'] } },
      { name: 'stripe_create_checkout_session', description: 'Create a Checkout session', inputSchema: { type: 'object', properties: { priceId: { type: 'string', description: 'Price ID' }, successUrl: { type: 'string', description: 'Success redirect URL' }, cancelUrl: { type: 'string', description: 'Cancel redirect URL' }, customerId: { type: 'string', description: 'Customer ID' }, customerEmail: { type: 'string', description: 'Customer Email' }, mode: { type: 'string', description: 'Mode (payment, subscription, setup)' }, metadata: { type: 'object', description: 'Session metadata' } }, required: ['priceId', 'successUrl', 'cancelUrl'] } },
      { name: 'stripe_create_refund', description: 'Create a refund', inputSchema: { type: 'object', properties: { paymentIntentId: { type: 'string', description: 'Payment Intent ID' }, chargeId: { type: 'string', description: 'Charge ID' }, amount: { type: 'number', description: 'Refund amount in cents' }, reason: { type: 'string', description: 'Refund reason' }, metadata: { type: 'object', description: 'Refund metadata' } } } },
      { name: 'stripe_handle_webhook', description: 'Handle Stripe webhook event', inputSchema: { type: 'object', properties: { body: { type: 'string', description: 'Webhook payload' }, signature: { type: 'string', description: 'Stripe signature header' } }, required: ['body', 'signature'] } },
      
      // Email tools
      { name: 'email_send_templated', description: 'Send a templated email', inputSchema: { type: 'object', properties: { template: { type: 'string', description: 'Template name' }, to: { type: 'string', description: 'Recipient email' }, from: { type: 'string', description: 'Sender email' }, variables: { type: 'object', description: 'Template variables' } }, required: ['template', 'to'] } },
      { name: 'email_send_simple', description: 'Send a custom email', inputSchema: { type: 'object', properties: { to: { type: 'string', description: 'Recipient email' }, subject: { type: 'string', description: 'Email subject' }, htmlContent: { type: 'string', description: 'Email HTML content' }, textContent: { type: 'string', description: 'Email text content' }, from: { type: 'string', description: 'Sender email' } }, required: ['to', 'subject', 'htmlContent'] } },
      { name: 'email_send_bulk', description: 'Send bulk emails', inputSchema: { type: 'object', properties: { emails: { type: 'array', items: { type: 'object' }, description: 'Array of email objects' }, batchSize: { type: 'number', description: 'Batch size for sending' } }, required: ['emails'] } },
      { name: 'email_create_template', description: 'Create an email template', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Template name' }, subject: { type: 'string', description: 'Email subject template' }, body: { type: 'string', description: 'Email body template (HTML)' }, variables: { type: 'array', items: { type: 'string' }, description: 'Template variable names' }, description: { type: 'string', description: 'Template description' } }, required: ['name', 'subject', 'body'] } },
      
      // Utility tools
      { name: 'get_server_status', description: 'Get comprehensive server status and configuration', inputSchema: { type: 'object', properties: {} } },
      { name: 'health_check', description: 'Simple health check endpoint', inputSchema: { type: 'object', properties: {} } },
      { name: 'debug_pocketbase_auth', description: 'Run comprehensive PocketBase authentication and connection debugging', inputSchema: { type: 'object', properties: {} } },
      { name: 'check_pocketbase_write_permissions', description: 'Test PocketBase write operations to diagnose read-only mode issues', inputSchema: { type: 'object', properties: {} } },
      { name: 'analyze_pocketbase_capabilities', description: 'Analyze and document available vs restricted PocketBase operations', inputSchema: { type: 'object', properties: {} } }
    ];
    
    return toolDefinitions;
  }

  /**
   * Get fallback tools list
   */
  private async getFallbackTools(): Promise<any[]> {
    return [
      {
        name: 'pocketbase_list_collections',
        description: 'List all available PocketBase collections',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get_server_status',
        description: 'Get server status and configuration',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      }
    ];
  }

  /**
   * Test PocketBase connection and authentication
   */
  private async testPocketBaseConnection(): Promise<{ success: boolean; error?: string; details?: any }> {
    try {
      const pb = await this.getPocketBaseInstance();
      
      if (!pb) {
        return {
          success: false,
          error: 'PocketBase instance not available',
          details: { pocketbaseUrl: this.env.POCKETBASE_URL }
        };
      }

      // Test basic health check
      await pb.health.check();
      
      // Test collections access (this should work even without auth for public operations)
      const collections = await pb.collections.getFullList(1); // Just get 1 to test
      
      return {
        success: true,
        details: {
          url: this.env.POCKETBASE_URL,
          authenticated: this.pbAuthValid,
          collectionsCount: collections.length,
          lastAuth: this.pbLastAuth ? new Date(this.pbLastAuth).toISOString() : null
        }
      };
    } catch (error: any) {
      console.error('PocketBase connection test failed:', error);
      
      // Reset connection state on failure
      this.pb = null;
      this.pbInitialized = false;
      this.pbAuthValid = false;
      
      return {
        success: false,
        error: error.message,
        details: {
          status: error.status,
          url: this.env.POCKETBASE_URL,
          isNetworkError: error.message?.includes('fetch') || error.message?.includes('network')
        }
      };
    }
  }

  /**
   * Execute PocketBase operation with retry logic
   */
  private async executePBOperation<T>(operation: (pb: PocketBase) => Promise<T>, operationName: string): Promise<T> {
    const maxRetries = 2;
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`${operationName}: attempt ${attempt}/${maxRetries}`);
        
        const pb = await this.getPocketBaseInstance();
        if (!pb) {
          throw new Error('PocketBase instance not available - check POCKETBASE_URL configuration');
        }
        
        const result = await operation(pb);
        console.log(`${operationName}: success on attempt ${attempt}`);
        return result;
        
      } catch (error: any) {
        console.error(`${operationName}: failed on attempt ${attempt}:`, error.message);
        lastError = error;
        
        // On certain errors, reset the connection and try again
        if (attempt < maxRetries && (
          error.status === 401 ||   // Unauthorized - may need re-auth
          error.status === 403 ||   // Forbidden - may need re-auth  
          error.message?.includes('fetch') ||  // Network errors
          error.message?.includes('network') ||
          error.message?.includes('timeout')
        )) {
          console.log(`${operationName}: resetting connection and retrying...`);
          this.pb = null;
          this.pbInitialized = false;
          this.pbAuthValid = false;
          this.pbLastAuth = 0;
          
          // Small delay before retry
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          // For other errors or on final attempt, break immediately
          break;
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Debug PocketBase authentication and connection
   */
  private async debugPocketBaseAuth(): Promise<any> {
    console.log('=== PocketBase Debug Session ===');
    
    const debug = {
      timestamp: new Date().toISOString(),
      environment: {
        pocketbaseUrl: this.env.POCKETBASE_URL || 'NOT_SET',
        hasAdminEmail: Boolean(this.env.POCKETBASE_ADMIN_EMAIL),
        hasAdminPassword: Boolean(this.env.POCKETBASE_ADMIN_PASSWORD),
        adminEmailValue: this.env.POCKETBASE_ADMIN_EMAIL ? 'SET' : 'NOT_SET'
      },
      instance: {
        pbExists: Boolean(this.pb),
        pbInitialized: this.pbInitialized,
        pbAuthValid: this.pbAuthValid,
        pbLastAuth: this.pbLastAuth,
        authAge: this.pbLastAuth ? Date.now() - this.pbLastAuth : null
      },
      tests: {
        healthCheck: null as any,
        collectionsTest: null as any,
        authTest: null as any
      }
    };

    if (!this.env.POCKETBASE_URL) {
      debug.tests.healthCheck = { success: false, error: 'POCKETBASE_URL not configured' };
      return debug;
    }

    try {
      // Test 1: Basic health check
      console.log('Testing PocketBase health...');
      const pb = new PocketBase(this.env.POCKETBASE_URL);
      await pb.health.check();
      debug.tests.healthCheck = { success: true, message: 'Health check passed' };
      console.log('✅ Health check passed');

      // Test 2: Collections without auth
      console.log('Testing collections access without auth...');
      try {
        const collections = await pb.collections.getFullList(5);
        debug.tests.collectionsTest = { 
          success: true, 
          message: `Found ${collections.length} collections without auth`,
          collections: collections.map(c => ({ id: c.id, name: c.name, type: c.type }))
        };
        console.log(`✅ Collections access: found ${collections.length} collections`);
      } catch (error: any) {
        debug.tests.collectionsTest = { 
          success: false, 
          error: error.message, 
          status: error.status,
          needsAuth: error.status === 401 || error.status === 403
        };
        console.log(`❌ Collections access failed: ${error.message}`);
      }

      // Test 3: Authentication
      if (this.env.POCKETBASE_ADMIN_EMAIL && this.env.POCKETBASE_ADMIN_PASSWORD) {
        console.log('Testing admin authentication...');
        try {
          const authResult = await pb.collection('_superusers').authWithPassword(
            this.env.POCKETBASE_ADMIN_EMAIL,
            this.env.POCKETBASE_ADMIN_PASSWORD
          );
          
          debug.tests.authTest = { 
            success: true, 
            message: 'Authentication successful',
            user: {
              id: authResult.record?.id,
              email: authResult.record?.email
            },
            token: authResult.token ? 'PRESENT' : 'MISSING'
          };
          console.log('✅ Authentication successful');

          // Test collections again with auth
          console.log('Testing collections access with auth...');
          try {
            const authCollections = await pb.collections.getFullList(5);
            debug.tests.collectionsTest.withAuth = {
              success: true,
              count: authCollections.length,
              message: `Found ${authCollections.length} collections with auth`
            };
            console.log(`✅ Authenticated collections access: found ${authCollections.length} collections`);
          } catch (error: any) {
            debug.tests.collectionsTest.withAuth = {
              success: false,
              error: error.message,
              status: error.status
            };
            console.log(`❌ Authenticated collections access failed: ${error.message}`);
          }

        } catch (error: any) {
          debug.tests.authTest = { 
            success: false, 
            error: error.message, 
            status: error.status,
            hint: error.status === 400 ? 'Invalid credentials' : 
                  error.status === 404 ? 'Admin user not found' :
                  'Authentication system error'
          };
          console.log(`❌ Authentication failed: ${error.message}`);
        }
      } else {
        debug.tests.authTest = { 
          success: false, 
          error: 'Admin credentials not configured',
          hint: 'Set POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD'
        };
        console.log('⚠️ Admin credentials not configured');
      }

    } catch (error: any) {
      debug.tests.healthCheck = { 
        success: false, 
        error: error.message,
        hint: 'Check if PocketBase URL is correct and server is running'
      };
      console.log(`❌ Health check failed: ${error.message}`);
    }

    console.log('=== Debug Session Complete ===');
    return debug;
  }

  /**
   * Check if PocketBase is in read-only mode by testing write operations
   */
  private async checkPocketBaseWritePermissions(): Promise<any> {
    console.log('=== PocketBase Write Permissions Check ===');
    
    const result = {
      timestamp: new Date().toISOString(),
      readOperations: {
        healthCheck: null as any,
        listCollections: null as any,
      },
      writeOperations: {
        createTest: null as any,
        updateTest: null as any,
        deleteTest: null as any
      },
      analysis: {
        isReadOnly: false,
        possibleCauses: [] as string[]
      }
    };

    try {
      const pb = await this.getPocketBaseInstance();
      if (!pb) {
        return { success: false, error: 'PocketBase instance not available' };
      }

      // Test 1: Health check
      console.log('Testing health check...');
      try {
        await pb.health.check();
        result.readOperations.healthCheck = { success: true };
        console.log('✅ Health check passed');
      } catch (error: any) {
        result.readOperations.healthCheck = { success: false, error: error.message };
        console.log(`❌ Health check failed: ${error.message}`);
        return result;
      }

      // Test 2: List collections
      console.log('Testing list collections...');
      try {
        const collections = await pb.collections.getFullList(10);
        result.readOperations.listCollections = { 
          success: true, 
          count: collections.length,
          collections: collections.map(c => ({
            name: c.name,
            type: c.type,
            hasCreateRule: Boolean(c.createRule),
            hasUpdateRule: Boolean(c.updateRule),
            hasDeleteRule: Boolean(c.deleteRule),
            createRule: c.createRule || 'NO_RULE',
            updateRule: c.updateRule || 'NO_RULE',
            deleteRule: c.deleteRule || 'NO_RULE'
          }))
        };
        console.log(`✅ Listed ${collections.length} collections`);

        // Check if we have any collections that allow writes
        const writableCollections = collections.filter(c => 
          c.createRule !== null || c.updateRule !== null || c.deleteRule !== null
        );
        
        if (writableCollections.length === 0) {
          result.analysis.possibleCauses.push('All collections have restrictive rules (null rules = no access)');
        }

        // Try to find a test collection or create one
        const testCollection = collections.find(c => 
          c.name.toLowerCase().includes('test') || 
          c.name.toLowerCase().includes('demo') ||
          c.name === 'users'
        );

        if (testCollection) {
          console.log(`Found test collection: ${testCollection.name}`);
          
          // Test 3: Try to create a record
          console.log('Testing record creation...');
          try {
            const testData = {
              name: 'Test Record ' + Date.now(),
              test_field: 'debug_test_value'
            };
            
            const record = await pb.collection(testCollection.name).create(testData);
            result.writeOperations.createTest = { 
              success: true, 
              collection: testCollection.name,
              recordId: record.id 
            };
            console.log(`✅ Created test record: ${record.id}`);

            // Test 4: Try to update the record
            console.log('Testing record update...');
            try {
              const updatedRecord = await pb.collection(testCollection.name).update(record.id, {
                name: 'Updated Test Record ' + Date.now()
              });
              result.writeOperations.updateTest = { 
                success: true, 
                collection: testCollection.name,
                recordId: record.id 
              };
              console.log(`✅ Updated test record: ${record.id}`);
            } catch (error: any) {
              result.writeOperations.updateTest = { 
                success: false, 
                error: error.message,
                status: error.status,
                collection: testCollection.name
              };
              console.log(`❌ Update failed: ${error.message}`);
              
              if (error.status === 403) {
                result.analysis.possibleCauses.push('Update operations forbidden by collection rules');
              }
            }

            // Test 5: Try to delete the record
            console.log('Testing record deletion...');
            try {
              await pb.collection(testCollection.name).delete(record.id);
              result.writeOperations.deleteTest = { 
                success: true, 
                collection: testCollection.name,
                recordId: record.id 
              };
              console.log(`✅ Deleted test record: ${record.id}`);
            } catch (error: any) {
              result.writeOperations.deleteTest = { 
                success: false, 
                error: error.message,
                status: error.status,
                collection: testCollection.name
              };
              console.log(`❌ Delete failed: ${error.message}`);
              
              if (error.status === 403) {
                result.analysis.possibleCauses.push('Delete operations forbidden by collection rules');
              }
            }

          } catch (error: any) {
            result.writeOperations.createTest = { 
              success: false, 
              error: error.message,
              status: error.status,
              collection: testCollection.name
            };
            console.log(`❌ Create failed: ${error.message}`);
            
            if (error.status === 403) {
              result.analysis.possibleCauses.push('Create operations forbidden by collection rules');
              result.analysis.isReadOnly = true;
            } else if (error.status === 401) {
              result.analysis.possibleCauses.push('Authentication required for write operations');
            }
          }
        } else {
          result.analysis.possibleCauses.push('No suitable test collection found');
        }

      } catch (error: any) {
        result.readOperations.listCollections = { success: false, error: error.message };
        console.log(`❌ List collections failed: ${error.message}`);
      }

      // Analyze results
      const hasWriteFailures = 
        result.writeOperations.createTest?.success === false ||
        result.writeOperations.updateTest?.success === false ||
        result.writeOperations.deleteTest?.success === false;

      if (hasWriteFailures) {
        result.analysis.isReadOnly = true;
        
        // Add common causes
        if (!this.pbAuthValid) {
          result.analysis.possibleCauses.push('Not authenticated as admin user');
        }
        
        result.analysis.possibleCauses.push('Check collection rules in PocketBase admin UI');
        result.analysis.possibleCauses.push('Verify admin user has proper permissions');
      }

    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }

    console.log('=== Write Permissions Check Complete ===');
    return {
      success: true,
      ...result
    };
  }

  /**
   * Analyze PocketBase operation capabilities and restrictions
   */
  private async analyzePocketBaseCapabilities(): Promise<any> {
    console.log('=== PocketBase Capabilities Analysis ===');
    
    const analysis = {
      timestamp: new Date().toISOString(),
      serverType: 'Remote MCP Server',
      securityLevel: 'Production',
      capabilities: {
        dataOperations: {
          available: [] as string[],
          restricted: [] as string[]
        },
        adminOperations: {
          available: [] as string[],
          restricted: [] as string[]
        },
        authOperations: {
          available: [] as string[],
          restricted: [] as string[]
        }
      },
      tests: {
        basicConnection: null as any,
        dataOperations: null as any,
        adminOperations: null as any
      },
      recommendations: [] as string[]
    };

    try {
      const pb = await this.getPocketBaseInstance();
      if (!pb) {
        return { success: false, error: 'PocketBase instance not available' };
      }

      // Test 1: Basic connection
      console.log('Testing basic connection...');
      try {
        await pb.health.check();
        analysis.tests.basicConnection = { success: true };
        console.log('✅ Basic connection works');
      } catch (error: any) {
        analysis.tests.basicConnection = { success: false, error: error.message };
        return analysis;
      }

      // Test 2: Data operations
      console.log('Testing data operations...');
      const dataTests = {
        listCollections: null as any,
        listRecords: null as any,
        createRecord: null as any,
        readRecord: null as any,
        updateRecord: null as any,
        deleteRecord: null as any
      };

      // List collections (should work)
      try {
        const collections = await pb.collections.getFullList(5);
        dataTests.listCollections = { success: true, count: collections.length };
        analysis.capabilities.dataOperations.available.push('List Collections');
        console.log('✅ List collections works');

        // Find a test collection
        const testCollection = collections.find(c => 
          c.name.toLowerCase().includes('test') || 
          c.name.toLowerCase().includes('demo') ||
          c.name === 'users' ||
          c.type === 'base'
        );

        if (testCollection) {
          console.log(`Testing with collection: ${testCollection.name}`);

          // Test listing records
          try {
            const records = await pb.collection(testCollection.name).getList(1, 5);
            dataTests.listRecords = { success: true, collection: testCollection.name };
            analysis.capabilities.dataOperations.available.push('List Records');
            console.log('✅ List records works');

            // Test creating a record
            try {
              const testData = { name: 'Test ' + Date.now() };
              const record = await pb.collection(testCollection.name).create(testData);
              dataTests.createRecord = { success: true, recordId: record.id };
              analysis.capabilities.dataOperations.available.push('Create Records');
              console.log('✅ Create record works');

              // Test reading the record
              try {
                const readRecord = await pb.collection(testCollection.name).getOne(record.id);
                dataTests.readRecord = { success: true };
                analysis.capabilities.dataOperations.available.push('Read Records');
                console.log('✅ Read record works');
              } catch (error: any) {
                dataTests.readRecord = { success: false, error: error.message };
                analysis.capabilities.dataOperations.restricted.push('Read Records');
              }

              // Test updating the record
              try {
                await pb.collection(testCollection.name).update(record.id, { name: 'Updated ' + Date.now() });
                dataTests.updateRecord = { success: true };
                analysis.capabilities.dataOperations.available.push('Update Records');
                console.log('✅ Update record works');
              } catch (error: any) {
                dataTests.updateRecord = { success: false, error: error.message };
                analysis.capabilities.dataOperations.restricted.push('Update Records');
              }

              // Test deleting the record
              try {
                await pb.collection(testCollection.name).delete(record.id);
                dataTests.deleteRecord = { success: true };
                analysis.capabilities.dataOperations.available.push('Delete Records');
                console.log('✅ Delete record works');
              } catch (error: any) {
                dataTests.deleteRecord = { success: false, error: error.message };
                analysis.capabilities.dataOperations.restricted.push('Delete Records');
              }

            } catch (error: any) {
              dataTests.createRecord = { success: false, error: error.message };
              analysis.capabilities.dataOperations.restricted.push('Create Records');
            }

          } catch (error: any) {
            dataTests.listRecords = { success: false, error: error.message };
            analysis.capabilities.dataOperations.restricted.push('List Records');
          }
        }

      } catch (error: any) {
        dataTests.listCollections = { success: false, error: error.message };
        analysis.capabilities.dataOperations.restricted.push('List Collections');
      }

      analysis.tests.dataOperations = dataTests;

      // Test 3: Admin operations
      console.log('Testing admin operations...');
      const adminTests = {
        authenticate: null as any,
        createCollection: null as any,
        updateCollection: null as any,
        deleteCollection: null as any
      };

      // Test authentication
      if (this.env.POCKETBASE_ADMIN_EMAIL && this.env.POCKETBASE_ADMIN_PASSWORD) {
        try {
          const freshPb = new PocketBase(this.env.POCKETBASE_URL!);
          await freshPb.collection('_superusers').authWithPassword(
            this.env.POCKETBASE_ADMIN_EMAIL,
            this.env.POCKETBASE_ADMIN_PASSWORD
          );
          adminTests.authenticate = { success: true };
          analysis.capabilities.authOperations.available.push('Admin Authentication');
          console.log('✅ Admin authentication works');
        } catch (error: any) {
          adminTests.authenticate = { success: false, error: error.message };
          analysis.capabilities.authOperations.restricted.push('Admin Authentication');
          console.log('❌ Admin authentication restricted');
        }
      } else {
        adminTests.authenticate = { success: false, error: 'No admin credentials provided' };
        analysis.capabilities.authOperations.restricted.push('Admin Authentication (No Credentials)');
      }

      // Test collection management (these will likely fail in a restricted environment)
      try {
        const testCollectionSchema = {
          name: 'mcp_test_' + Date.now(),
          type: 'base',
          schema: [
            {
              name: 'title',
              type: 'text',
              required: true
            }
          ]
        };
        
        await pb.collections.create(testCollectionSchema);
        adminTests.createCollection = { success: true };
        analysis.capabilities.adminOperations.available.push('Create Collections');
        console.log('✅ Create collection works');
      } catch (error: any) {
        adminTests.createCollection = { success: false, error: error.message };
        analysis.capabilities.adminOperations.restricted.push('Create Collections');
        console.log('❌ Create collection restricted');
      }

      analysis.tests.adminOperations = adminTests;

      // Generate recommendations based on findings
      if (analysis.capabilities.dataOperations.available.length > 0) {
        analysis.recommendations.push('✅ Data operations are available - you can work with records in existing collections');
      }

      if (analysis.capabilities.adminOperations.restricted.length > 0) {
        analysis.recommendations.push('⚠️ Admin operations are restricted - this is a security feature in production environments');
        analysis.recommendations.push('💡 Use the PocketBase admin UI for schema changes and administrative tasks');
        analysis.recommendations.push('🔧 Focus on data operations: create, read, update, delete records');
      }

      if (analysis.capabilities.authOperations.restricted.length > 0) {
        analysis.recommendations.push('🔐 Authentication operations are restricted - use pre-configured authentication in your app');
      }

      // Determine overall security profile
      const restrictedCount = 
        analysis.capabilities.adminOperations.restricted.length + 
        analysis.capabilities.authOperations.restricted.length;
      
      if (restrictedCount > 3) {
        analysis.securityLevel = 'High Security (Production)';
        analysis.recommendations.push('🛡️ This server is configured for production use with restricted admin access');
      } else if (restrictedCount > 0) {
        analysis.securityLevel = 'Medium Security (Staging)';
      } else {
        analysis.securityLevel = 'Low Security (Development)';
      }

    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }

    console.log('=== Capabilities Analysis Complete ===');
    return {
      success: true,
      ...analysis
    };
  }

  /**
   * Authenticate as super admin with provided credentials
   * This enables admin-level operations in the current session
   */
  private async pocketBaseSuperAdminAuth(email?: string, password?: string): Promise<any> {
    console.log('=== PocketBase Super Admin Authentication ===');
    
    const response = {
      timestamp: new Date().toISOString(),
      success: false,
      operation: 'super_admin_auth',
      message: '',
      details: {
        credentialsSource: 'none',
        authenticationAttempted: false,
        sessionUpdated: false,
        previousAuth: {
          wasAuthenticated: this.pbAuthValid,
          lastAuthTime: this.pbLastAuth ? new Date(this.pbLastAuth).toISOString() : null,
          authAge: this.pbLastAuth ? Date.now() - this.pbLastAuth : null
        }
      },
      capabilities: {
        beforeAuth: [] as string[],
        afterAuth: [] as string[]
      },
      hint: ''
    };

    // Determine credentials to use
    const adminEmail = email || this.env.POCKETBASE_ADMIN_EMAIL;
    const adminPassword = password || this.env.POCKETBASE_ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      response.message = 'Admin credentials not available';
      response.hint = 'Provide email and password parameters, or set POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD environment variables';
      response.details.credentialsSource = 'missing';
      return response;
    }

    if (email && password) {
      response.details.credentialsSource = 'provided_parameters';
    } else {
      response.details.credentialsSource = 'environment_variables';
    }

    if (!this.env.POCKETBASE_URL) {
      response.message = 'PocketBase URL not configured';
      response.hint = 'Set POCKETBASE_URL environment variable';
      return response;
    }

    try {
      // Test capabilities before authentication
      console.log('Testing capabilities before authentication...');
      try {
        const pb = new PocketBase(this.env.POCKETBASE_URL);
        const collections = await pb.collections.getFullList(3);
        response.capabilities.beforeAuth.push(`List Collections (${collections.length} found)`);
      } catch (error: any) {
        response.capabilities.beforeAuth.push(`List Collections: FAILED (${error.message})`);
      }

      // Attempt super admin authentication
      console.log('Attempting super admin authentication...');
      response.details.authenticationAttempted = true;
      
      const pb = new PocketBase(this.env.POCKETBASE_URL);
      
      try {
        // Authenticate as super admin using the _superusers collection
        const authData = await pb.collection('_superusers').authWithPassword(adminEmail, adminPassword);
        
        console.log('✅ Super admin authentication successful');
        response.success = true;
        response.message = 'Successfully authenticated as super admin';
        
        // Update our internal PocketBase instance with the authenticated session
        this.pb = pb;
        this.pbInitialized = true;
        this.pbAuthValid = true;
        this.pbLastAuth = Date.now();
        response.details.sessionUpdated = true;
        
        console.log('✅ Internal session updated with admin authentication');
        
        // Test enhanced capabilities after authentication
        console.log('Testing enhanced capabilities after authentication...');
        
        try {
          const collections = await pb.collections.getFullList();
          response.capabilities.afterAuth.push(`List Collections (${collections.length} found)`);
        } catch (error: any) {
          response.capabilities.afterAuth.push(`List Collections: FAILED (${error.message})`);
        }

        try {
          // Try to create a test collection to verify admin privileges
          const testCollectionName = 'mcp_admin_test_' + Date.now();
          await pb.collections.create({
            name: testCollectionName,
            type: 'base',
            schema: [
              {
                name: 'test_field',
                type: 'text',
                required: false
              }
            ]
          });
          
          response.capabilities.afterAuth.push('Create Collections: SUCCESS');
          console.log('✅ Collection creation test passed');
          
          // Clean up test collection
          try {
            await pb.collections.delete(testCollectionName);
            response.capabilities.afterAuth.push('Delete Collections: SUCCESS');
            console.log('✅ Collection deletion test passed');
          } catch (error: any) {
            response.capabilities.afterAuth.push(`Delete Collections: PARTIAL (${error.message})`);
          }
          
        } catch (error: any) {
          response.capabilities.afterAuth.push(`Create Collections: FAILED (${error.message})`);
          console.log(`❌ Collection creation test failed: ${error.message}`);
        }

        // Test user management
        try {
          const users = await pb.collection('_superusers').getFullList(5);
          response.capabilities.afterAuth.push(`Manage Admin Users (${users.length} found)`);
        } catch (error: any) {
          response.capabilities.afterAuth.push(`Manage Admin Users: FAILED (${error.message})`);
        }

        response.hint = 'Admin authentication successful! You can now perform admin-level operations like creating collections, managing schemas, and user administration.';
        
      } catch (authError: any) {
        console.error('❌ Super admin authentication failed:', authError);
        response.success = false;
        response.message = 'Super admin authentication failed';
        response.hint = authError.status === 400 ? 'Invalid admin credentials' :
                       authError.status === 404 ? 'Admin user not found or _superusers collection not accessible' :
                       authError.status === 403 ? 'Admin authentication is disabled or restricted' :
                       `Authentication error: ${authError.message}`;
        
        // Additional specific error handling
        if (authError.message?.includes('fetch')) {
          response.hint += ' (Network connectivity issue)';
        } else if (authError.status === 403) {
          response.hint += ' (This may be a security restriction in production environments)';
        }
      }
      
    } catch (error: any) {
      console.error('❌ Super admin authentication process failed:', error);
      response.success = false;
      response.message = `Authentication process failed: ${error.message}`;
      response.hint = 'Check PocketBase URL and network connectivity';
    }

    console.log('=== Super Admin Authentication Complete ===');
    return response;
  }
}

// Export the Durable Object class for Cloudflare Workers
export default PocketBaseMCPDurableObject;
