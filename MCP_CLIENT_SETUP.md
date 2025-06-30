# Connecting to Your Deployed PocketBase MCP Server

## 🎉 Your MCP Server is Deployed!

Your PocketBase MCP Server with Durable Objects is now live at:
**`https://pocketbase-mcp.YOUR_ACCOUNT.workers.dev`**

## 🔗 Available Endpoints

- **MCP SSE Endpoint**: `https://pocketbase-mcp.YOUR_ACCOUNT.workers.dev/sse`
- **Health Check**: `https://pocketbase-mcp.YOUR_ACCOUNT.workers.dev/health`
- **Status**: `https://pocketbase-mcp.YOUR_ACCOUNT.workers.dev/status`
- **API Info**: `https://pocketbase-mcp.YOUR_ACCOUNT.workers.dev/`

## 🔧 VS Code MCP Configuration

I've updated your VS Code settings to include two ways to connect to your deployed server:

### Option 1: Using mcp-remote proxy (Recommended)
```json
"pocketbase_mcp_durable": {
    "command": "npx",
    "args": [
        "mcp-remote",
        "https://pocketbase-mcp.YOUR_ACCOUNT.workers.dev/sse"
    ]
}
```

### Option 2: Direct connection (if supported by your MCP client)
```json
"pocketbase_mcp_direct": {
    "url": "https://pocketbase-mcp.YOUR_ACCOUNT.workers.dev/sse"
}
```

## 🧪 Testing Your Server

### 1. Using MCP Inspector
```bash
# Install and run the MCP inspector
npx @modelcontextprotocol/inspector@latest

# Open your browser to http://localhost:5173
# Enter your server URL: https://pocketbase-mcp.YOUR_ACCOUNT.workers.dev/sse
```

### 2. Using cURL for Health Check
```bash
curl https://pocketbase-mcp.YOUR_ACCOUNT.workers.dev/health
```

### 3. Using cURL for MCP Protocol
```bash
curl -X POST https://pocketbase-mcp.YOUR_ACCOUNT.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

## ⚙️ Environment Configuration

Configure these in your Cloudflare dashboard:

### Required Variables
```bash
POCKETBASE_URL=https://your-pocketbase-instance.com
```

### Optional Variables (for admin operations)
```bash
POCKETBASE_ADMIN_EMAIL=admin@example.com
```

### Secrets (use wrangler secret put)
```bash
wrangler secret put POCKETBASE_ADMIN_PASSWORD
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put SENDGRID_API_KEY
```

## 🔄 How It Works

```
MCP Client (VS Code, Claude, etc.)
        ↓
mcp-remote proxy (if using proxy method)
        ↓
Cloudflare Worker (worker-durable.ts)
        ↓
Durable Object (durable-object.ts)
        ↓
MCP Agent (agent-simple.ts)
        ↓
PocketBase API
```

## ✨ Key Features Available

Your deployed server provides these tools:

### Always Available (No PocketBase needed)
- `health_check` - Server health status
- `discover_tools` - Tool discovery for Smithery
- `smithery_discovery` - Fast discovery endpoint

### PocketBase Tools (Require POCKETBASE_URL)
- **Collections**: `list_collections`, `get_collection`, `create_collection`, etc.
- **Records**: `list_records`, `get_record`, `create_record`, `update_record`, etc.
- **Authentication**: `authenticate_user`, `list_admins`, `create_admin`
- **Files**: `list_files`, `upload_file`, `delete_file`
- **Real-time**: `realtime_subscribe`, `realtime_unsubscribe`
- **Utilities**: `validate_record`, `bulk_import`, `query_records`

### Optional Services (Require API keys)
- **Stripe**: `create_customer`, `get_customer`, `create_payment_intent`
- **Email**: `send_email`, `send_template_email`

## 🎯 Next Steps

1. **Replace `YOUR_ACCOUNT`** in the URLs with your actual Cloudflare account subdomain
2. **Configure environment variables** in Cloudflare dashboard
3. **Test the connection** using MCP inspector
4. **Set up PocketBase** if you haven't already
5. **Restart VS Code** to load the new MCP server configuration

## 🚀 Durable Object Benefits

Your server automatically:
- ✅ Persists state across requests
- ✅ Hibernates when inactive (cost optimization)
- ✅ Scales globally on Cloudflare's edge
- ✅ Maintains WebSocket connections
- ✅ Provides fast tool discovery

## 🔍 Troubleshooting

If connection fails:
1. Check if server is responding: `curl https://pocketbase-mcp.YOUR_ACCOUNT.workers.dev/health`
2. Verify environment variables are set in Cloudflare dashboard
3. Check Cloudflare Workers logs for errors
4. Ensure PocketBase instance is accessible if using PocketBase tools

Your MCP server is now ready for production use! 🎉
