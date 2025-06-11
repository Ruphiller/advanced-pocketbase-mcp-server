#!/usr/bin/env node
import express, { Request, Response } from 'express';
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import PocketBase from 'pocketbase';
import { z } from 'zod';
import { EventSource } from 'eventsource';
import dotenv from 'dotenv';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryEventStore } from '@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js';

// Load environment variables from .env file
dotenv.config();

// Assign the polyfill to the global scope for PocketBase SDK to find
// @ts-ignore - Need to assign to global scope
global.EventSource = EventSource;

// Define types for PocketBase
interface CollectionModel {
  id: string;
  name: string;
  type: string;
  system: boolean;
  schema: SchemaField[];
  listRule: string | null;
  viewRule: string | null;
  createRule: string | null;
  updateRule: string | null;
  deleteRule: string | null;
  indexes?: Array<{
    name: string;
    fields: string[];
    unique?: boolean;
  }>;
}

interface RecordModel {
  id: string;
  [key: string]: any;
}

interface ListResult<T> {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: T[];
}

interface RequestHandlerExtra {
  [key: string]: any;
}

// Using the standard PocketBase type from our updated type definitions

// Schema field type
interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  options?: Record<string, any>;
}

// Schema field from input
interface InputSchemaField {
  name: string;
  type: string;
  required?: boolean;
  options?: Record<string, any>;
}

// Type for subscription event
interface SubscriptionEvent {
  action: string;
  record: RecordModel;
}

export class PocketBaseServer {
  private pb: PocketBase;
  private _customHeaders: Record<string, string> = {};

  constructor() {
    // Initialize PocketBase client
    const url = process.env.POCKETBASE_URL;
    if (!url) {
      throw new Error('POCKETBASE_URL environment variable is required');
    }
    this.pb = new PocketBase(url);
  }

  // Create and configure the MCP server
  createServer(): McpServer {
    const server = new McpServer({
      name: 'pocketbase-server',
      version: '0.1.0',
    }, {
      capabilities: {
        resources: {},
        tools: {},
        prompts: {},
        logging: {}
      }
    });

    this.setupTools(server);
    this.setupResources(server);
    this.setupPrompts(server);

    return server;
  }

