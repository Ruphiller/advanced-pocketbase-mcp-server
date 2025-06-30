/**
 * Worker-Compatible PocketBase MCP Server
 * 
 * This implementation provides PocketBase tools without Node.js dependencies
 * that are incompatible with Cloudflare Workers runtime.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import PocketBase from 'pocketbase';

export interface WorkerCompatibleAgentState {
  initialized: boolean;
  pocketbaseUrl?: string;
  lastActivity: number;
  sessionId?: string;
}

export class WorkerCompatiblePocketBaseMCPAgent {
  private server = new Server({
    name: "pocketbase-worker-server",
    version: "1.0.0"
  }, {
    capabilities: {
      tools: {}
    }
  });

  private pb: PocketBase | null = null;
  private initialized = false;
  private state: WorkerCompatibleAgentState = {
    initialized: false,
    lastActivity: Date.now()
  };

  constructor() {
    this.setupTools();
  }

  /**
   * Initialize the agent with configuration
   */
  async init(config: {
    pocketbaseUrl?: string;
    adminEmail?: string;
    adminPassword?: string;
  }): Promise<void> {
    try {
      if (config.pocketbaseUrl) {
        this.pb = new PocketBase(config.pocketbaseUrl);
        
        // Try to authenticate if credentials provided
        if (config.adminEmail && config.adminPassword) {
          try {
            await this.pb.collection('_admins').authWithPassword(config.adminEmail, config.adminPassword);
            console.log('PocketBase admin authenticated successfully');
          } catch (error) {
            console.warn('PocketBase admin authentication failed:', error);
          }
        }
      }

      this.state.initialized = true;
      this.state.pocketbaseUrl = config.pocketbaseUrl;
      this.state.lastActivity = Date.now();
      this.initialized = true;

      console.log('Worker-compatible agent initialized successfully');
    } catch (error) {
      console.error('Failed to initialize worker-compatible agent:', error);
      throw error;
    }
  }

  /**
   * Get current agent state
   */
  getState(): WorkerCompatibleAgentState {
    return {
      ...this.state,
      lastActivity: Date.now()
    };
  }

  /**
   * Get the MCP server instance
   */
  getServer(): Server {
    return this.server;
  }

  /**
   * Setup MCP tools
   */
  private setupTools(): void {
    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case "health_check":
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "healthy",
                  initialized: this.initialized,
                  pocketbaseConnected: Boolean(this.pb),
                  timestamp: new Date().toISOString()
                }, null, 2)
              }
            ]
          };

        case "list_collections":
          return await this.listCollections();

        case "get_collection": {
          if (!args || typeof args !== "object" || typeof (args as any).name !== "string") {
            throw new Error("'name' is required and must be a string for get_collection");
          }
          return await this.getCollection((args as any).name);
        }

        case "list_records": {
          if (!args || typeof args !== "object" || typeof (args as any).collection !== "string") {
            throw new Error("'collection' is required and must be a string for list_records");
          }
          return await this.listRecords((args as any).collection, args);
        }

        case "get_record": {
          if (!args || typeof args !== "object" || typeof (args as any).collection !== "string" || typeof (args as any).id !== "string") {
            throw new Error("'collection' and 'id' are required and must be strings for get_record");
          }
          return await this.getRecord((args as any).collection, (args as any).id);
        }

        case "create_record": {
          if (!args || typeof args !== "object" || typeof (args as any).collection !== "string" || typeof (args as any).data !== "object") {
            throw new Error("'collection' (string) and 'data' (object) are required for create_record");
          }
          return await this.createRecord((args as any).collection, (args as any).data);
        }

        case "update_record": {
          if (!args || typeof args !== "object" || typeof (args as any).collection !== "string" || typeof (args as any).id !== "string" || typeof (args as any).data !== "object") {
            throw new Error("'collection' (string), 'id' (string), and 'data' (object) are required for update_record");
          }
          return await this.updateRecord((args as any).collection, (args as any).id, (args as any).data);
        }

        case "delete_record": {
          if (!args || typeof args !== "object" || typeof (args as any).collection !== "string" || typeof (args as any).id !== "string") {
            throw new Error("'collection' and 'id' are required and must be strings for delete_record");
          }
          return await this.deleteRecord((args as any).collection, (args as any).id);
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });

    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "health_check",
            description: "Check the health status of the MCP server",
            inputSchema: {
              type: "object",
              properties: {},
              required: []
            }
          },
          {
            name: "list_collections",
            description: "List all PocketBase collections",
            inputSchema: {
              type: "object",
              properties: {},
              required: []
            }
          },
          {
            name: "get_collection",
            description: "Get detailed information about a specific collection",
            inputSchema: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "Collection name"
                }
              },
              required: ["name"]
            }
          },
          {
            name: "list_records",
            description: "List records from a collection",
            inputSchema: {
              type: "object",
              properties: {
                collection: {
                  type: "string",
                  description: "Collection name"
                },
                page: {
                  type: "number",
                  description: "Page number (default: 1)"
                },
                perPage: {
                  type: "number",
                  description: "Records per page (default: 30)"
                },
                filter: {
                  type: "string",
                  description: "Filter expression"
                },
                sort: {
                  type: "string",
                  description: "Sort expression"
                }
              },
              required: ["collection"]
            }
          },
          {
            name: "get_record",
            description: "Get a specific record by ID",
            inputSchema: {
              type: "object",
              properties: {
                collection: {
                  type: "string",
                  description: "Collection name"
                },
                id: {
                  type: "string",
                  description: "Record ID"
                }
              },
              required: ["collection", "id"]
            }
          },
          {
            name: "create_record",
            description: "Create a new record in a collection",
            inputSchema: {
              type: "object",
              properties: {
                collection: {
                  type: "string",
                  description: "Collection name"
                },
                data: {
                  type: "object",
                  description: "Record data"
                }
              },
              required: ["collection", "data"]
            }
          },
          {
            name: "update_record",
            description: "Update an existing record",
            inputSchema: {
              type: "object",
              properties: {
                collection: {
                  type: "string",
                  description: "Collection name"
                },
                id: {
                  type: "string",
                  description: "Record ID"
                },
                data: {
                  type: "object",
                  description: "Updated record data"
                }
              },
              required: ["collection", "id", "data"]
            }
          },
          {
            name: "delete_record",
            description: "Delete a record by ID",
            inputSchema: {
              type: "object",
              properties: {
                collection: {
                  type: "string",
                  description: "Collection name"
                },
                id: {
                  type: "string",
                  description: "Record ID"
                }
              },
              required: ["collection", "id"]
            }
          }
        ]
      };
    });
  }

  /**
   * List collections
   */
  private async listCollections() {
    if (!this.pb) {
      throw new Error('PocketBase not configured');
    }

    try {
      const collections = await this.pb.collections.getFullList();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(collections, null, 2)
          }
        ]
      };
    } catch (error: any) {
      throw new Error(`Failed to list collections: ${error.message}`);
    }
  }

  /**
   * Get collection details
   */
  private async getCollection(name: string) {
    if (!this.pb) {
      throw new Error('PocketBase not configured');
    }

    try {
      const collection = await this.pb.collections.getOne(name);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(collection, null, 2)
          }
        ]
      };
    } catch (error: any) {
      throw new Error(`Failed to get collection: ${error.message}`);
    }
  }

  /**
   * List records from a collection
   */
  private async listRecords(collection: string, options: any = {}) {
    if (!this.pb) {
      throw new Error('PocketBase not configured');
    }

    try {
      const records = await this.pb.collection(collection).getList(
        options.page || 1,
        options.perPage || 30,
        {
          filter: options.filter,
          sort: options.sort
        }
      );
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(records, null, 2)
          }
        ]
      };
    } catch (error: any) {
      throw new Error(`Failed to list records: ${error.message}`);
    }
  }

  /**
   * Get a specific record
   */
  private async getRecord(collection: string, id: string) {
    if (!this.pb) {
      throw new Error('PocketBase not configured');
    }

    try {
      const record = await this.pb.collection(collection).getOne(id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(record, null, 2)
          }
        ]
      };
    } catch (error: any) {
      throw new Error(`Failed to get record: ${error.message}`);
    }
  }

  /**
   * Create a new record
   */
  private async createRecord(collection: string, data: any) {
    if (!this.pb) {
      throw new Error('PocketBase not configured');
    }

    try {
      const record = await this.pb.collection(collection).create(data);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(record, null, 2)
          }
        ]
      };
    } catch (error: any) {
      throw new Error(`Failed to create record: ${error.message}`);
    }
  }

  /**
   * Update a record
   */
  private async updateRecord(collection: string, id: string, data: any) {
    if (!this.pb) {
      throw new Error('PocketBase not configured');
    }

    try {
      const record = await this.pb.collection(collection).update(id, data);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(record, null, 2)
          }
        ]
      };
    } catch (error: any) {
      throw new Error(`Failed to update record: ${error.message}`);
    }
  }

  /**
   * Delete a record
   */
  private async deleteRecord(collection: string, id: string) {
    if (!this.pb) {
      throw new Error('PocketBase not configured');
    }

    try {
      await this.pb.collection(collection).delete(id);
      return {
        content: [
          {
            type: "text",
            text: `Record ${id} deleted successfully from collection ${collection}`
          }
        ]
      };
    } catch (error: any) {
      throw new Error(`Failed to delete record: ${error.message}`);
    }
  }
}
