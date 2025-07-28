/**
 * PocketBase MCP Server using Cloudflare's official McpAgent
 *
 * This implementation uses the official Cloudflare Agents SDK McpAgent class
 * which provides built-in Durable Object state management, hibernation,
 * and authentication support.
 */
import { Agent } from "agents";
interface Env {
    POCKETBASE_URL?: string;
    POCKETBASE_ADMIN_EMAIL?: string;
    POCKETBASE_ADMIN_PASSWORD?: string;
    STRIPE_SECRET_KEY?: string;
    SENDGRID_API_KEY?: string;
    EMAIL_SERVICE?: string;
    SMTP_HOST?: string;
}
interface State {
    pocketbaseInitialized: boolean;
    isAuthenticated: boolean;
    discoveryMode: boolean;
    customHeaders: Record<string, string>;
    realtimeSubscriptions: string[];
    lastActivityTime: number;
}
/**
 * PocketBase MCP Agent using Cloudflare's official McpAgent class
 */
export declare class PocketBaseMCPAgent extends Agent<Env, State> {
    server: any;
    initialState: State;
    private pb?;
    private stripeService?;
    private emailService?;
    private realtimeUnsubscribers;
    /**
     * Initialize the MCP agent
     */
    init(): Promise<void>;
    /**
     * Handle state updates
     */
    onStateUpdate(state: State): void;
    /**
     * Initialize PocketBase connection
     */
    private initializePocketBase;
    /**
     * Initialize additional services
     */
    private initializeServices;
    /**
     * Setup discovery and health tools (always available)
     */
    private setupDiscoveryTools;
    /**
     * Setup PocketBase tools
     */
    private setupPocketBaseTools;
    /**
     * Setup utility tools
     */
    private setupUtilityTools;
    /**
     * Setup Stripe tools
     */
    private setupStripeTools;
    /**
     * Setup Email tools
     */
    private setupEmailTools;
    /**
     * Setup resources
     */
    private setupResources;
    /**
     * Setup prompts
     */
    private setupPrompts;
}
export default PocketBaseMCPAgent;
