#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
interface InitializationState {
    configLoaded: boolean;
    pocketbaseInitialized: boolean;
    servicesInitialized: boolean;
    hasValidConfig: boolean;
    isAuthenticated: boolean;
    initializationError?: string;
}
interface ServerConfiguration {
    pocketbaseUrl?: string;
    adminEmail?: string;
    adminPassword?: string;
    stripeSecretKey?: string;
    emailService?: string;
    smtpHost?: string;
}
interface AgentState {
    sessionId?: string;
    configuration?: ServerConfiguration;
    initializationState: InitializationState;
    customHeaders: Record<string, string>;
    lastActiveTime: number;
}
/**
 * Cloudflare-compatible MCP Agent for PocketBase
 * This class encapsulates all stateful operations and can be used with Durable Objects
 */
declare class PocketBaseMCPAgent {
    private server;
    private pb?;
    private _customHeaders;
    private _realtimeSubscriptions;
    private stripeService?;
    private emailService?;
    private initializationState;
    private discoveryMode;
    private configuration?;
    private initializationPromise;
    private state;
    constructor(initialState?: Partial<AgentState>);
    /**
     * Get current agent state for persistence (Durable Object compatibility)
     */
    getState(): AgentState;
    /**
     * Restore agent state from persistence (Durable Object compatibility)
     */
    restoreState(state: AgentState): void;
    /**
     * Check if agent should hibernate (for Cloudflare Durable Objects)
     */
    shouldHibernate(): boolean;
    /**
     * Wake up from hibernation
     */
    wakeUp(): Promise<void>;
    /**
     * Initialize the agent (can be called multiple times safely)
     */
    init(config?: ServerConfiguration): Promise<void>;
    /**
     * Load configuration from environment variables or provided config
     * This is fast and synchronous for discovery purposes
     */
    private loadConfiguration;
    /**
     * Ensure the agent is properly initialized (lazy initialization)
     * This method can be called multiple times safely and won't re-initialize if already done
     */
    ensureInitialized(config?: ServerConfiguration): Promise<void>;
    /**
     * Perform the actual initialization (should only be called once)
     */
    private doInitialization;
    /**
     * Initialize PocketBase connection and authentication
     */
    private initializePocketBase;
    /**
     * Initialize additional services (Stripe, Email, etc.)
     */
    private initializeServices;
    /**
     * Setup tool handlers (called during construction, before initialization)
     */
    private setupTools;
    /**
     * Setup Stripe-related tools
     */
    private setupStripeTools;
    /**
     * Setup Email-related tools
     */
    private setupEmailTools;
    /**
     * Setup resource handlers
     */
    private setupResources;
    /**
     * Setup prompt handlers
     */
    private setupPrompts;
    /**
     * Connect to a transport and start the server
     */
    connect(transport: any): Promise<void>;
    /**
     * Get the underlying MCP server instance
     */
    getServer(): McpServer;
    /**
     * Clean up resources
     */
    cleanup(): Promise<void>;
}
/**
 * Create and configure a new agent instance
 */
export declare function createAgent(initialState?: Partial<AgentState>): PocketBaseMCPAgent;
export { PocketBaseMCPAgent };
