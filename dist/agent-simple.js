#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import PocketBase from 'pocketbase';
import { z } from 'zod';
import { EventSource } from 'eventsource';
import * as dotenv from 'dotenv';
import { StripeService } from './services/stripe.js';
import { EmailService } from './services/email.js';
// Load environment variables from .env file
dotenv.config();
// Assign the polyfill to the global scope for PocketBase SDK to find
// @ts-ignore - Need to assign to global scope
global.EventSource = EventSource;
// Smithery configToEnv mapping
const configToEnv = {
    pocketbaseUrl: 'POCKETBASE_URL',
    adminEmail: 'POCKETBASE_ADMIN_EMAIL',
    adminPassword: 'POCKETBASE_ADMIN_PASSWORD',
    stripeSecretKey: 'STRIPE_SECRET_KEY',
    emailService: 'EMAIL_SERVICE',
    smtpHost: 'SMTP_HOST',
    smtpPort: 'SMTP_PORT',
    smtpUser: 'SMTP_USER',
    smtpPassword: 'SMTP_PASSWORD',
    sendgridApiKey: 'SENDGRID_API_KEY',
    defaultFromEmail: 'DEFAULT_FROM_EMAIL'
};
// Apply configuration to environment variables if provided
function applyConfigToEnv(config) {
    Object.entries(configToEnv).forEach(([configKey, envVar]) => {
        if (config[configKey] !== undefined && config[configKey] !== null) {
            process.env[envVar] = String(config[configKey]);
        }
    });
}
/**
 * Cloudflare-compatible MCP Agent for PocketBase
 * This class encapsulates all stateful operations and can be used with Durable Objects
 */
