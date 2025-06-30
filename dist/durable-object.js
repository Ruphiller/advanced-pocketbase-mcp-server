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
import { ComprehensivePocketBaseMCPAgent } from './agent-comprehensive.js';
import PocketBase from 'pocketbase';
export class PocketBaseMCPDurableObject {
    agent = null;
    state;
    env;
    sessions = new Map(); // WebSocket sessions
    lastActivity = Date.now();
    constructor(state, env) {
        this.state = state;
        this.env = env;
        // Set up alarm for hibernation
        this.scheduleHibernationCheck();
    }
    /**
     * Initialize the MCP agent with persistent state
     */
    async initializeAgent() {
        if (this.agent) {
            return this.agent;
        }
        // Restore agent state from Durable Object storage
        const storedState = await this.state.storage.get('agentState');
        // Create agent with restored state
        this.agent = new ComprehensivePocketBaseMCPAgent();
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
    async persistAgentState() {
        if (this.agent) {
            const agentState = this.agent.getState();
            await this.state.storage.put('agentState', agentState);
            await this.state.storage.put('lastActivity', this.lastActivity);
        }
    }
    /**
     * Handle HTTP requests to the Durable Object
     */
    async fetch(request) {
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
        }
        catch (error) {
            console.error('Durable Object error:', error);
            return new Response(`Internal Server Error: ${error.message}`, { status: 500 });
        }
    }
    /**
     * Handle WebSocket connections for real-time MCP communication
     */
    async handleWebSocket(request) {
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
    async processMCPMessage(message) {
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
                    // List available tools
                    console.log('Listing tools');
                    return {
                        jsonrpc: '2.0',
                        id: message.id,
                        result: {
                            tools: [
                                {
                                    name: 'pocketbase_list_collections',
                                    description: 'List all available PocketBase collections',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {}
                                    }
                                },
                                {
                                    name: 'pocketbase_create_record',
                                    description: 'Create a new record in a PocketBase collection',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            collection: {
                                                type: 'string',
                                                description: 'The collection name'
                                            },
                                            data: {
                                                type: 'object',
                                                description: 'The record data'
                                            }
                                        },
                                        required: ['collection', 'data']
                                    }
                                },
                                {
                                    name: 'pocketbase_get_record',
                                    description: 'Get a specific record by ID',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            collection: {
                                                type: 'string',
                                                description: 'The collection name'
                                            },
                                            id: {
                                                type: 'string',
                                                description: 'The record ID'
                                            }
                                        },
                                        required: ['collection', 'id']
                                    }
                                },
                                {
                                    name: 'pocketbase_list_records',
                                    description: 'List records from a collection with optional filtering',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            collection: {
                                                type: 'string',
                                                description: 'The collection name'
                                            },
                                            filter: {
                                                type: 'string',
                                                description: 'Optional filter query'
                                            },
                                            sort: {
                                                type: 'string',
                                                description: 'Optional sort criteria'
                                            },
                                            page: {
                                                type: 'number',
                                                description: 'Page number'
                                            },
                                            perPage: {
                                                type: 'number',
                                                description: 'Records per page'
                                            }
                                        },
                                        required: ['collection']
                                    }
                                },
                                {
                                    name: 'pocketbase_update_record',
                                    description: 'Update an existing record',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            collection: {
                                                type: 'string',
                                                description: 'The collection name'
                                            },
                                            id: {
                                                type: 'string',
                                                description: 'The record ID'
                                            },
                                            data: {
                                                type: 'object',
                                                description: 'The updated data'
                                            }
                                        },
                                        required: ['collection', 'id', 'data']
                                    }
                                },
                                {
                                    name: 'pocketbase_delete_record',
                                    description: 'Delete a record by ID',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            collection: {
                                                type: 'string',
                                                description: 'The collection name'
                                            },
                                            id: {
                                                type: 'string',
                                                description: 'The record ID'
                                            }
                                        },
                                        required: ['collection', 'id']
                                    }
                                },
                                {
                                    name: 'pocketbase_get_status',
                                    description: 'Get server status and configuration',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {}
                                    }
                                }
                            ]
                        }
                    };
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
                    }
                    catch (error) {
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
        }
        catch (error) {
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
    async executeTool(toolName, args) {
        const agent = await this.initializeAgent();
        switch (toolName) {
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
            case 'pocketbase_get_status':
                return await this.toolGetStatus();
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }
    /**
     * Tool implementations
     */
    async toolListCollections() {
        const pb = await this.getPocketBaseInstance();
        if (!pb) {
            return { success: false, error: 'PocketBase not initialized' };
        }
        try {
            const collections = await pb.collections.getFullList(200);
            return {
                success: true,
                collections: collections.map((col) => ({
                    id: col.id,
                    name: col.name,
                    type: col.type,
                    schema: col.schema
                }))
            };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
    async toolCreateRecord(collection, data) {
        const pb = await this.getPocketBaseInstance();
        if (!pb) {
            return { success: false, error: 'PocketBase not initialized' };
        }
        try {
            const record = await pb.collection(collection).create(data);
            return { success: true, record };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
    async toolGetRecord(collection, id) {
        const pb = await this.getPocketBaseInstance();
        if (!pb) {
            return { success: false, error: 'PocketBase not initialized' };
        }
        try {
            const record = await pb.collection(collection).getOne(id);
            return { success: true, record };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
    async toolListRecords(collection, filter, sort, page, perPage) {
        const pb = await this.getPocketBaseInstance();
        if (!pb) {
            return { success: false, error: 'PocketBase not initialized' };
        }
        try {
            const options = {};
            if (filter)
                options.filter = filter;
            if (sort)
                options.sort = sort;
            const records = await pb.collection(collection).getList(page || 1, perPage || 30, options);
            return {
                success: true,
                page: records.page,
                perPage: records.perPage,
                totalItems: records.totalItems,
                totalPages: records.totalPages,
                items: records.items
            };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
    async toolUpdateRecord(collection, id, data) {
        const pb = await this.getPocketBaseInstance();
        if (!pb) {
            return { success: false, error: 'PocketBase not initialized' };
        }
        try {
            const record = await pb.collection(collection).update(id, data);
            return { success: true, record };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
    async toolDeleteRecord(collection, id) {
        const pb = await this.getPocketBaseInstance();
        if (!pb) {
            return { success: false, error: 'PocketBase not initialized' };
        }
        try {
            await pb.collection(collection).delete(id);
            return { success: true, message: `Record ${id} deleted from ${collection}` };
        }
        catch (error) {
            return { success: false, error: error.message };
        }
    }
    async toolGetStatus() {
        const agent = await this.initializeAgent();
        return {
            success: true,
            status: {
                durableObject: {
                    id: this.state.id.toString(),
                    lastActivity: new Date(this.lastActivity).toISOString(),
                    activeSessions: this.sessions.size
                },
                agent: agent.getState(),
                capabilities: {
                    pocketbaseUrl: Boolean(this.env.POCKETBASE_URL),
                    hasAdminAuth: Boolean(this.env.POCKETBASE_ADMIN_EMAIL),
                    hasStripe: Boolean(this.env.STRIPE_SECRET_KEY),
                    hasEmail: Boolean(this.env.EMAIL_SERVICE || this.env.SMTP_HOST)
                },
                timestamp: new Date().toISOString()
            }
        };
    }
    /**
     * Handle health check requests
     */
    async handleHealth() {
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
    async handleMCPRequest(request) {
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
    async handleSSE(request) {
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
            }
            catch (error) {
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
        }
        else if (request.method === 'GET') {
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
                        }
                        catch (error) {
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
        }
        else {
            return new Response('Method not allowed', { status: 405 });
        }
    }
    /**
     * Handle status requests
     */
    async handleStatus() {
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
    async handleHibernate() {
        await this.hibernate();
        return new Response(JSON.stringify({ message: 'Hibernated successfully' }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }
    /**
     * Handle wake up from hibernation
     */
    async handleWake() {
        if (this.agent) {
            // Agent is now awake - no specific wakeUp method needed
        }
        this.lastActivity = Date.now();
        return new Response(JSON.stringify({ message: 'Woke up successfully' }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }
    /**
     * Hibernate the Durable Object
     */
    async hibernate() {
        // Close all WebSocket connections
        for (const [sessionId, ws] of this.sessions) {
            ws.close(1001, 'Hibernating');
        }
        this.sessions.clear();
        // Persist final state
        await this.persistAgentState();
        // Clean up agent resources
        if (this.agent) {
            // Cleanup resources - no specific cleanup method needed
            this.agent = null;
        }
        console.log('Durable Object hibernated');
    }
    /**
     * Schedule hibernation check
     */
    async scheduleHibernationCheck() {
        // Check every 5 minutes
        const fiveMinutes = 5 * 60 * 1000;
        await this.state.storage.setAlarm(Date.now() + fiveMinutes);
    }
    /**
     * Handle scheduled alarms (for hibernation)
     */
    async alarm() {
        const now = Date.now();
        const inactiveTime = now - this.lastActivity;
        const hibernationThreshold = 30 * 60 * 1000; // 30 minutes
        if (inactiveTime > hibernationThreshold && this.sessions.size === 0) {
            console.log('Auto-hibernating due to inactivity');
            await this.hibernate();
        }
        else {
            // Schedule next check
            await this.scheduleHibernationCheck();
        }
    }
    /**
     * Handle WebSocket close events
     */
    async webSocketClose(ws, code, reason, wasClean) {
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
    async webSocketError(ws, error) {
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
     * Get or create PocketBase instance
     */
    async getPocketBaseInstance() {
        if (!this.env.POCKETBASE_URL) {
            return null;
        }
        const pb = new PocketBase(this.env.POCKETBASE_URL);
        // Authenticate if credentials are available
        if (this.env.POCKETBASE_ADMIN_EMAIL && this.env.POCKETBASE_ADMIN_PASSWORD) {
            try {
                await pb.collection('_superusers').authWithPassword(this.env.POCKETBASE_ADMIN_EMAIL, this.env.POCKETBASE_ADMIN_PASSWORD);
            }
            catch (error) {
                console.warn('PocketBase authentication failed:', error);
                // Continue without authentication
            }
        }
        return pb;
    }
}
// Export the Durable Object class for Cloudflare Workers
export default PocketBaseMCPDurableObject;
