# Cloudflare-Compatible MCP Agent for PocketBase

This document explains how to use the new `PocketBaseMCPAgent` class that's designed to be compatible with Cloudflare Workers and Durable Objects.

## Overview

The `PocketBaseMCPAgent` class provides a stateful, hibernation-ready MCP server that can be deployed on Cloudflare's edge infrastructure. It includes all the functionality of the original PocketBase MCP server but with added support for:

- **State Persistence**: Agent state can be saved and restored (for Durable Objects)
- **Hibernation Support**: Automatic cleanup when inactive
- **Fast Tool Discovery**: Instant response for tool scanning (0ms for Smithery)
- **Lazy Initialization**: PocketBase connections are only established when needed

## Key Features

### Agent State Management

The agent maintains its state in a structured format that can be persisted:

```typescript
interface AgentState {
  sessionId?: string;
  configuration?: ServerConfiguration;
  initializationState: InitializationState;
  customHeaders: Record<string, string>;
  lastActiveTime: number;
}
```

### Hibernation Support

The agent automatically tracks activity and can determine when it should hibernate:

```typescript
// Check if agent should hibernate (after 30 minutes of inactivity)
if (agent.shouldHibernate()) {
  const state = agent.getState();
  // Save state to durable storage
  await agent.cleanup();
}

// Wake up from hibernation
agent.restoreState(savedState);
await agent.wakeUp();
```

### Fast Tool Discovery

The agent registers essential tools immediately and defers PocketBase initialization:

- `health_check` - Always available, 0ms response
- `discover_tools` - Lists all tools and their availability
- `smithery_discovery` - Fast discovery for Smithery scanning
- PocketBase tools - Available after initialization

## Usage Examples

### Basic Usage (Traditional Deployment)

```typescript
import { createAgent } from './src/agent-simple.js';

const agent = createAgent();
await agent.init();

// Connect to stdio transport
const transport = new StdioServerTransport();
await agent.connect(transport);
```

### Cloudflare Worker with Durable Objects

```typescript
import { PocketBaseMCPAgent } from './src/agent-simple.js';

export class MCPDurableObject {
  private agent?: PocketBaseMCPAgent;
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    // Restore agent state if needed
    if (!this.agent) {
      const savedState = await this.state.storage.get('agentState');
      this.agent = new PocketBaseMCPAgent(savedState);
    }

    // Handle MCP requests
    if (request.method === 'POST' && request.url.includes('/mcp')) {
      // Process MCP request through agent
      // Implementation depends on your transport choice
    }

    // Save state periodically
    const agentState = this.agent.getState();
    await this.state.storage.put('agentState', agentState);

    return new Response('OK');
  }
}
```

### Express.js with Session Management

```typescript
import express from 'express';
import { createAgent } from './src/agent-simple.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const app = express();
const agents = new Map<string, PocketBaseMCPAgent>();

app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  
  let agent = agents.get(sessionId);
  if (!agent) {
    agent = createAgent({ sessionId });
    await agent.init();
    agents.set(sessionId, agent);
  }

  // Handle MCP request
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId
  });
  
  await agent.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
```

## Configuration

The agent accepts configuration through environment variables or direct configuration:

```typescript
const config = {
  pocketbaseUrl: 'https://your-pocketbase.com',
  adminEmail: 'admin@example.com',
  adminPassword: 'your-password',
  stripeSecretKey: 'sk_test_...',
  emailService: 'sendgrid'
};

const agent = createAgent();
await agent.init(config);
```

### Environment Variables

- `POCKETBASE_URL` - PocketBase server URL (required)
- `POCKETBASE_ADMIN_EMAIL` - Admin email for authentication
- `POCKETBASE_ADMIN_PASSWORD` - Admin password
- `STRIPE_SECRET_KEY` - Stripe secret key for payment features
- `EMAIL_SERVICE` - Email service provider (sendgrid, smtp)
- `SMTP_HOST` - SMTP server host
- Additional email configuration variables

