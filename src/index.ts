#!/usr/bin/env node
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    McpError,
    ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { JulesClient } from "./jules-client.js";

// ─── Jules Client ─────────────────────────────────────────────────────────────

function getJulesClient(): JulesClient {
    const apiKey = process.env.JULES_API_KEY;
    if (!apiKey) {
        throw new Error(
            "JULES_API_KEY environment variable is not set. Please set it in your Railway service settings or environment."
        );
    }
    return new JulesClient(apiKey);
}

// ─── Input Schemas ────────────────────────────────────────────────────────────

const ListSourcesInput = z.object({
    pageSize: z.number().int().positive().optional().describe("Max results per page (default: 20)"),
    pageToken: z.string().optional().describe("Token for the next page of results"),
});

const CreateSessionInput = z.object({
    prompt: z.string().min(1).describe("The task or instruction for Jules to complete"),
    source: z
        .string()
        .min(1)
        .describe(
            'The source name from list_sources, e.g. "sources/github/owner/repo" or "owner/repo"'
        ),
    startingBranch: z
        .string()
        .optional()
        .describe("Branch to start from (default: repo default branch)"),
    title: z.string().optional().describe("Human-readable title for this session"),
    automationMode: z
        .enum(["AUTO_CREATE_PR", "NONE"])
        .optional()
        .describe(
            "AUTO_CREATE_PR: Jules automatically opens a PR when done. NONE (default): no automatic PR."
        ),
    requirePlanApproval: z
        .boolean()
        .optional()
        .describe(
            "If true, Jules will wait for you to call approve_plan before executing. Default: false (auto-approved)."
        ),
});

const GetSessionInput = z.object({
    sessionId: z.string().min(1).describe("The numeric session ID (e.g. 12345 or sessions/12345)"),
});

const ListSessionsInput = z.object({
    pageSize: z.number().int().positive().optional().describe("Max results per page"),
    pageToken: z.string().optional().describe("Token for the next page of results"),
});

const ApprovePlanInput = z.object({
    sessionId: z
        .string()
        .min(1)
        .describe(
            "The session ID whose pending plan should be approved. Only valid when requirePlanApproval was true on session creation."
        ),
});

const SendMessageInput = z.object({
    sessionId: z.string().min(1).describe("The session ID to send the message to"),
    prompt: z
        .string()
        .min(1)
        .describe(
            "The follow-up instruction or message for Jules. The agent will respond in the next activity."
        ),
});

