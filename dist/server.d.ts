#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare class PocketBaseServer {
    private pb;
    private _customHeaders;
    constructor();
    createServer(): McpServer;
    private setupPrompts;
    private setupResources;
    private setupTools;
    runStdio(): Promise<void>;
    runHttp(port?: number): Promise<void>;
}