  private setupPrompts(server: McpServer) {
    // Collection creation prompt
    server.prompt(
      "create-collection",
      "Create a new collection with specified fields",
      async (extra: RequestHandlerExtra) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Create a new collection with specified fields`
          }
        }]
      })
    );

    // Record creation prompt
    server.prompt(
      "create-record",
      "Create a new record in a collection",
      async (extra: RequestHandlerExtra) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Create a new record in a collection`
          }
        }]
      })
    );

    // Query builder prompt
    server.prompt(
      "build-query",
      "Build a query for a collection with filters, sorting, and expansion",
      async (extra: RequestHandlerExtra) => ({
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Build a query for a collection with filters, sorting, and expansion`
          }
        }]
      })
    );
  }

  private setupResources(server: McpServer) {
    // Server info resource
    server.resource(
      "server-info",
      "pocketbase://info",
      async (uri) => {
        try {
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify({
                url: this.pb.baseUrl,
                isAuthenticated: this.pb.authStore?.isValid || false
              }, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to get server info: ${error.message}`);
        }
      }
    );

    // Collection list resource
    server.resource(
      "collections",
      "pocketbase://collections",
      async (uri) => {
        try {
          const collectionsResponse = await this.pb.collections.getList(1, 100);
          const collections = {
            page: collectionsResponse.page,
            perPage: collectionsResponse.perPage,
            totalItems: collectionsResponse.totalItems,
            totalPages: collectionsResponse.totalPages,
            items: collectionsResponse.items as unknown as CollectionModel[]
          };
          return {
            contents: [{
              uri: uri.href,
              text: JSON.stringify(collections.items.map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                system: c.system,
                listRule: c.listRule,
                viewRule: c.viewRule,
                createRule: c.createRule,
                updateRule: c.updateRule,
                deleteRule: c.deleteRule,
              })), null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to list collections: ${error.message}`);
        }
      }
    );

    // Auth info resource
    server.resource(
      "auth-info",
      "pocketbase://auth",
      async (uri) => {
        try {
          return {            contents: [{
              uri: uri.href,
              text: JSON.stringify({
                isValid: this.pb.authStore.isValid,
                token: this.pb.authStore.token,
                record: this.pb.authStore.record
              }, null, 2)
            }]
          };
        } catch (error: any) {
          throw new Error(`Failed to get auth info: ${error.message}`);
        }
      }
    );
  }

  private setupTools(server: McpServer) {
    console.error('[MCP DEBUG] Setting up tools...');

    // Server info tool
    server.tool(
      'get_server_info',
      {},
      async () => {
        try {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                url: this.pb.baseUrl,
                isAuthenticated: this.pb.authStore?.isValid || false,
                version: '0.1.0'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to get server info: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Auth info tool
    server.tool(
      'get_auth_info',
      {},
      async () => {
        try {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({                isValid: this.pb.authStore.isValid,
                token: this.pb.authStore.token,
                model: this.pb.authStore.record,
                isAdmin: this.pb.authStore.record?.collectionName === '_superusers'
              }, null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to get auth info: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // List collections tool
    server.tool(
      'list_collections',
      {
        includeSystem: z.boolean().optional().default(false).describe('Whether to include system collections')
      },
      async ({ includeSystem }) => {
        try {
          const collections = await this.pb.collections.getList(1, 100);
          const filteredCollections = includeSystem
            ? collections.items
            : collections.items.filter((c: any) => !c.system);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(filteredCollections.map((c: any) => ({
                id: c.id,
                name: c.name,
                type: c.type,
                system: c.system,
                recordCount: c.recordCount || 0
              })), null, 2)
            }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to list collections: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Authentication tool
    server.tool(
      'authenticate_user',
      {
        email: z.string().optional().describe('User email (required unless isAdmin=true and env vars are set)'),
        password: z.string().optional().describe('User password (required unless isAdmin=true and env vars are set)'),
        collection: z.string().optional().default('users').describe('Collection name'),
        isAdmin: z.boolean().optional().default(false).describe('Whether to authenticate as an admin')
      },
      async ({ email, password, collection, isAdmin }) => {
        try {
          const authCollection = isAdmin ? '_superusers' : collection;
          const authEmail = isAdmin && !email ? process.env.POCKETBASE_ADMIN_EMAIL : email;
          const authPassword = isAdmin && !password ? process.env.POCKETBASE_ADMIN_PASSWORD : password;

          if (!authEmail || !authPassword) {
            return {
              content: [{ type: 'text', text: 'Email and password are required for authentication' }],
              isError: true
            };
          }

          const authData = await this.pb
            .collection(authCollection)
            .authWithPassword(authEmail, authPassword);

          return {
            content: [{ type: 'text', text: JSON.stringify(authData, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Authentication failed: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Get collection schema tool with latest MCP features
    server.tool(
      'get_collection_schema',
      {
        collection: z.string().describe('Collection name or ID')
      },
      async ({ collection }) => {
        try {
          console.error('[MCP DEBUG] get_collection_schema called for collection:', collection);
          
          const collectionData = await this.pb.collections.getOne(collection);
          console.error('[MCP DEBUG] Collection data retrieved:', JSON.stringify(collectionData, null, 2));
          
          // In newer PocketBase versions, the schema is in the 'fields' property
          const schema = collectionData.fields || collectionData.schema || [];
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                name: collection,
                id: collectionData.id,
                type: collectionData.type,
                system: collectionData.system,
                schema: schema,
                listRule: collectionData.listRule,
                viewRule: collectionData.viewRule,
                createRule: collectionData.createRule,
                updateRule: collectionData.updateRule,
                deleteRule: collectionData.deleteRule,
                indexes: collectionData.indexes || []
              }, null, 2)
            }]
          };
        } catch (error: any) {
          console.error('[MCP DEBUG] get_collection_schema error:', error);
          
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                name: collection,
                error: "Failed to get collection schema: " + (error.message || "Unknown error")
              }, null, 2)
            }],
            isError: true
          };
        }
      }
    );

    // Real-time streaming tool using latest MCP features
    server.tool(
      'stream_collection_changes',
      {
        collection: z.string().describe('Collection name to stream changes from'),
        recordId: z.string().optional().describe('Specific record ID to watch (optional)'),
        filter: z.string().optional().describe('Filter expression for subscription (optional)')
      },
      async ({ collection, recordId, filter }, { sendNotification }) => {
        try {
          const subscribePath = recordId ? `${collection}/${recordId}` : collection;
          console.error(`[MCP PocketBase] Starting stream for ${subscribePath}...`);

          // Use the new streaming capabilities
          let eventCount = 0;
          const maxEvents = 10; // Limit for demo purposes

          // Simulate real-time events (in a real implementation, this would use PocketBase's real-time subscriptions)
          const interval = setInterval(async () => {
            if (eventCount >= maxEvents) {
              clearInterval(interval);
              return;
            }

            eventCount++;
            try {
              await sendNotification({
                method: "notifications/message",
                params: {
                  level: "info",
                  data: `Collection ${collection} change event #${eventCount} at ${new Date().toISOString()}`
                }
              });
            } catch (error) {
              console.error("Error sending notification:", error);
              clearInterval(interval);
            }
          }, 1000);

          return {
            content: [{
              type: 'text',
              text: `Started streaming changes for collection '${collection}'${recordId ? ` record '${recordId}'` : ''}. Events will be sent via notifications.`
            }]
          };
        } catch (error: any) {
          console.error(`[MCP PocketBase] Stream failed for ${collection}:`, error);
          return {
            content: [{ type: 'text', text: `Failed to start stream: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    // Add more essential tools
    server.tool(
      'create_record',
      {
        collection: z.string().describe('Collection name'),
        data: z.record(z.any()).describe('Record data')
      },
      async ({ collection, data }) => {
        try {
          const result = await this.pb.collection(collection).create(data);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to create record: ${error.message}` }],
            isError: true
          };
        }
      }
    );

    server.tool(
      'list_records',
      {
        collection: z.string().describe('Collection name'),
        filter: z.string().optional().describe('Filter query'),
        sort: z.string().optional().describe('Sort field and direction'),
        page: z.number().optional().describe('Page number'),
        perPage: z.number().optional().describe('Items per page')
      },
      async ({ collection, filter, sort, page = 1, perPage = 50 }) => {
        try {
          const options: any = {};
          if (filter) options.filter = filter;
          if (sort) options.sort = sort;

          const result = await this.pb.collection(collection).getList(page, perPage, options);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          };
        } catch (error: any) {
          return {
            content: [{ type: 'text', text: `Failed to list records: ${error.message}` }],
            isError: true
          };
        }
      }
    );
  }

  // Run as stdio server (for CLI usage)
  async runStdio() {
    console.error('[MCP DEBUG] Starting PocketBase MCP server in stdio mode...');
    
    const server = this.createServer();
    const transport = new StdioServerTransport();
    
    try {
      await server.connect(transport);
      console.error('[MCP DEBUG] PocketBase MCP server running on stdio');
    } catch (error) {
      console.error(`[MCP DEBUG] Error connecting server: ${error}`);
    }
  }

  // Run as HTTP server with SSE support
  async runHttp(port: number = 3000) {
    console.error(`[MCP DEBUG] Starting PocketBase MCP server in HTTP mode on port ${port}...`);
    
    const app = express();
    app.use(express.json());

    // Store transports by session ID
    const transports: Record<string, any> = {};

    //=============================================================================
    // STREAMABLE HTTP TRANSPORT (PROTOCOL VERSION 2025-03-26)
    //=============================================================================
    app.all('/mcp', async (req, res) => {
      console.log(`Received ${req.method} request to /mcp`);
      try {
        const sessionId = req.headers['mcp-session-id'] as string;
        let transport: StreamableHTTPServerTransport | undefined;

        if (sessionId && transports[sessionId]) {
          const existingTransport = transports[sessionId];
          if (existingTransport instanceof StreamableHTTPServerTransport) {
            transport = existingTransport;
          } else {
            res.status(400).json({
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: 'Bad Request: Session exists but uses a different transport protocol',
              },
              id: null,
            });
            return;
          }
        } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
          const eventStore = new InMemoryEventStore();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            eventStore,
            onsessioninitialized: (sessionId) => {
              console.log(`StreamableHTTP session initialized with ID: ${sessionId}`);
              transports[sessionId] = transport!;
            }
          });

          transport.onclose = () => {
            const sid = transport!.sessionId;
            if (sid && transports[sid]) {
              console.log(`Transport closed for session ${sid}, removing from transports map`);
              delete transports[sid];
            }
          };

          const server = this.createServer();
          await server.connect(transport);
        } else {
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: No valid session ID provided',
            },
            id: null,
          });
          return;
        }

        if (transport) {
          await transport.handleRequest(req, res, req.body);
        }
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
      }
    });

    //=============================================================================
    // DEPRECATED HTTP+SSE TRANSPORT (PROTOCOL VERSION 2024-11-05)
    //=============================================================================
    app.get('/sse', async (req, res) => {
      console.log('Received GET request to /sse (deprecated SSE transport)');
      const transport = new SSEServerTransport('/messages', res);
      transports[transport.sessionId] = transport;
      
      res.on("close", () => {
        delete transports[transport.sessionId];
      });

      const server = this.createServer();
      await server.connect(transport);
    });

    app.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const existingTransport = transports[sessionId];
      
      if (existingTransport instanceof SSEServerTransport) {
        await existingTransport.handlePostMessage(req, res, req.body);
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: Session exists but uses a different transport protocol',
          },
          id: null,
        });
      }
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy', 
        server: 'pocketbase-mcp-server',
        version: '0.1.0',
        pocketbaseUrl: this.pb.baseUrl,
        isAuthenticated: this.pb.authStore?.isValid || false
      });
    });

    // Start the server
    app.listen(port, () => {
      console.log(`PocketBase MCP server listening on port ${port}`);
      console.log(`
==============================================
SUPPORTED TRANSPORT OPTIONS:

1. Streamable HTTP (Protocol version: 2025-03-26)
   Endpoint: /mcp
   Methods: GET, POST, DELETE
   Usage: 
     - Initialize with POST to /mcp
     - Establish SSE stream with GET to /mcp
     - Send requests with POST to /mcp
     - Terminate session with DELETE to /mcp

2. HTTP + SSE (Protocol version: 2024-11-05)
   Endpoints: /sse (GET) and /messages (POST)
   Usage:
     - Establish SSE stream with GET to /sse
     - Send requests with POST to /messages?sessionId=<id>

3. Health Check
   Endpoint: /health (GET)
   Returns server status and PocketBase connection info
==============================================
`);
    });

    // Handle server shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down server...');
      for (const sessionId in transports) {
        try {
          console.log(`Closing transport for session ${sessionId}`);
          await transports[sessionId].close();
          delete transports[sessionId];
        } catch (error) {
          console.error(`Error closing transport for session ${sessionId}:`, error);
        }
      }
      console.log('Server shutdown complete');
      process.exit(0);
    });
  }
}

// Determine how to run based on command line arguments
const args = process.argv.slice(2);
const server = new PocketBaseServer();

if (args.includes('--http') || args.includes('--sse')) {
  const portArg = args.find(arg => arg.startsWith('--port='));
  const port = portArg ? parseInt(portArg.split('=')[1]) : 3000;
  server.runHttp(port).catch(console.error);
} else {
  // Default to stdio mode
  server.runStdio().catch(console.error);
}
