/**
 * Cloudflare Durable Object implementation for PocketBase MCP Server
 *
 * This provides true stateful MCP server functionality with:
 * - Persistent state across requests
 * - Automatic hibernation when idle
 * - WebSocket support for real-time connections
 * - Proper lifecycle management
 */
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
export interface AgentState {
    sessionId?: string;
    configuration?: any;
    initializationState?: any;
    customHeaders?: Record<string, string>;
    lastActiveTime: number;
}
export declare class PocketBaseMCPDurableObject {
    private agent;
    private pb;
    private pbInitialized;
    private pbLastAuth;
    private pbAuthValid;
    private state;
    private env;
    private sessions;
    private lastActivity;
    private initialized;
    constructor(state: DurableObjectState, env: Env);
    /**
     * Initialize the MCP agent with persistent state
     */
    private initializeAgent;
    /**
     * Persist agent state to Durable Object storage
     */
    private persistAgentState;
    /**
     * Handle HTTP requests to the Durable Object
     */
    fetch(request: Request): Promise<Response>;
    /**
     * Handle WebSocket connections for real-time MCP communication
     */
    private handleWebSocket;
    /**
     * Process MCP messages using proper MCP protocol
     */
    private processMCPMessage;
    /**
     * Execute a specific tool with given arguments
     */
    private executeTool;
    /**
     * Create a response for tools that require specific service configuration
     */
    private createToolResponse;
    /**
     * Tool implementations with enhanced error handling and retry logic
     */
    private toolListCollections;
    private toolCreateRecord;
    private toolGetRecord;
    private toolListRecords;
    private toolUpdateRecord;
    private toolDeleteRecord;
    private toolGetStatus;
    /**
     * Handle health check requests
     */
    private handleHealth;
    /**
     * Handle direct MCP HTTP requests
     */
    private handleMCPRequest;
    /**
     * Handle MCP over HTTP requests (SSE endpoint)
     */
    private handleSSE;
    /**
     * Handle status requests
     */
    private handleStatus;
    /**
     * Handle manual hibernation
     */
    private handleHibernate;
    /**
     * Handle wake up from hibernation
     */
    private handleWake;
    /**
     * Clean up agent resources
     */
    private hibernate;
    /**
     * Schedule hibernation check
     */
    private scheduleHibernationCheck;
    /**
     * Handle scheduled alarms (for hibernation)
     */
    alarm(): Promise<void>;
    /**
     * Handle WebSocket close events
     */
    webSocketClose(ws: any, code: number, reason: string, wasClean: boolean): Promise<void>;
    /**
     * Handle WebSocket error events
     */
    webSocketError(ws: any, error: Error): Promise<void>;
    /**
     * Get or create PocketBase instance with proper session management
     */
    private getPocketBaseInstance;
    /**
     * Get tools from the comprehensive agent
     */
    private getToolsFromAgent;
    /**
     * Get fallback tools list
     */
    private getFallbackTools;
    /**
     * Test PocketBase connection and authentication
     */
    private testPocketBaseConnection;
    /**
     * Execute PocketBase operation with retry logic
     */
    private executePBOperation;
}
export default PocketBaseMCPDurableObject;