const ListActivitiesInput = z.object({
    sessionId: z.string().min(1).describe("The session ID to list activities for"),
    pageSize: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max activities per page (default: 30)"),
    pageToken: z.string().optional().describe("Token for the next page of results"),
});

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS = [
    {
        name: "list_sources",
        description:
            "List all GitHub repositories connected to Jules. Use this first to find a valid 'source' name before creating a session.",
        inputSchema: {
            type: "object" as const,
            properties: {
                pageSize: { type: "number", description: "Max results per page (default: 20)" },
                pageToken: { type: "string", description: "Token for the next page of results" },
            },
        },
    },
    {
        name: "create_session",
        description:
            "Create a new Jules coding session. Jules will asynchronously work on the prompt and optionally open a pull request. Use list_sources first to get a valid source name.",
        inputSchema: {
            type: "object" as const,
            properties: {
                prompt: {
                    type: "string",
                    description: "The task or instruction for Jules to complete",
                },
                source: {
                    type: "string",
                    description: 'The source name from list_sources, e.g. "sources/github/owner/repo" or "owner/repo"',
                },
                startingBranch: {
                    type: "string",
                    description: "Branch to start from (default: repo default branch)",
                },
                title: { type: "string", description: "Human-readable title for this session" },
                automationMode: {
                    type: "string",
                    enum: ["AUTO_CREATE_PR", "NONE"],
                    description: "AUTO_CREATE_PR: Jules automatically opens a PR when done.",
                },
                requirePlanApproval: {
                    type: "boolean",
                    description:
                        "If true, Jules waits for approve_plan before executing. Default: false.",
                },
            },
            required: ["prompt", "source"],
        },
    },
    {
        name: "get_session",
        description:
            "Get the current status and outputs of a Jules session (e.g., to check if a PR was created or if the task is still in progress).",
        inputSchema: {
            type: "object" as const,
            properties: {
                sessionId: { type: "string", description: "The numeric session ID (or sessions/ID)" },
            },
            required: ["sessionId"],
        },
    },
    {
        name: "list_sessions",
        description: "List all Jules sessions, newest first. Supports pagination.",
        inputSchema: {
            type: "object" as const,
            properties: {
                pageSize: { type: "number", description: "Max results per page" },
                pageToken: { type: "string", description: "Token for the next page of results" },
            },
        },
    },
    {
        name: "approve_plan",
        description:
            "Approve the pending execution plan for a session that was created with requirePlanApproval: true. After calling this, Jules will begin executing the plan.",
        inputSchema: {
            type: "object" as const,
            properties: {
                sessionId: {
                    type: "string",
                    description: "The session ID whose pending plan should be approved",
                },
            },
            required: ["sessionId"],
        },
    },
    {
        name: "send_message",
        description:
            "Send a follow-up instruction or message to Jules in an existing session. Jules is asynchronous — it will respond in the next activity. Use list_activities after to see the response.",
        inputSchema: {
            type: "object" as const,
            properties: {
                sessionId: { type: "string", description: "The session ID" },
                prompt: {
                    type: "string",
                    description: "The follow-up message or instruction for Jules",
                },
            },
            required: ["sessionId", "prompt"],
        },
    },
    {
        name: "list_activities",
        description:
            "List all activities in a Jules session: plan generation, plan approval, progress updates (code changes, bash commands, screenshots), and session completion. Use this to monitor progress or read the agent's response after send_message.",
        inputSchema: {
            type: "object" as const,
            properties: {
                sessionId: { type: "string", description: "The session ID" },
                pageSize: { type: "number", description: "Max activities per page (default: 30)" },
                pageToken: { type: "string", description: "Token for the next page of results" },
            },
            required: ["sessionId"],
        },
    },
];

// ─── MCP Server Factory ───────────────────────────────────────────────────────

function createMcpServer(): Server {
    const server = new Server(
        { name: "jules-mcp", version: "1.0.0" },
        { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        try {
            const jules = getJulesClient();

            switch (name) {
                case "list_sources": {
                    const input = ListSourcesInput.parse(args ?? {});
                    const result = await jules.listSources(input);
                    return {
                        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                    };
                }

                case "create_session": {
                    const input = CreateSessionInput.parse(args);
                    const result = await jules.createSession({
                        prompt: input.prompt,
                        sourceContext: {
                            source: input.source,
                            ...(input.startingBranch && {
                                githubRepoContext: { startingBranch: input.startingBranch },
                            }),
                        },
                        title: input.title,
                        automationMode: input.automationMode,
                        requirePlanApproval: input.requirePlanApproval,
                    });
                    return {
                        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                    };
                }

                case "get_session": {
                    const { sessionId } = GetSessionInput.parse(args);
                    const result = await jules.getSession(sessionId);
                    return {
                        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                    };
                }

                case "list_sessions": {
                    const input = ListSessionsInput.parse(args ?? {});
                    const result = await jules.listSessions(input);
                    return {
                        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                    };
                }

                case "approve_plan": {
                    const { sessionId } = ApprovePlanInput.parse(args);
                    await jules.approvePlan(sessionId);
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: JSON.stringify(
                                    {
                                        success: true,
                                        message: `Plan approved for session ${sessionId}. Jules will now begin executing.`,
                                    },
                                    null,
                                    2
                                ),
                            },
                        ],
                    };
                }

                case "send_message": {
                    const { sessionId, prompt } = SendMessageInput.parse(args);
                    await jules.sendMessage(sessionId, prompt);
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: JSON.stringify(
                                    {
                                        success: true,
                                        message: `Message sent to session ${sessionId}. Jules is asynchronous — use list_activities to see the response.`,
                                    },
                                    null,
                                    2
                                ),
                            },
                        ],
                    };
                }

                case "list_activities": {
                    const { sessionId, ...rest } = ListActivitiesInput.parse(args);
                    const result = await jules.listActivities(sessionId, rest);
                    return {
                        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                    };
                }

                default:
                    return {
                        isError: true,
                        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
                    };
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                isError: true,
                content: [{ type: "text" as const, text: `Tool error: ${message}` }],
            };
        }
    });

    return server;
}

