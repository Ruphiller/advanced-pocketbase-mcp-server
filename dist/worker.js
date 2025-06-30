// Cloudflare Worker entry point for the PocketBase MCP Server
import { PocketBaseMCPAgent } from './agent-simple.js';
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        // Health check endpoint
        if (url.pathname === '/health' || url.pathname === '/') {
            return new Response(JSON.stringify({
                status: 'healthy',
                service: 'PocketBase MCP Server',
                version: '0.1.0',
                timestamp: new Date().toISOString()
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
async function handleMCPRequest(request, env, ctx) {
    try {
        // Create agent with environment-based configuration
        const agent = new PocketBaseMCPAgent({
            configuration: {
                pocketbaseUrl: env.POCKETBASE_URL,
                adminEmail: env.POCKETBASE_ADMIN_EMAIL,
                adminPassword: env.POCKETBASE_ADMIN_PASSWORD,
                stripeSecretKey: env.STRIPE_SECRET_KEY,
                emailService: env.EMAIL_SERVICE,
                smtpHost: env.SMTP_HOST
            }
        });
        // Initialize the agent
        await agent.init();
        // Parse the MCP request
        const body = await request.json();
        // Handle common MCP methods
        switch (body.method) {
            case 'initialize':
                return new Response(JSON.stringify({
                    jsonrpc: '2.0',
                    id: body.id,
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
                }), {
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            case 'tools/list':
                // Return basic tool list for fast discovery
                return new Response(JSON.stringify({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: {
                        tools: [
                            {
                                name: 'health_check',
                                description: 'Check server health',
                                inputSchema: { type: 'object', properties: {} }
                            },
                            {
                                name: 'discover_tools',
                                description: 'Discover available tools',
                                inputSchema: { type: 'object', properties: {} }
                            },
                            {
                                name: 'smithery_discovery',
                                description: 'Fast discovery for Smithery scanning',
                                inputSchema: { type: 'object', properties: {} }
                            }
                        ]
                    }
                }), {
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            case 'tools/call':
                // Handle tool calls - this is a simplified implementation
                if (body.params?.name === 'health_check') {
                    return new Response(JSON.stringify({
                        jsonrpc: '2.0',
                        id: body.id,
                        result: {
                            content: [{
                                    type: 'text',
                                    text: JSON.stringify({
                                        server: 'healthy',
                                        timestamp: new Date().toISOString(),
                                        environment: 'cloudflare-worker'
                                    }, null, 2)
                                }]
                        }
                    }), {
                        headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        }
                    });
                }
                if (body.params?.name === 'smithery_discovery') {
                    return new Response(JSON.stringify({
                        jsonrpc: '2.0',
                        id: body.id,
                        result: {
                            content: [{
                                    type: 'text',
                                    text: JSON.stringify({
                                        server: 'pocketbase-mcp-server',
                                        version: '0.1.0',
                                        capabilities: ['pocketbase', 'database', 'realtime', 'auth', 'files'],
                                        status: 'ready',
                                        discoveryTime: '0ms',
                                        environment: 'cloudflare-worker'
                                    }, null, 2)
                                }]
                        }
                    }), {
                        headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        }
                    });
                }
                // For other tools, you would need to implement proper MCP transport
                return new Response(JSON.stringify({
                    jsonrpc: '2.0',
                    id: body.id,
                    error: {
                        code: -32601,
                        message: 'Method not implemented in worker mode'
                    }
                }), {
                    status: 200, // MCP errors should still return 200
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            default:
                return new Response(JSON.stringify({
                    jsonrpc: '2.0',
                    id: body.id,
                    error: {
                        code: -32601,
                        message: 'Method not found'
                    }
                }), {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
        }
    }
    catch (error) {
        console.error('MCP request failed:', error);
        return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: {
                code: -32603,
                message: 'Internal error',
                data: error instanceof Error ? error.message : 'Unknown error'
            }
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
