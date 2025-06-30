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
    private state;
    private env;
    private sessions;
    private lastActivity;
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
     * Process MCP messages (simplified implementation)
     */
    private processMCPMessage;
    /**
     * Handle health check requests
     */
    private handleHealth;
    /**
     * Handle direct MCP HTTP requests
     */
    private handleMCPRequest;
    /**
     * Handle Server-Sent Events (SSE) for MCP connections
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
     * Hibernate the Durable Object
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
}
export default PocketBaseMCPDurableObject;