// ─── Authentication & Security ───────────────────────────────────────────────

const issuedTokens = new Map<string, number>();

function cleanExpiredTokens(): void {
    const now = Date.now();
    for (const [token, expiry] of issuedTokens.entries()) {
        if (now > expiry) {
            issuedTokens.delete(token);
        }
    }
}

function getExpectedCredentials() {
    const clientId = process.env.MCP_CLIENT_ID;
    const clientSecret = process.env.MCP_CLIENT_SECRET || process.env.MCP_AUTH_TOKEN;
    return { clientId, clientSecret };
}

function authenticateRequest(req: express.Request): boolean {
    const { clientId, clientSecret } = getExpectedCredentials();

    // If no secret is configured, allow requests (open access mode)
    if (!clientSecret) {
        return true;
    }

    cleanExpiredTokens();

    // 1. Query parameter (?token=... or ?apiKey=... or ?key=...)
    const queryToken = req.query.token || req.query.apiKey || req.query.key;
    if (typeof queryToken === "string" && queryToken === clientSecret) {
        return true;
    }

    // 2. Authorization Header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return false;
    }

    // 2a. Bearer Token
    if (authHeader.startsWith("Bearer ")) {
        const token = authHeader.slice(7).trim();
        if (token === clientSecret) {
            return true;
        }
        const expiry = issuedTokens.get(token);
        if (expiry && Date.now() < expiry) {
            return true;
        }
        return false;
    }

    // 2b. Basic Auth
    if (authHeader.startsWith("Basic ")) {
        try {
            const credentials = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf8");
            const [user, pass] = credentials.split(":");
            if (clientId && user !== clientId) {
                return false;
            }
            return pass === clientSecret;
        } catch {
            return false;
        }
    }

    return false;
}

// ─── Main Execution ───────────────────────────────────────────────────────────

