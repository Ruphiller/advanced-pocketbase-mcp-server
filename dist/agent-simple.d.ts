#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
interface ServerConfiguration {
    pocketbaseUrl?: string;
    adminEmail?: string;
    adminPassword?: string;
    stripeSecretKey?: string;
    emailService?: string;
    smtpHost?: string;
}
interface InitializationState {
    configLoaded: boolean;
    pocketbaseInitialized: boolean;
    servicesInitialized: boolean;
    hasValidConfig: boolean;
    isAuthenticated: boolean;
    initializationError?: string;
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
    private stripeService?;
    private emailService?;
    private state;
    private initializationPromise;
    private discoveryMode;
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
     */
    private loadConfiguration;
    /**
     * Ensure the agent is properly initialized
     */
    ensureInitialized(config?: ServerConfiguration): Promise<void>;
    /**
     * Perform the actual initialization
     */
    private doInitialization;
    /**
     * Initialize PocketBase connection
     */
    private initializePocketBase;
    /**
     * Initialize additional services
     */
    private initializeServices;
    /**
     * Setup tool handlers using the correct MCP SDK API
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
    /**
     * Lazy load Stripe service if environment variables are available
     */
    private ensureStripeService;
    /**
     * Lazy load Email service if environment variables are available
     */
    private ensureEmailService;
}
/**
 * Create and configure a new agent instance
 */
export declare function createAgent(initialState?: Partial<AgentState>): PocketBaseMCPAgent;
export { PocketBaseMCPAgent };