class PocketBaseMCPAgent {
    server;
    pb;
    stripeService;
    emailService;
    // State management
    state;
    initializationPromise = null;
    discoveryMode = false;
    constructor(initialState) {
        // Initialize state from provided state or defaults
        this.state = {
            sessionId: initialState?.sessionId,
            configuration: initialState?.configuration,
            initializationState: initialState?.initializationState || {
                configLoaded: false,
                pocketbaseInitialized: false,
                servicesInitialized: false,
                hasValidConfig: false,
                isAuthenticated: false
            },
            customHeaders: initialState?.customHeaders || {},
            lastActiveTime: Date.now()
        };
        this.server = new McpServer({
            name: 'pocketbase-server',
            version: '0.1.0',
        }, {
            capabilities: {
                resources: {},
                tools: {},
                prompts: {}
            }
        });
        // Setup MCP server components
        this.setupTools();
        this.setupResources();
        this.setupPrompts();
    }
    /**
     * Get current agent state for persistence (Durable Object compatibility)
     */
    getState() {
        this.state.lastActiveTime = Date.now();
        return { ...this.state };
    }
    /**
     * Restore agent state from persistence (Durable Object compatibility)
     */
    restoreState(state) {
        this.state = state;
    }
    /**
     * Check if agent should hibernate (for Cloudflare Durable Objects)
     */
    shouldHibernate() {
        const inactiveTime = Date.now() - this.state.lastActiveTime;
        const HIBERNATION_THRESHOLD = 30 * 60 * 1000; // 30 minutes
        return inactiveTime > HIBERNATION_THRESHOLD;
    }
    /**
     * Wake up from hibernation
     */
    async wakeUp() {
        this.state.lastActiveTime = Date.now();
        if (this.state.initializationState.pocketbaseInitialized && !this.pb) {
            await this.doInitialization();
        }
    }
    /**
     * Initialize the agent (can be called multiple times safely)
     */
    async init(config) {
        this.state.lastActiveTime = Date.now();
        await this.ensureInitialized(config);
    }
    /**
     * Load configuration from environment variables or provided config
     */
    loadConfiguration(config) {
        if (this.state.initializationState.configLoaded && this.state.configuration) {
            return this.state.configuration;
        }
        try {
            if (config) {
                applyConfigToEnv(config);
            }
            const pocketbaseUrl = config?.pocketbaseUrl || process.env.POCKETBASE_URL;
            const adminEmail = config?.adminEmail || process.env.POCKETBASE_ADMIN_EMAIL;
            const adminPassword = config?.adminPassword || process.env.POCKETBASE_ADMIN_PASSWORD;
            const stripeSecretKey = config?.stripeSecretKey || process.env.STRIPE_SECRET_KEY;
            this.state.configuration = {
                pocketbaseUrl,
                adminEmail,
                adminPassword,
                stripeSecretKey
            };
            this.state.initializationState.configLoaded = true;
            this.state.initializationState.hasValidConfig = Boolean(pocketbaseUrl);
            return this.state.configuration;
        }
        catch (error) {
            this.state.initializationState.initializationError = error.message;
            throw error;
        }
    }
    /**
     * Ensure the agent is properly initialized
     */
    async ensureInitialized(config) {
        if (this.initializationPromise) {
            return this.initializationPromise;
        }
        if (this.state.initializationState.pocketbaseInitialized && this.state.initializationState.servicesInitialized) {
            return;
        }
        this.initializationPromise = this.doInitialization(config);
        try {
            await this.initializationPromise;
        }
        finally {
            this.initializationPromise = null;
        }
    }
    /**
     * Perform the actual initialization
     */
    async doInitialization(config) {
        try {
            this.loadConfiguration(config);
            if (!this.state.initializationState.hasValidConfig) {
                this.discoveryMode = true;
                return;
            }
            // Initialize PocketBase
            if (!this.state.initializationState.pocketbaseInitialized) {
                await this.initializePocketBase();
            }
            // Initialize services
            if (!this.state.initializationState.servicesInitialized) {
                await this.initializeServices();
            }
        }
        catch (error) {
            this.state.initializationState.initializationError = error.message;
            this.discoveryMode = true;
        }
    }
    /**
     * Initialize PocketBase connection
     */
    async initializePocketBase() {
        if (!this.state.configuration?.pocketbaseUrl) {
            throw new Error('PocketBase URL is required for initialization');
        }
        try {
            this.pb = new PocketBase(this.state.configuration.pocketbaseUrl);
            // Test connection
            try {
                await this.pb.health.check();
            }
            catch (error) {
                console.warn('PocketBase health check failed, continuing anyway');
            }
            // Authenticate if credentials provided
            if (this.state.configuration.adminEmail && this.state.configuration.adminPassword) {
                try {
                    await this.pb.admins.authWithPassword(this.state.configuration.adminEmail, this.state.configuration.adminPassword);
                    this.state.initializationState.isAuthenticated = true;
                }
                catch (error) {
                    console.warn('Admin authentication failed, continuing without auth');
                }
            }
            this.state.initializationState.pocketbaseInitialized = true;
        }
        catch (error) {
            throw new Error(`Failed to initialize PocketBase: ${error.message}`);
        }
    }
    /**
     * Initialize additional services
     */
    async initializeServices() {
        try {
            if (this.state.configuration?.stripeSecretKey && this.pb) {
                try {
                    this.stripeService = new StripeService(this.pb);
                }
                catch (error) {
                    console.warn('Stripe service initialization failed');
                }
            }
            if ((this.state.configuration?.emailService || this.state.configuration?.smtpHost) && this.pb) {
                try {
                    this.emailService = new EmailService(this.pb);
                }
                catch (error) {
                    console.warn('Email service initialization failed');
                }
            }
            this.state.initializationState.servicesInitialized = true;
        }
        catch (error) {
            throw new Error(`Failed to initialize services: ${error.message}`);
        }
    }
    /**
     * Setup tool handlers using the correct MCP SDK API
     */
    setupTools() {
        // Health check tool (always available)
        this.server.tool('health_check', {
            description: 'Check the health status of the MCP server and PocketBase connection'
        }, async () => {
            const status = {
                server: 'healthy',
                timestamp: new Date().toISOString(),
                initialized: this.state.initializationState.pocketbaseInitialized,
                authenticated: this.state.initializationState.isAuthenticated,
                discoveryMode: this.discoveryMode
            };
            if (this.pb) {
                try {
                    await this.pb.health.check();
                    status.pocketbase = 'healthy';
                }
                catch (error) {
                    status.pocketbase = 'unhealthy';
                }
            }
            else {
                status.pocketbase = 'not initialized';
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(status, null, 2)
                    }]
            };
        });
        // Tool discovery (always available)
        this.server.tool('discover_tools', {
            description: 'List all available tools and their current status'
        }, async () => {
            const tools = [];
            tools.push({
                name: 'health_check',
                status: 'available',
                description: 'Health check tool'
            });
            tools.push({
                name: 'discover_tools',
                status: 'available',
                description: 'Tool discovery'
            });
            // PocketBase tools
            const pbStatus = this.state.initializationState.pocketbaseInitialized ? 'available' : 'requires_initialization';
            ['list_collections', 'get_collection', 'list_records', 'get_record', 'create_record'].forEach(toolName => {
                tools.push({
                    name: toolName,
                    status: pbStatus,
                    description: `PocketBase ${toolName.replace(/_/g, ' ')}`
                });
            });
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            totalTools: tools.length,
                            availableTools: tools.filter(t => t.status === 'available').length,
                            tools: tools
                        }, null, 2)
                    }]
            };
        });
        // Smithery discovery tool
        this.server.tool('smithery_discovery', {
            description: 'Fast discovery endpoint for Smithery tool scanning'
        }, async () => {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            server: 'pocketbase-mcp-server',
                            version: '0.1.0',
                            capabilities: ['pocketbase', 'database', 'realtime', 'auth'],
                            status: 'ready',
                            discoveryTime: '0ms'
                        }, null, 2)
                    }]
            };
        });
        // PocketBase collection tools
        this.server.tool('list_collections', {
            description: 'List all collections in the PocketBase database'
        }, async () => {
            await this.ensureInitialized();
            if (!this.pb) {
                throw new Error('PocketBase not initialized');
            }
            try {
                const collections = await this.pb.collections.getFullList();
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify(collections, null, 2)
                        }]
                };
            }
            catch (error) {
                throw new Error(`Failed to list collections: ${error.message}`);
            }
        });
        this.server.tool('get_collection', {
            description: 'Get details of a specific collection',
            inputSchema: {
                nameOrId: z.string().describe('Collection name or ID')
            }
        }, async ({ nameOrId }) => {
            await this.ensureInitialized();
            if (!this.pb) {
                throw new Error('PocketBase not initialized');
            }
            try {
                const collection = await this.pb.collections.getOne(nameOrId);
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify(collection, null, 2)
                        }]
                };
            }
            catch (error) {
                throw new Error(`Failed to get collection: ${error.message}`);
            }
        });
        // PocketBase record tools
        this.server.tool('list_records', {
            description: 'List records from a collection',
            inputSchema: {
                collection: z.string().describe('Collection name'),
                page: z.number().optional().describe('Page number (default: 1)'),
                perPage: z.number().optional().describe('Records per page (default: 30)')
            }
        }, async ({ collection, page = 1, perPage = 30 }) => {
            await this.ensureInitialized();
            if (!this.pb) {
                throw new Error('PocketBase not initialized');
            }
            try {
                const records = await this.pb.collection(collection).getList(page, perPage);
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify(records, null, 2)
                        }]
                };
            }
            catch (error) {
                throw new Error(`Failed to list records: ${error.message}`);
            }
        });
        this.server.tool('get_record', {
            description: 'Get a specific record by ID',
            inputSchema: {
                collection: z.string().describe('Collection name'),
                id: z.string().describe('Record ID')
            }
        }, async ({ collection, id }) => {
            await this.ensureInitialized();
            if (!this.pb) {
                throw new Error('PocketBase not initialized');
            }
            try {
                const record = await this.pb.collection(collection).getOne(id);
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify(record, null, 2)
                        }]
                };
            }
            catch (error) {
                throw new Error(`Failed to get record: ${error.message}`);
            }
        });
        this.server.tool('create_record', {
            description: 'Create a new record in a collection',
            inputSchema: {
                collection: z.string().describe('Collection name'),
                data: z.record(z.any()).describe('Record data')
            }
        }, async ({ collection, data }) => {
            await this.ensureInitialized();
            if (!this.pb) {
                throw new Error('PocketBase not initialized');
            }
            try {
                const record = await this.pb.collection(collection).create(data);
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify(record, null, 2)
                        }]
                };
            }
            catch (error) {
                throw new Error(`Failed to create record: ${error.message}`);
            }
        });
        // Add Stripe tools if available
        if (this.stripeService) {
            this.setupStripeTools();
        }
    }
    /**
     * Setup Stripe-related tools
     */
    setupStripeTools() {
        if (!this.stripeService)
            return;
        this.server.tool('create_stripe_customer', {
            description: 'Create a new customer in Stripe',
            inputSchema: {
                email: z.string().email().describe('Customer email'),
                name: z.string().optional().describe('Customer name')
            }
        }, async ({ email, name }) => {
            if (!this.stripeService) {
                throw new Error('Stripe service not initialized');
            }
            try {
                const customer = await this.stripeService.createCustomer({ email, name });
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify(customer, null, 2)
                        }]
                };
            }
            catch (error) {
                throw new Error(`Failed to create Stripe customer: ${error.message}`);
            }
        });
    }
    /**
     * Setup resource handlers
     */
    setupResources() {
        // Agent status resource
        this.server.resource('agent_status', 'agent://status', {
            description: 'Get current agent status and configuration'
        }, async (uri) => {
            const status = {
                agent: {
                    sessionId: this.state.sessionId,
                    lastActiveTime: new Date(this.state.lastActiveTime).toISOString(),
                    discoveryMode: this.discoveryMode
                },
                initialization: this.state.initializationState,
                services: {
                    pocketbase: Boolean(this.pb),
                    stripe: Boolean(this.stripeService),
                    email: Boolean(this.emailService)
                }
            };
            return {
                contents: [{
                        uri: uri.href,
                        mimeType: 'application/json',
                        text: JSON.stringify(status, null, 2)
                    }]
            };
        });
    }
    /**
     * Setup prompt handlers
     */
    setupPrompts() {
        this.server.prompt('setup_collection', 'Interactive prompt to help set up a new PocketBase collection', (extra) => {
            const name = extra.arguments?.name || 'new_collection';
            const type = extra.arguments?.type || 'base';
            return {
                messages: [{
                        role: 'assistant',
                        content: {
                            type: 'text',
                            text: `I'll help you set up a new ${type} collection named "${name}". Would you like me to create this collection with a basic schema?`
                        }
                    }]
            };
        });
    }
    /**
     * Connect to a transport and start the server
     */
    async connect(transport) {
        this.state.lastActiveTime = Date.now();
        await this.server.connect(transport);
    }
    /**
     * Get the underlying MCP server instance
     */
    getServer() {
        return this.server;
    }
    /**
     * Clean up resources
     */
    async cleanup() {
        if (this.pb) {
            try {
                this.pb.authStore.clear();
            }
            catch (error) {
                console.warn('Error clearing auth store:', error);
            }
        }
    }
}
/**
 * Create and configure a new agent instance
 */
