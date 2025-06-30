#!/usr/bin/env node
// Entry point for the PocketBase MCP Server
// This file uses the new Cloudflare-compatible agent
import { createAgent } from './agent-simple.js';
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// Parse command line arguments
const args = process.argv.slice(2);
const transportType = args.find(arg => arg.startsWith('--transport='))?.split('=')[1] || 'stdio';
async function main() {
    console.log('🚀 Starting PocketBase MCP Server...');
    console.log('🔧 Using Cloudflare-compatible agent');
    try {
        // Create the agent
        const agent = createAgent();
        // Initialize the agent
        await agent.init();
        // Create the appropriate transport
        let transport;
        switch (transportType) {
            case 'stdio':
                console.log('📡 Using STDIO transport');
                transport = new StdioServerTransport();
                break;
            case 'sse':
            case 'http':
                console.warn(`⚠️  ${transportType.toUpperCase()} transport not implemented in this version`);
                console.log('📡 Falling back to STDIO transport');
                transport = new StdioServerTransport();
                break;
            default:
                console.error(`❌ Unsupported transport: ${transportType}`);
                console.log('📡 Falling back to STDIO transport');
                transport = new StdioServerTransport();
        }
        // Connect the agent to the transport
        await agent.connect(transport);
        console.log('✅ PocketBase MCP Server started successfully');
        console.log('🎯 Server is ready for Cloudflare deployment');
    }
    catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}
// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    process.exit(0);
});
process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down gracefully...');
    process.exit(0);
});
// Start the server
main().catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
});
