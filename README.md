# Jules MCP Server

A production-ready [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that connects any MCP-compatible AI client or chatbot (Google Gemini Connected Apps, Claude Desktop, Cursor, Windsurf, etc.) to the [Jules](https://jules.google.com) asynchronous coding agent.

---

## 🛠️ Available Tools

| Tool | Description |
|---|---|
| `list_sources` | List all GitHub repositories connected to Jules. |
| `create_session` | Create a new asynchronous coding task for Jules. |
| `get_session` | Check status, progress, and pull request outputs of a session. |
| `list_sessions` | List all previous and active Jules sessions (paginated). |
| `approve_plan` | Approve Jules' proposed execution plan before code modifications start. |
| `send_message` | Send follow-up instructions or prompts to Jules in an ongoing session. |
| `list_activities` | View all agent steps, bash outputs, code diffs, and screenshots. |

---

## 🚀 Setup & Prerequisites

### 1. Install Dependencies & Build
```bash
npm install
npm run build
```

### 2. Get a Jules API Key
1. Visit [jules.google.com/settings#api](https://jules.google.com/settings#api).
2. Generate a new API key.
3. Ensure your desired GitHub repositories are connected in the Jules web app so they appear in `list_sources`.

---

## 📡 Deployment & Connection Methods

You can run this MCP server in three different ways depending on your needs:

---

### Option A: Cloud Deployment (Always-On 24/7)

Deploy the server to any cloud host (Railway, Google Cloud Run, Render, VPS):

1. Set your environment variables in your cloud provider:
   * `JULES_API_KEY`: Your Jules API key
   * `MCP_CLIENT_ID`: Your choice of client ID (e.g. `gemini`)
   * `MCP_CLIENT_SECRET`: A secure password/secret to protect your endpoint
2. Connect to Google Gemini Connected Apps:
   * **Settings** (gear icon) ➔ **Connected Apps** ➔ **Connect to an MCP server**
   * **MCP Server URL**: `https://<your-deployed-domain>/mcp`
   * Click **Additional settings**:
     * **Client ID**: Your `MCP_CLIENT_ID`
     * **Client secret**: Your `MCP_CLIENT_SECRET`

---

### Option B: Local + HTTPS Tunnel (Free, Zero Cloud Cost)

If a friend wants to run this on their own computer without deploying to the cloud:

#### Step 1: Set environment variables
Create a `.env` file or export variables in your terminal:
```bash
export JULES_API_KEY="your_jules_api_key"
export MCP_CLIENT_ID="gemini"
export MCP_CLIENT_SECRET="your_custom_password"
export PORT=3000
```

#### Step 2: Start the server locally
```bash
npm start
```
The server will be running at `http://localhost:3000`.

#### Step 3: Start an HTTPS Tunnel
In a second terminal window, run either of the following commands:

* **Using LocalTunnel (built-in, no install required):**
  ```bash
  npm run tunnel
  ```
  *(Returns an HTTPS URL like `https://funny-tiger-12.loca.lt`)*

* **Or using Cloudflare Quick Tunnel (recommended if cloudflared is installed):**
  ```bash
  npm run tunnel:cloudflared
  # or: npx cloudflared tunnel --url http://localhost:3000
  ```
  *(Returns an HTTPS URL like `https://random-subdomain.trycloudflare.com`)*

* **Or using ngrok:**
  ```bash
  ngrok http 3000
  ```

#### Step 4: Paste into Gemini Connected Apps
Add `/mcp` to your tunnel URL (e.g., `https://random-subdomain.trycloudflare.com/mcp`) and enter your configured `MCP_CLIENT_ID` and `MCP_CLIENT_SECRET`.

---

### Option C: Desktop AI Clients (Claude Desktop, Cursor, Antigravity)

For local desktop editors, you can connect directly via `stdio` (zero server required):

#### Claude Desktop
Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "jules": {
      "command": "node",
      "args": ["/absolute/path/to/jules-mcp/dist/index.js", "--stdio"],
      "env": {
        "JULES_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

#### Cursor / Windsurf
Add to `.cursor/mcp.json` or `.windsurf/mcp.json`:
```json
{
  "mcpServers": {
    "jules": {
      "command": "node",
      "args": ["/absolute/path/to/jules-mcp/dist/index.js", "--stdio"],
      "env": {
        "JULES_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

---

## 🔒 Security & Anti-Abuse Measures

Because this server connects to your Jules API quota and can trigger coding sessions, it includes multiple layers of security to prevent unauthorized access:

1. **OAuth 2.0 RFC 8414 / RFC 6749 Support**:
   * Gemini's Connected Apps modal exchanges the Client ID & Client Secret via `/oauth/token` for a temporary Bearer token.
2. **Strict Request Authentication**:
   * Any incoming request to `/mcp`, `/sse`, or `/message` without valid credentials is immediately rejected with `401 Unauthorized`.
3. **Multi-Credential Validation**:
   * Supports OAuth Bearer tokens, HTTP Basic Auth (`clientId:clientSecret`), and `?token=` URL parameters.
4. **Input Normalization**:
   * Automatically sanitizes `sessionId` (removes `sessions/` prefixes) and `source` strings to prevent LLM malformed calls.

---

## ⚙️ Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `JULES_API_KEY` | ✅ | - | Your Jules API key from Google. |
| `PORT` | ❌ | `3000` | Port for the HTTP/SSE server. |
| `MCP_CLIENT_ID` | ❌ | `gemini` | Expected OAuth Client ID. |
| `MCP_CLIENT_SECRET` | ❌ | - | Password/Secret protecting the server. |
| `MCP_TRANSPORT` | ❌ | `http` | Set to `stdio` to force local stdio mode. |

---

## 🧪 Health & Testing Endpoints

* **Health Check**: `GET /health` (Returns `{"status": "ok"}`)
* **Service Info**: `GET /`
* **OAuth Token**: `POST /oauth/token` (Accepts `client_id` and `client_secret`)
* **MCP Streamable HTTP**: `ALL /mcp`
* **SSE Stream**: `GET /sse`
