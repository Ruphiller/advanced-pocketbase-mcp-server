/**
 * Cloudflare Worker Entry Point - Best Practices Implementation
 *
 * This worker demonstrates the recommended patterns for deploying
 * MCP servers on Cloudflare Workers with Durable Objects.
 */
import PocketBaseMCPAgent from './agent-cloudflare.js';
interface Env {
    POCKETBASE_MCP_DO: DurableObjectNamespace;
    POCKETBASE_URL?: string;
    POCKETBASE_ADMIN_EMAIL?: string;
    POCKETBASE_ADMIN_PASSWORD?: string;
    STRIPE_SECRET_KEY?: string;
    SENDGRID_API_KEY?: string;
    EMAIL_SERVICE?: string;
    SMTP_HOST?: string;
}
/**
 * Best Practices Durable Object using Cloudflare Agents SDK
 *
 * This follows the exact patterns from the official Cloudflare MCP servers:
 * - Extends Agent class for automatic state management
 * - Built-in hibernation support
 * - Proper SSE endpoint handling
 * - OAuth integration capabilities
 */
export declare class PocketBaseMCPBestPractices extends PocketBaseMCPAgent {
}
/**
 * Worker fetch handler using Agent.serveSSE
 *
 * This follows the recommended pattern from Cloudflare MCP documentation
 */
declare const _default: {
    fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
};
export default _default;
