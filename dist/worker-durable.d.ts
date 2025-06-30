/**
 * Cloudflare Worker entry point for PocketBase MCP Server using Durable Objects
 *
 * This worker routes requests to the appropriate Durable Object instance,
 * providing stateful MCP server functionality with proper persistence and scaling.
 */
import { PocketBaseMCPDurableObject, Env } from './durable-object.js';
export { PocketBaseMCPDurableObject };
/**
 * Main Worker fetch handler
 */
declare const _default: {
    fetch(request: Request, env: Env, ctx: any): Promise<Response>;
    /**
     * Handle scheduled events (cron jobs)
     */
    scheduled(event: any, env: Env, ctx: any): Promise<void>;
};
export default _default;
