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
     * Process MCP messages (simplified implementation)
     */
    async processMCPMessage(message) {
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
    async handleHealth() {
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
     * Handle Server-Sent Events (SSE) for MCP connections
     */
    async handleSSE(request) {
        // Initialize agent if needed
        const agent = await this.initializeAgent();
        // Update activity
        this.lastActivity = Date.now();
        // For Cloudflare Workers, we need to create a streaming response
        // This is a basic implementation - in production you'd want more sophisticated handling
        const headers = new Headers({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        });
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers });
        }
        if (request.method !== 'GET' && request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
        }
        // Create a simple SSE stream that sends initial connection data
        const stream = new ReadableStream({
            start(controller) {
                // Send initial connection event
                const initData = {
                    type: 'connection',
                    data: {
                        server: 'PocketBase MCP Server',
                        version: '1.0.0',
                        timestamp: new Date().toISOString(),
                        capabilities: ['pocketbase', 'stripe', 'email', 'database']
                    }
                };
                const message = `data: ${JSON.stringify(initData)}\n\n`;
                controller.enqueue(new TextEncoder().encode(message));
                // Send periodic heartbeat
                const heartbeatInterval = setInterval(() => {
                    try {
                        const heartbeat = `data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`;
                        controller.enqueue(new TextEncoder().encode(heartbeat));
                    }
                    catch (error) {
                        console.error('SSE heartbeat error:', error);
                        clearInterval(heartbeatInterval);
                        controller.close();
                    }
                }, 30000); // Every 30 seconds
                // Clean up on close
                const cleanup = () => {
                    clearInterval(heartbeatInterval);
                };
                // Note: In a real implementation, you'd handle client disconnection
                // and proper cleanup. This is a simplified version.
                setTimeout(() => {
                    cleanup();
                    controller.close();
                }, 300000); // Close after 5 minutes for demo
            }
        });
        return new Response(stream, { headers });
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
            await this.agent.cleanup();
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
}
// Export the Durable Object class for Cloudflare Workers
export default PocketBaseMCPDurableObject;
