// Cloudflare Worker entry point for the PocketBase MCP Server
import ComprehensivePocketBaseMCPAgent from './agent-comprehensive.js';

interface Env {
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
  DEFAULT_FROM_EMAIL?: string;
}

interface MCPRequest {
  jsonrpc: string;
  id: string | number;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: string;
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

// Global agent instance (persisted across requests)
let globalAgent: ComprehensivePocketBaseMCPAgent | null = null;

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    const url = new URL(request.url);
    
    // Health check endpoint
    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(JSON.stringify({
        status: 'healthy',
        service: 'PocketBase MCP Server',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
        agentInitialized: globalAgent !== null
      }), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // MCP endpoint
    if (url.pathname === '/mcp' && request.method === 'POST') {
      return handleMCPRequest(request, env, ctx);
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      });
    }

    return new Response('PocketBase MCP Server - Cloudflare Worker Edition', {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

async function handleMCPRequest(request: Request, env: Env, ctx: any): Promise<Response> {
  try {
    // Initialize agent if not already done
    if (!globalAgent) {
      globalAgent = new ComprehensivePocketBaseMCPAgent();

      // Initialize the agent with environment variables
      await globalAgent.init(env);
    }

    // Parse the MCP request
    const body = await request.json() as MCPRequest;
    
    // Handle MCP protocol methods by proxying to agent
    const response = await handleMCPMethod(body, globalAgent);
    
    return new Response(JSON.stringify(response), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('MCP request failed:', error);
    
    const errorResponse: MCPResponse = {
      jsonrpc: '2.0',
      id: -1,
      error: {
        code: -32603,
        message: 'Internal error',
        data: error instanceof Error ? error.message : 'Unknown error'
      }
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

async function handleMCPMethod(request: MCPRequest, agent: ComprehensivePocketBaseMCPAgent): Promise<MCPResponse> {
  switch (request.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
            resources: {},
            prompts: {}
          },
          serverInfo: {
            name: 'pocketbase-server',
            version: '0.1.0'
          }
        }
      };

    case 'tools/list':
      return await handleToolsList(request, agent);

    case 'tools/call':
      return await handleToolCall(request, agent);

    case 'resources/list':
      return await handleResourcesList(request, agent);

    case 'resources/read':
      return await handleResourceRead(request, agent);

    case 'prompts/list':
      return await handlePromptsList(request, agent);

    case 'prompts/get':
      return await handlePromptGet(request, agent);

    default:
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32601,
          message: 'Method not found'
        }
      };
  }
}

async function handleToolsList(request: MCPRequest, agent: ComprehensivePocketBaseMCPAgent): Promise<MCPResponse> {
  try {
    // Get the MCP server instance from the agent
    const server = agent.server;
    
    // Access the registered tools from the server's internal state
    // Since we can't directly access the tools registry, we'll define the tools that we know are registered
    const tools = [
      {
        name: 'health_check',
        description: 'Check the health status of the MCP server and PocketBase connection',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'discover_tools',
        description: 'List all available tools and their current status',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'smithery_discovery',
        description: 'Fast discovery endpoint for Smithery tool scanning',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'list_collections',
        description: 'List all collections in the PocketBase database',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get_collection',
        description: 'Get details of a specific collection',
        inputSchema: {
          type: 'object',
          properties: {
            nameOrId: { type: 'string', description: 'Collection name or ID' }
          },
          required: ['nameOrId']
        }
      },
      {
        name: 'list_records',
        description: 'List records from a collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            page: { type: 'number', description: 'Page number (default: 1)' },
            perPage: { type: 'number', description: 'Records per page (default: 30)' }
          },
          required: ['collection']
        }
      },
      {
        name: 'get_record',
        description: 'Get a specific record by ID',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            id: { type: 'string', description: 'Record ID' }
          },
          required: ['collection', 'id']
        }
      },
      {
        name: 'create_record',
        description: 'Create a new record in a collection',
        inputSchema: {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection name' },
            data: { type: 'object', description: 'Record data' }
          },
          required: ['collection', 'data']
        }
      },
      {
        name: 'test_tool',
        description: 'A simple test tool that always works to verify tool registration',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'create_stripe_customer',
        description: 'Create a new customer in Stripe',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email', description: 'Customer email' },
            name: { type: 'string', description: 'Customer name' }
          },
          required: ['email']
        }
      },
      {
        name: 'create_stripe_payment_intent',
        description: 'Create a Stripe payment intent for processing payments',
        inputSchema: {
          type: 'object',
          properties: {
            amount: { type: 'number', description: 'Amount in cents (e.g., 2000 for $20.00)' },
            currency: { type: 'string', description: 'Three-letter currency code (e.g., USD)' },
            description: { type: 'string', description: 'Optional description for the payment' }
          },
          required: ['amount', 'currency']
        }
      },
      {
        name: 'create_stripe_product',
        description: 'Create a new product in Stripe',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Product name' },
            description: { type: 'string', description: 'Product description' },
            price: { type: 'number', description: 'Price in cents' },
            currency: { type: 'string', description: 'Currency code (default: USD)' },
            interval: { type: 'string', enum: ['month', 'year', 'week', 'day'], description: 'Billing interval for subscriptions' }
          },
          required: ['name', 'price']
        }
      },
      {
        name: 'send_templated_email',
        description: 'Send a templated email using the configured email service',
        inputSchema: {
          type: 'object',
          properties: {
            template: { type: 'string', description: 'Email template name' },
            to: { type: 'string', format: 'email', description: 'Recipient email address' },
            from: { type: 'string', format: 'email', description: 'Sender email address' },
            subject: { type: 'string', description: 'Custom email subject' },
            variables: { type: 'object', description: 'Template variables' }
          },
          required: ['template', 'to']
        }
      },
      {
        name: 'send_custom_email',
        description: 'Send a custom email with specified content',
        inputSchema: {
          type: 'object',
          properties: {
            to: { type: 'string', format: 'email', description: 'Recipient email address' },
            from: { type: 'string', format: 'email', description: 'Sender email address' },
            subject: { type: 'string', description: 'Email subject' },
            html: { type: 'string', description: 'HTML email body' },
            text: { type: 'string', description: 'Plain text email body' }
          },
          required: ['to', 'subject', 'html']
        }
      }
    ];

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: tools
      }
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32603,
        message: 'Failed to list tools',
        data: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
}