## Available Tools

### Core Tools (Always Available)

- `health_check` - Server health status
- `discover_tools` - List all available tools
- `smithery_discovery` - Fast discovery for Smithery

### PocketBase Tools (After Initialization)

- `list_collections` - List all collections
- `get_collection` - Get collection details
- `list_records` - List records from a collection
- `get_record` - Get a specific record
- `create_record` - Create a new record

### Service Tools (When Configured)

- `create_stripe_customer` - Create Stripe customer (requires Stripe)
- Additional Stripe and email tools when services are available

## Resources

- `agent://status` - Agent status and configuration information

## Error Handling

The agent includes robust error handling:

1. **Discovery Mode**: If PocketBase can't be reached, the agent continues in discovery mode
2. **Graceful Degradation**: Core tools remain available even if services fail
3. **Lazy Initialization**: Connections are only attempted when needed
4. **Automatic Retry**: Failed initializations can be retried

## Performance Characteristics

- **Fast Startup**: 0ms for tool discovery, no blocking operations
- **Memory Efficient**: Connections only created when needed
- **Hibernation Ready**: Automatic cleanup after inactivity
- **Stateful**: Can maintain state across requests/sessions

## Migration from Original Server

To migrate from the original `PocketBaseServer` class:

1. Replace `new PocketBaseServer()` with `createAgent()`
2. Call `agent.init()` instead of manual initialization
3. Use `agent.connect(transport)` instead of `server.connect(transport)`
4. Add state management if using Cloudflare Durable Objects

## Deployment Considerations

### Cloudflare Workers

- Use Durable Objects for state persistence
- Implement hibernation logic to save costs
- Use HTTP transport for external communication

### Traditional Servers

- Use stdio or SSE transport
- State persistence is optional
- Can run as a long-lived process

### Smithery Deployment

- Agent responds to tool discovery in 0ms
- No blocking initialization during startup
- All required tools are registered immediately

## Troubleshooting

### Common Issues

1. **"PocketBase not initialized"** - Check that `POCKETBASE_URL` is set and accessible
2. **Service tools not available** - Verify that required API keys are configured
3. **Authentication failures** - Check admin credentials and PocketBase accessibility

### Debug Information

Use the `health_check` tool to get detailed status:

```bash
echo '{"method": "tools/call", "params": {"name": "health_check", "arguments": {}}}' | node dist/agent-simple.js
```

Use the `agent://status` resource for detailed configuration:

```bash
echo '{"method": "resources/read", "params": {"uri": "agent://status"}}' | node dist/agent-simple.js
```

## Future Enhancements

Planned improvements for Cloudflare compatibility:

1. **WebSocket Hibernation**: Full WebSocket hibernation support
2. **SQL Integration**: Direct SQL database access in Durable Objects
3. **OAuth Integration**: Cloudflare OAuth provider integration
4. **Edge Caching**: Automatic caching of frequently accessed data
5. **Multi-Region**: State replication across Cloudflare regions

## Example Cloudflare Worker

```typescript
// worker.ts
import { PocketBaseMCPAgent } from './agent-simple.js';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Create agent with environment configuration
    const agent = new PocketBaseMCPAgent({
      configuration: {
        pocketbaseUrl: env.POCKETBASE_URL,
        adminEmail: env.POCKETBASE_ADMIN_EMAIL,
        adminPassword: env.POCKETBASE_ADMIN_PASSWORD,
        stripeSecretKey: env.STRIPE_SECRET_KEY
      }
    });

    // Initialize (lazy, only when needed)
    await agent.init();

    // Handle MCP requests
    if (request.url.includes('/mcp')) {
      // Implement your transport layer here
      return new Response('MCP request handled');
    }

    return new Response('Hello from PocketBase MCP Agent!');
  }
};
```

This new agent architecture provides a solid foundation for deploying PocketBase MCP servers on Cloudflare's edge infrastructure while maintaining full compatibility with traditional deployment methods.