export function createAgent(initialState) {
    return new PocketBaseMCPAgent(initialState);
}
/**
 * Main server function for traditional deployment
 */
async function main() {
    const args = process.argv.slice(2);
    const transportType = args.find(arg => arg.startsWith('--transport='))?.split('=')[1] || 'stdio';
    const port = parseInt(args.find(arg => arg.startsWith('--port='))?.split('=')[1] || '3000');
    const host = args.find(arg => arg.startsWith('--host='))?.split('=')[1] || 'localhost';
    // Create agent instance
    const agent = createAgent();
    // Initialize agent
    await agent.init();
    // Set up transport
    let transport;
    switch (transportType) {
        case 'stdio':
            transport = new StdioServerTransport();
            break;
        case 'sse':
            // For SSE transport, we would need an Express app setup
            // For now, fall back to stdio
            console.warn('SSE transport not implemented in this simple version, using stdio');
            transport = new StdioServerTransport();
            break;
        default:
            console.error(`Unknown transport type: ${transportType}`);
            process.exit(1);
    }
    // Connect agent to transport
    await agent.connect(transport);
}
// Export for Cloudflare Workers / Durable Objects
export { PocketBaseMCPAgent };
// For traditional deployment - check if this module is being run directly
if (process.argv[1] && process.argv[1].endsWith('agent-simple.js')) {
    main().catch(error => {
        console.error('Server failed to start:', error);
        process.exit(1);
    });
}
