# Jules MCP Server & Orchestrator Skill

[![MCP](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-purple.svg)](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code)
[![Skills.sh](https://img.shields.io/badge/skills.sh-jules--orchestrator-green.svg)](https://skills.sh)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A production-ready [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server and battle-tested **Lead Architect / Orchestration Skill** connecting any AI client or agent (Claude Code, Google Antigravity, Cursor, Windsurf, Codex, Devin, Kimi Code) to the [Google Jules](https://jules.google.com) asynchronous coding agent.

---

## ⚡ Quickstart: Installing the Orchestrator Skill

The repository is bundled as an omni-channel agent plugin and skill package. You can install and use it directly across all major agent environments:

### 1. Claude Code (`/plugin` Marketplace)
Add this repository as a marketplace and install the orchestrator plugin:
```bash
/plugin marketplace add nur-srijan/jules-mcp
/plugin install jules-orchestrator
```
*(Claude Code will automatically detect the plugin manifest, load the skills from `./skills/`, and configure the MCP server via `.mcp.json`)*.

---

### 2. Universal Agent Skills CLI (`npx skills`)
Install the `jules-orchestrator` skill directly into your current workspace:
```bash
npx skills add nur-srijan/jules-mcp
```
*(Or install globally to use across all projects: `npx skills add -g nur-srijan/jules-mcp`)*.

---

### 3. Google Antigravity & Gemini CLI
Clone or link into your agent skills directory:
```bash
# Workspace level:
git clone https://github.com/nur-srijan/jules-mcp.git .agents/plugins/jules-mcp

# Or user level:
git clone https://github.com/nur-srijan/jules-mcp.git ~/.gemini/config/skills/jules-orchestrator
```
Antigravity automatically discovers the skill definition in `skills/jules-orchestrator/SKILL.md` and plugin manifest in `.antigravity-plugin/plugin.json`.

---

### 4. Other Supported Agent Platforms
* **OpenAI Codex CLI:** Automatically reads `.codex-plugin/plugin.json`.
* **Cursor / Windsurf:** Auto-reads `.cursor-plugin/plugin.json` and `.mcp.json`.
* **Cognition Devin:** Auto-reads `.devin-plugin/plugin.json`.
* **Moonshot Kimi Code:** Auto-reads `.kimi-plugin/plugin.json` with native tool mapping.
* **OpenCode:** Add `"jules-orchestrator@git+https://github.com/nur-srijan/jules-mcp.git"` to `.opencode/`.

---

## 🧠 What is `jules-orchestrator`?

The `jules-orchestrator` skill teaches your AI coding assistant how to act as a **Lead Architect and Orchestrator** when delegating tasks to Google Jules:

* **Contract-First Task Decomposition:** Prevents "kitchen-sink" prompts by locking down shared data types on `main` before delegating.
* **Parallel Non-Interfering Sessions:** Identifies decoupled file domains (e.g. Engine Core vs Benchmark Scenarios vs UI Shell) and runs concurrent Jules sessions without merge conflicts.
* **5-Gate Plan Review & Steering:** Enforces rigorous evaluation of Jules' proposed plans before calling `approve_plan` (guards against fake stubs, inverted coordinates, and missing test steps).
* **Turn Budget Protection:** Uses non-blocking milestoned polling (`wait_for_session`) instead of rapid loops.
* **Verification Before Completion:** Inspects git diffs, executes test suites locally, and verifies PRs in topological order before marking tasks complete.

See the full documentation and reference guides in [`skills/jules-orchestrator/`](./skills/jules-orchestrator/).

---

## 🛠️ MCP Server: Available Tools

When connected via MCP, the server exposes 7 core tools for controlling Jules:

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

## 🚀 Server Setup & Prerequisites

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

If a friend or collaborator wants to run this on their own computer without deploying to the cloud:

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

#### Claude Desktop / Claude Code
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

---

## 📄 License
MIT © [Nur Srijan](https://github.com/nur-srijan)
