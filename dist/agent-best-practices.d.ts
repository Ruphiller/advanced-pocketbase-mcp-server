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
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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
export declare const CollectionNameSchema: z.ZodString;
/** Record ID schema */
export declare const RecordIdSchema: z.ZodString;
/** Record data schema */
export declare const RecordDataSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
/** Query filter schema */
export declare const QueryFilterSchema: z.ZodOptional<z.ZodString>;
/** Sort criteria schema */
export declare const SortCriteriaSchema: z.ZodOptional<z.ZodString>;
/** Page number schema */
export declare const PageNumberSchema: z.ZodOptional<z.ZodNumber>;
/** Records per page schema */
export declare const PerPageSchema: z.ZodOptional<z.ZodNumber>;
/** Email address schema */
export declare const EmailAddressSchema: z.ZodString;
/** Email template schema */
export declare const EmailTemplateSchema: z.ZodString;
/** Stripe amount schema */
export declare const StripeAmountSchema: z.ZodNumber;
/** Currency code schema */
export declare const CurrencyCodeSchema: z.ZodString;
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
    server: McpServer;
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
