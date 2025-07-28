/**
 * PocketBase MCP Server - Best Practices Implementation
 *
 * This implementation follows Cloudflare's official MCP best practices:
 * - Uses the official Cloudflare Agents SDK
 * - Proper tool registration patterns from @cloudflare/mcp-server-cloudflare
 * - Individual Zod schemas for better LLM understanding
 * - Proper error handling and state management
 * - Follows the exact patterns from Context7 documentation
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
/** Collection name schema */
export declare const CollectionNameSchema: any;
/** Record ID schema */
export declare const RecordIdSchema: any;
/** Record data schema */
export declare const RecordDataSchema: any;
/** Query filter schema */
export declare const QueryFilterSchema: any;
/** Sort criteria schema */
export declare const SortCriteriaSchema: any;
/** Page number schema */
export declare const PageNumberSchema: any;
/** Records per page schema */
export declare const PerPageSchema: any;
/** Email address schema */
export declare const EmailAddressSchema: any;
/** Email template schema */
export declare const EmailTemplateSchema: any;
/** Stripe amount schema */
export declare const StripeAmountSchema: any;
/** Currency code schema */
export declare const CurrencyCodeSchema: any;
/**
 * PocketBase MCP Agent following Cloudflare best practices
 *
 * Key improvements:
 * - Individual Zod schemas for better LLM understanding
 * - Proper error handling patterns from official Cloudflare MCP servers
 * - Standard tool registration structure
 * - Efficient state management with Agent class
 */
export declare class PocketBaseMCPAgentBestPractices extends Agent<Env, State> {
    server: any;
    initialState: State;
    private pb?;
    private stripeService?;
    private emailService?;
    /**
     * Initialize the agent - called automatically by the Agents framework
     */
    init(): Promise<void>;
    /**
     * Initialize PocketBase connection
     */
    private initializePocketBase;
    /**
     * Initialize additional services
     */
    private initializeServices;
    /**
     * Register all MCP tools following Cloudflare patterns
     */
    private registerTools;
    /**
     * Register PocketBase CRUD tools
     */
    private registerPocketBaseTools;
    /**
     * Register Stripe payment tools
     */
    private registerStripeTools;
    /**
     * Register email tools
     */
    private registerEmailTools;
    /**
     * Register utility tools
     */
    private registerUtilityTools;
    /**
     * Register MCP resources
     */
    private registerResources;
    /**
     * Register MCP prompts
     */
    private registerPrompts;
    /**
     * Create standardized error response following Cloudflare patterns
     */
    private createErrorResponse;
    /**
     * Handle state updates (called by Agents framework)
     */
    onStateUpdate(state: State | undefined, source: any): void;
}
export default PocketBaseMCPAgentBestPractices;