async function main() {
    const isStdio = process.argv.includes("--stdio") || process.env.MCP_TRANSPORT === "stdio";

    if (isStdio) {
        const server = createMcpServer();
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("Jules MCP server running on stdio");
        return;
    }

    const app = express();
    app.use(cors({ origin: true, credentials: true }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // 1. Health check & Info
    app.get("/health", (_req, res) => {
        res.json({
            status: "ok",
            timestamp: new Date().toISOString(),
            service: "jules-mcp",
            version: "1.0.0",
        });
    });

    app.get("/", (_req, res) => {
        const { clientSecret } = getExpectedCredentials();
        res.json({
            name: "jules-mcp",
            version: "1.0.0",
            status: "running",
            description: "MCP server for the Jules asynchronous coding agent",
            authRequired: Boolean(clientSecret),
            endpoints: {
                mcp: "/mcp (Streamable HTTP, used by Gemini Connected Apps)",
                sse: "/sse (Server-Sent Events transport)",
                message: "/message (SSE POST endpoint)",
                token: "/oauth/token (OAuth 2.0 Client Credentials token endpoint)",
                health: "/health",
            },
        });
    });

    // 2. OAuth 2.0 Endpoints for Gemini, ChatGPT & RFC 8414
    const authCodes = new Map<string, { redirectUri: string; expiry: number; state?: string }>();

    const oauthMetadataHandler = (req: express.Request, res: express.Response) => {
        const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
        const host = req.headers["x-forwarded-host"] || req.headers.host;
        const baseUrl = `${protocol}://${host}`;

        res.json({
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/oauth/authorize`,
            token_endpoint: `${baseUrl}/oauth/token`,
            token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
            grant_types_supported: ["authorization_code", "client_credentials"],
            response_types_supported: ["code", "token"],
            code_challenge_methods_supported: ["S256", "plain"],
        });
    };

    app.get("/.well-known/oauth-authorization-server", oauthMetadataHandler);
    app.get("/.well-known/openid-configuration", oauthMetadataHandler);

    // OAuth Authorization Endpoint (used by ChatGPT OAuth flow)
    app.get("/oauth/authorize", (req, res) => {
        const { redirect_uri, state } = req.query;
        if (!redirect_uri || typeof redirect_uri !== "string") {
            res.status(400).send("Missing redirect_uri parameter.");
            return;
        }

        const { clientSecret } = getExpectedCredentials();

        // If no secret configured, immediately redirect back with code
        if (!clientSecret) {
            const code = crypto.randomBytes(24).toString("hex");
            authCodes.set(code, { redirectUri: redirect_uri, expiry: Date.now() + 600000, state: typeof state === "string" ? state : undefined });
            const redirectUrl = new URL(redirect_uri);
            redirectUrl.searchParams.set("code", code);
            if (state && typeof state === "string") redirectUrl.searchParams.set("state", state);
            res.redirect(redirectUrl.toString());
            return;
        }

        res.send(`<!DOCTYPE html>
<html>
<head>
    <title>Authorize ChatGPT - Jules MCP</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 2rem; max-width: 400px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; }
        h2 { margin-top: 0; color: #38bdf8; }
        p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; }
        input { width: 100%; box-sizing: border-box; padding: 0.75rem 1rem; background: #0f172a; border: 1px solid #475569; border-radius: 8px; color: #fff; margin: 1rem 0; font-size: 1rem; }
        button { width: 100%; padding: 0.75rem; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-weight: 600; font-size: 1rem; cursor: pointer; transition: background 0.2s; }
        button:hover { background: #1d4ed8; }
    </style>
</head>
<body>
    <div class="card">
        <h2>Connect to ChatGPT</h2>
        <p>Authorize ChatGPT to connect to your private <strong>Jules MCP Server</strong>.</p>
        <form method="POST" action="/oauth/authorize">
            <input type="hidden" name="redirect_uri" value="${encodeURIComponent(redirect_uri)}" />
            <input type="hidden" name="state" value="${typeof state === 'string' ? encodeURIComponent(state) : ''}" />
            <input type="password" name="password" placeholder="Enter Client Secret / Password" required autofocus />
            <button type="submit">Authorize ChatGPT</button>
        </form>
    </div>
</body>
</html>`);
    });

    app.post("/oauth/authorize", (req, res) => {
        const redirect_uri = req.body.redirect_uri ? decodeURIComponent(req.body.redirect_uri) : null;
        const state = req.body.state ? decodeURIComponent(req.body.state) : null;
        const password = req.body.password;

        if (!redirect_uri) {
            res.status(400).send("Missing redirect_uri.");
            return;
        }

        const { clientSecret } = getExpectedCredentials();
        if (clientSecret && password !== clientSecret) {
            res.status(401).send("Invalid password. Please go back and try again.");
            return;
        }

        const code = crypto.randomBytes(24).toString("hex");
        authCodes.set(code, { redirectUri: redirect_uri, expiry: Date.now() + 600000, state: state || undefined });

        const redirectUrl = new URL(redirect_uri);
        redirectUrl.searchParams.set("code", code);
        if (state) redirectUrl.searchParams.set("state", state);
        res.redirect(redirectUrl.toString());
    });

    const tokenHandler = (req: express.Request, res: express.Response) => {
        const { clientId, clientSecret } = getExpectedCredentials();
        const grantType = req.body?.grant_type || "client_credentials";

        // Handle ChatGPT Authorization Code flow
        if (grantType === "authorization_code") {
            const code = req.body?.code;
            const codeEntry = code ? authCodes.get(code) : undefined;

            if (!codeEntry || Date.now() > codeEntry.expiry) {
                res.status(400).json({
                    error: "invalid_grant",
                    error_description: "Invalid or expired authorization code.",
                });
                return;
            }

            authCodes.delete(code);

            const accessToken = crypto.randomBytes(32).toString("hex");
            const expiresInSeconds = 86400 * 30; // 30 days
            issuedTokens.set(accessToken, Date.now() + expiresInSeconds * 1000);

            res.json({
                access_token: accessToken,
                token_type: "Bearer",
                expires_in: expiresInSeconds,
            });
            return;
        }

        // Handle Client Credentials flow (Gemini, etc.)
        let reqClientId = req.body?.client_id;
        let reqClientSecret = req.body?.client_secret;

        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Basic ")) {
            try {
                const creds = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf8");
                const [u, p] = creds.split(":");
                reqClientId = u;
                reqClientSecret = p;
            } catch {
                // ignore
            }
        }

        if (clientSecret) {
            const matchesId = !clientId || reqClientId === clientId;
            const matchesSecret = reqClientSecret === clientSecret;

            if (!matchesId || !matchesSecret) {
                res.status(401).json({
                    error: "invalid_client",
                    error_description: "Invalid client_id or client_secret.",
                });
                return;
            }
        }

        const accessToken = crypto.randomBytes(32).toString("hex");
        const expiresInSeconds = 86400; // 24 hours
        issuedTokens.set(accessToken, Date.now() + expiresInSeconds * 1000);

        res.json({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: expiresInSeconds,
        });
    };

    app.post("/oauth/token", tokenHandler);
    app.post("/token", tokenHandler);

    // 3. Modern Streamable HTTP Transport (e.g. Gemini Connected Apps)
    const streamableSessions = new Map<string, { transport: StreamableHTTPServerTransport; server: Server }>();

    app.all("/mcp", async (req, res) => {
        if (!authenticateRequest(req)) {
            res.setHeader("WWW-Authenticate", 'Bearer realm="Jules MCP"');
            res.status(401).json({
                error: "unauthorized",
                message: "Authentication required. Provide valid OAuth credentials, Bearer token, or ?token= query parameter.",
            });
            return;
        }

        // Auto-fill Accept header if missing or wildcard to prevent 406 errors from non-standard clients
        const currentAccept = req.headers.accept;
        if (!currentAccept || currentAccept === "*/*" || currentAccept === "application/json") {
            req.headers.accept = "application/json, text/event-stream";
        }

        try {
            const rawSessionId = req.headers["mcp-session-id"];
            const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;

            let session = sessionId ? streamableSessions.get(sessionId) : undefined;

            if (!session) {
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => crypto.randomUUID(),
                });
                const server = createMcpServer();
                await server.connect(transport);
                session = { transport, server };
            }

            await session.transport.handleRequest(req, res, req.body);

            // If transport created a session ID, store it for subsequent requests
            if (session.transport.sessionId && !streamableSessions.has(session.transport.sessionId)) {
                streamableSessions.set(session.transport.sessionId, session);
            }
        } catch (err) {
            console.error("Streamable HTTP error:", err);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32603,
                        message: err instanceof Error ? err.message : "Internal error handling MCP request",
                    },
                    id: null,
                });
            }
        }
    });

    // 4. SSE Transport (Legacy & standard SSE clients)
    const sseTransports = new Map<string, SSEServerTransport>();

    app.get("/sse", async (req, res) => {
        if (!authenticateRequest(req)) {
            res.setHeader("WWW-Authenticate", 'Bearer realm="Jules MCP"');
            res.status(401).json({
                error: "unauthorized",
                message: "Authentication required. Provide valid OAuth credentials, Bearer token, or ?token= query parameter.",
            });
            return;
        }

        const sseServer = createMcpServer();
        const transport = new SSEServerTransport("/message", res);
        sseTransports.set(transport.sessionId, transport);

        transport.onclose = () => {
            sseTransports.delete(transport.sessionId);
        };

        await sseServer.connect(transport);
    });

    app.post("/message", async (req, res) => {
        if (!authenticateRequest(req)) {
            res.setHeader("WWW-Authenticate", 'Bearer realm="Jules MCP"');
            res.status(401).json({
                error: "unauthorized",
                message: "Authentication required.",
            });
            return;
        }

        const sessionId = req.query.sessionId as string;
        const transport = sseTransports.get(sessionId);
        if (!transport) {
            res.status(404).json({ error: "Session not found or expired." });
            return;
        }

        await transport.handlePostMessage(req, res, req.body);
    });

    // Start Express Server
    const port = Number(process.env.PORT) || 3000;
    const host = "0.0.0.0";

    app.listen(port, host, () => {
        const { clientSecret } = getExpectedCredentials();
        console.log(`=================================================`);
        console.log(`🚀 Jules MCP Server running at http://${host}:${port}`);
        console.log(`📡 Streamable HTTP (Gemini): http://${host}:${port}/mcp`);
        console.log(`📡 SSE endpoint:            http://${host}:${port}/sse`);
        console.log(`🔒 Authentication:          ${clientSecret ? "ENABLED ✅" : "DISABLED ⚠️ (Open)"}`);
        console.log(`=================================================`);
    });
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