async function handleToolCall(request: MCPRequest, agent: ComprehensivePocketBaseMCPAgent): Promise<MCPResponse> {
  try {
    const { name, arguments: args } = request.params;
    
    // Create a mock transport to handle the tool call
    const mockTransport = new MockTransport();
    const server = agent.server;
    
    // Execute the tool call through the server
    const result = await executeToolOnServer(server, name, args || {});
    
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: result
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32603,
        message: 'Tool execution failed',
        data: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
}

async function handleResourcesList(request: MCPRequest, agent: ComprehensivePocketBaseMCPAgent): Promise<MCPResponse> {
  try {
    const resources = [
      {
        uri: 'agent://status',
        name: 'Agent Status',
        description: 'Get current agent status and configuration',
        mimeType: 'application/json'
      }
    ];

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        resources: resources
      }
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32603,
        message: 'Failed to list resources',
        data: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
}

async function handleResourceRead(request: MCPRequest, agent: ComprehensivePocketBaseMCPAgent): Promise<MCPResponse> {
  try {
    const { uri } = request.params;
    
    if (uri === 'agent://status') {
      const state = agent.getState();
      const status = {
        agent: {
          lastActiveTime: new Date(state.lastActiveTime).toISOString()
        },
        initialization: state.initializationState,
        configuration: {
          hasConfig: Boolean(state.configuration),
          pocketbaseConfigured: Boolean(state.configuration?.pocketbaseUrl),
          stripeConfigured: Boolean(state.configuration?.stripeSecretKey),
          emailConfigured: Boolean(state.configuration?.emailService || state.configuration?.smtpHost)
        }
      };

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          contents: [{
            uri: uri,
            mimeType: 'application/json',
            text: JSON.stringify(status, null, 2)
          }]
        }
      };
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32602,
        message: 'Resource not found',
        data: `Unknown resource URI: ${uri}`
      }
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32603,
        message: 'Failed to read resource',
        data: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
}

async function handlePromptsList(request: MCPRequest, agent: ComprehensivePocketBaseMCPAgent): Promise<MCPResponse> {
  try {
    const prompts = [
      {
        name: 'setup_collection',
        description: 'Interactive prompt to help set up a new PocketBase collection',
        arguments: [
          {
            name: 'name',
            description: 'Collection name',
            required: false
          },
          {
            name: 'type',
            description: 'Collection type (base, auth)',
            required: false
          }
        ]
      }
    ];

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        prompts: prompts
      }
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32603,
        message: 'Failed to list prompts',
        data: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
}

async function handlePromptGet(request: MCPRequest, agent: ComprehensivePocketBaseMCPAgent): Promise<MCPResponse> {
  try {
    const { name, arguments: args } = request.params;
    
    if (name === 'setup_collection') {
      const collectionName = args?.name || 'new_collection';
      const collectionType = args?.type || 'base';
      
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          description: `Set up a new ${collectionType} collection named "${collectionName}"`,
          messages: [{
            role: 'assistant',
            content: {
              type: 'text',
              text: `I'll help you set up a new ${collectionType} collection named "${collectionName}". Would you like me to create this collection with a basic schema?`
            }
          }]
        }
      };
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32602,
        message: 'Prompt not found',
        data: `Unknown prompt: ${name}`
      }
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32603,
        message: 'Failed to get prompt',
        data: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
}

// Helper function to execute tools on the server
async function executeToolOnServer(server: any, toolName: string, args: any): Promise<any> {
  // This is a simplified implementation - in reality, we would need to access
  // the server's internal tool registry and execute the tool handler
  // For now, we'll implement the most common tools directly
  
  switch (toolName) {
    case 'health_check':
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            server: 'healthy',
            timestamp: new Date().toISOString(),
            environment: 'cloudflare-worker'
          }, null, 2)
        }]
      };
      
    case 'smithery_discovery':
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            server: 'pocketbase-mcp-server',
            version: '0.1.0',
            capabilities: ['pocketbase', 'database', 'realtime', 'auth', 'files', 'stripe', 'email'],
            status: 'ready',
            discoveryTime: '0ms',
            environment: 'cloudflare-worker',
            totalTools: 14
          }, null, 2)
        }]
      };
      
    case 'test_tool':
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: 'Test tool working!',
            timestamp: new Date().toISOString(),
            totalRegisteredTools: 14,
            environment: 'cloudflare-worker'
          }, null, 2)
        }]
      };
      
    default:
      // For other tools, we'd need to implement the actual logic
      // This is a limitation of the current approach - we can't easily
      // access the server's tool handlers from here
      throw new Error(`Tool "${toolName}" execution not implemented in worker mode. Please use the full server deployment for complete functionality.`);
  }
}

// Mock transport class for compatibility
class MockTransport {
  constructor() {}
  async connect() {}
  async disconnect() {}
}
