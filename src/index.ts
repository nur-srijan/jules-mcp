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
import { JulesClient, Activity } from "./jules-client.js";

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

const WaitForSessionInput = z.object({
    sessionId: z.string().min(1).describe("The numeric session ID to monitor"),
    timeoutSeconds: z
        .number()
        .int()
        .min(5)
        .max(120)
        .optional()
        .describe("Max seconds to wait before returning current status (default: 50, max: 120)"),
    pollIntervalSeconds: z
        .number()
        .int()
        .min(2)
        .max(15)
        .optional()
        .describe("Seconds between polling Jules API (default: 4)"),
    stopOnPlanApproval: z
        .boolean()
        .optional()
        .describe(
            "If true (default), returns immediately when a plan is generated and awaiting approval so the orchestrator can review it."
        ),
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
    {
        name: "wait_for_session",
        description:
            "Wait and monitor an asynchronous Jules session until it completes, generates a plan awaiting approval, or hits a timeout. Ideal for autonomous orchestrators (Task mode, Antigravity, Cowork) to avoid burning reasoning steps on repetitive polling.",
        inputSchema: {
            type: "object" as const,
            properties: {
                sessionId: {
                    type: "string",
                    description: "The numeric session ID to monitor",
                },
                timeoutSeconds: {
                    type: "number",
                    description: "Max seconds to wait before returning current status (default: 50, max: 120)",
                },
                pollIntervalSeconds: {
                    type: "number",
                    description: "Seconds between polling Jules API (default: 4)",
                },
                stopOnPlanApproval: {
                    type: "boolean",
                    description:
                        "If true (default), returns immediately when an execution plan is generated and awaiting approval so you can review and approve it.",
                },
            },
            required: ["sessionId"],
        },
    },
];

function formatActivitySummary(activities: Activity[]): string[] {
    return activities.map((a) => {
        const time = a.createTime ? new Date(a.createTime).toLocaleTimeString() : "";
        const prefix = time ? `[${time}] ` : "";

        if (a.sessionCompleted !== undefined) {
            return `${prefix}✅ Session completed`;
        }
        if (a.planGenerated) {
            const stepsCount = a.planGenerated.plan?.steps?.length || 0;
            return `${prefix}📋 Plan generated (${stepsCount} steps)`;
        }
        if (a.planApproved) {
            return `${prefix}👍 Plan approved`;
        }
        if (a.progressUpdated) {
            let desc = a.progressUpdated.title;
            if (a.progressUpdated.description) {
                const trimmed = a.progressUpdated.description.replace(/\s+/g, " ").slice(0, 150);
                desc += `: ${trimmed}`;
            }
            return `${prefix}⚙️ ${desc}`;
        }
        return `${prefix}Activity (${a.originator})`;
    });
}

async function executeWaitForSession(
    jules: JulesClient,
    sessionId: string,
    timeoutSeconds = 50,
    pollIntervalSeconds = 4,
    stopOnPlanApproval = true
) {
    const startTime = Date.now();
    const deadline = startTime + timeoutSeconds * 1000;

    while (Date.now() < deadline) {
        const [session, activitiesRes] = await Promise.all([
            jules.getSession(sessionId),
            jules.listActivities(sessionId, { pageSize: 30 }).catch(() => ({ activities: [] })),
        ]);

        const activities = activitiesRes.activities || [];
        const completedActivity = activities.find((a) => a.sessionCompleted !== undefined);
        const pr = session.outputs?.find((o) => o.pullRequest)?.pullRequest;

        // 1. Session completed
        if (completedActivity || pr) {
            return {
                status: "COMPLETED",
                isDone: true,
                needsApproval: false,
                sessionId,
                pullRequest: pr || null,
                elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
                summary: pr
                    ? `Jules has completed the session and created PR: ${pr.url} (${pr.title})`
                    : "Jules has completed the session.",
                latestActivities: formatActivitySummary(activities.slice(-5)),
                nextStep: "Review the created PR or verify the changes.",
            };
        }

        // 2. Check if awaiting plan approval
        if (stopOnPlanApproval) {
            const planGenIdx = activities.findIndex((a) => a.planGenerated !== undefined);
            const planAppIdx = activities.findIndex((a) => a.planApproved !== undefined);
            if (planGenIdx !== -1 && (planAppIdx === -1 || planAppIdx < planGenIdx)) {
                const plan = activities[planGenIdx].planGenerated?.plan;
                return {
                    status: "AWAITING_PLAN_APPROVAL",
                    isDone: false,
                    needsApproval: true,
                    sessionId,
                    elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
                    plan: plan || null,
                    summary: "Jules has generated an execution plan and is waiting for your approval.",
                    latestActivities: formatActivitySummary(activities.slice(-5)),
                    nextStep:
                        "Review the plan steps above. If satisfied, call approve_plan(sessionId). If changes are needed, call send_message(sessionId, prompt).",
                };
            }
        }

        // Check if remaining time allows another poll
        const remainingMs = deadline - Date.now();
        if (remainingMs <= pollIntervalSeconds * 1000) {
            break;
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalSeconds * 1000));
    }

    // Timeout elapsed without terminal state
    const [finalSession, finalActivitiesRes] = await Promise.all([
        jules.getSession(sessionId),
        jules.listActivities(sessionId, { pageSize: 30 }).catch(() => ({ activities: [] })),
    ]);
    const finalActivities = finalActivitiesRes.activities || [];
    const pr = finalSession.outputs?.find((o) => o.pullRequest)?.pullRequest;
    const completed = finalActivities.some((a) => a.sessionCompleted !== undefined);

    if (completed || pr) {
        return {
            status: "COMPLETED",
            isDone: true,
            needsApproval: false,
            sessionId,
            pullRequest: pr || null,
            elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
            summary: pr
                ? `Jules has completed the session and created PR: ${pr.url}`
                : "Jules has completed the session.",
            latestActivities: formatActivitySummary(finalActivities.slice(-5)),
            nextStep: "Review the created PR or inspect the activities to verify the changes.",
        };
    }

    return {
        status: "IN_PROGRESS",
        isDone: false,
        needsApproval: false,
        sessionId,
        elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
        summary: `Jules is still working (${Math.round((Date.now() - startTime) / 1000)}s elapsed).`,
        latestActivities: formatActivitySummary(finalActivities.slice(-5)),
        nextStep: "Call wait_for_session again to continue monitoring until completion.",
    };
}

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

                case "wait_for_session": {
                    const input = WaitForSessionInput.parse(args);
                    const result = await executeWaitForSession(
                        jules,
                        input.sessionId,
                        input.timeoutSeconds,
                        input.pollIntervalSeconds,
                        input.stopOnPlanApproval
                    );
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

    // Request logging for troubleshooting connections
    app.use((req, res, next) => {
        const start = Date.now();
        res.on("finish", () => {
            console.log(`[HTTP] ${req.method} ${req.originalUrl || req.url} -> ${res.statusCode} (${Date.now() - start}ms)`);
        });
        next();
    });

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
                token: "/oauth/token (OAuth 2.0 token endpoint)",
                health: "/health",
            },
        });
    });

    // 2. OAuth 2.0 Endpoints for Gemini, ChatGPT & RFC 8414
    interface AuthCodeEntry {
        redirectUri: string;
        expiry: number;
        state?: string;
        clientId?: string;
        scope?: string;
    }
    const authCodes = new Map<string, AuthCodeEntry>();
    const refreshTokens = new Map<string, { clientId?: string; expiry: number; scope?: string }>();

    const oauthMetadataHandler = (req: express.Request, res: express.Response) => {
        const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
        const host = req.headers["x-forwarded-host"] || req.headers.host;
        const baseUrl = `${protocol}://${host}`;

        res.json({
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/oauth/authorize`,
            token_endpoint: `${baseUrl}/oauth/token`,
            token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
            grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
            response_types_supported: ["code", "token"],
            code_challenge_methods_supported: ["S256", "plain"],
        });
    };

    app.get("/.well-known/oauth-authorization-server", oauthMetadataHandler);
    app.get("/.well-known/openid-configuration", oauthMetadataHandler);

    function getClientDisplayName(redirectUri: string, clientId?: string): string {
        const uri = redirectUri.toLowerCase();
        const id = (clientId || "").toLowerCase();
        if (uri.includes("google") || uri.includes("gemini") || uri.includes("vertex") || id.includes("gemini")) {
            return "Google Gemini";
        }
        if (uri.includes("chatgpt") || uri.includes("openai") || id.includes("chatgpt")) {
            return "ChatGPT";
        }
        if (uri.includes("claude") || uri.includes("anthropic")) {
            return "Claude";
        }
        return "AI Client";
    }

    function escapeHtml(str: string): string {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function renderAuthPage(redirectUri: string, state: string | undefined, clientName: string, clientId?: string, error?: string): string {
        return `<!DOCTYPE html>
<html>
<head>
    <title>Authorize ${escapeHtml(clientName)} - Jules MCP</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 2.2rem; max-width: 420px; width: 100%; box-shadow: 0 12px 30px rgba(0,0,0,0.6); text-align: center; }
        .badge { display: inline-block; background: #0284c7; color: #fff; font-size: 0.75rem; font-weight: 700; padding: 0.25rem 0.6rem; border-radius: 9999px; text-transform: uppercase; margin-bottom: 0.8rem; letter-spacing: 0.05em; }
        h2 { margin: 0 0 0.5rem; color: #f8fafc; font-size: 1.5rem; }
        p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; margin: 0 0 1.5rem; }
        input { width: 100%; box-sizing: border-box; padding: 0.85rem 1rem; background: #0f172a; border: 1px solid #475569; border-radius: 8px; color: #fff; margin-bottom: 1rem; font-size: 1rem; outline: none; transition: border-color 0.2s; }
        input:focus { border-color: #38bdf8; }
        button { width: 100%; padding: 0.85rem; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-weight: 600; font-size: 1rem; cursor: pointer; transition: background 0.2s; }
        button:hover { background: #1d4ed8; }
        .error { background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #fca5a5; padding: 0.6rem; border-radius: 8px; font-size: 0.9rem; margin-bottom: 1rem; }
    </style>
</head>
<body>
    <div class="card">
        <div class="badge">Model Context Protocol</div>
        <h2>Connect to ${escapeHtml(clientName)}</h2>
        <p>Authorize <strong>${escapeHtml(clientName)}</strong> to interact with your private <strong>Jules MCP Server</strong>.</p>
        ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
        <form method="POST" action="/oauth/authorize">
            <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
            <input type="hidden" name="state" value="${escapeHtml(state || "")}" />
            <input type="hidden" name="client_id" value="${escapeHtml(clientId || "")}" />
            <input type="password" name="password" placeholder="Enter Client Secret / Password" required autofocus />
            <button type="submit">Authorize ${escapeHtml(clientName)}</button>
        </form>
    </div>
</body>
</html>`;
    }

    // OAuth Authorization Endpoint (used by Gemini and ChatGPT OAuth flows)
    app.get("/oauth/authorize", (req, res) => {
        const { redirect_uri, state, client_id, token, password, scope } = req.query;
        if (!redirect_uri || typeof redirect_uri !== "string") {
            res.status(400).send("Missing redirect_uri parameter.");
            return;
        }

        const { clientSecret } = getExpectedCredentials();
        const clientName = getClientDisplayName(redirect_uri, typeof client_id === "string" ? client_id : undefined);

        // Auto-approve if token/password is already provided in query param or if no secret is set
        const providedSecret = token || password;
        if (!clientSecret || (typeof providedSecret === "string" && providedSecret === clientSecret)) {
            const code = crypto.randomBytes(24).toString("hex");
            authCodes.set(code, {
                redirectUri: redirect_uri,
                expiry: Date.now() + 600000,
                state: typeof state === "string" ? state : undefined,
                clientId: typeof client_id === "string" ? client_id : undefined,
                scope: typeof scope === "string" ? scope : undefined,
            });
            const redirectUrl = new URL(redirect_uri);
            redirectUrl.searchParams.set("code", code);
            if (state && typeof state === "string") redirectUrl.searchParams.set("state", state);
            res.redirect(redirectUrl.toString());
            return;
        }

        res.send(renderAuthPage(redirect_uri, typeof state === "string" ? state : undefined, clientName, typeof client_id === "string" ? client_id : undefined));
    });

    app.post("/oauth/authorize", (req, res) => {
        const redirect_uri = req.body.redirect_uri;
        const state = req.body.state;
        const password = req.body.password;
        const client_id = req.body.client_id;

        if (!redirect_uri || typeof redirect_uri !== "string") {
            res.status(400).send("Missing redirect_uri.");
            return;
        }

        const clientName = getClientDisplayName(redirect_uri, client_id);
        const { clientSecret } = getExpectedCredentials();

        if (clientSecret && password !== clientSecret) {
            res.status(401).send(renderAuthPage(redirect_uri, state || undefined, clientName, client_id, "Incorrect password. Please try again."));
            return;
        }

        const code = crypto.randomBytes(24).toString("hex");
        authCodes.set(code, {
            redirectUri: redirect_uri,
            expiry: Date.now() + 600000,
            state: state || undefined,
            clientId: client_id || undefined,
        });

        const redirectUrl = new URL(redirect_uri);
        redirectUrl.searchParams.set("code", code);
        if (state) redirectUrl.searchParams.set("state", state);
        res.redirect(redirectUrl.toString());
    });

    const tokenHandler = (req: express.Request, res: express.Response) => {
        const { clientId, clientSecret } = getExpectedCredentials();
        const grantType = req.body?.grant_type || "client_credentials";

        // 1. Authorization Code Grant (Gemini, ChatGPT OAuth code exchange)
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
            const refreshToken = crypto.randomBytes(32).toString("hex");
            const expiresInSeconds = 86400 * 30; // 30 days
            issuedTokens.set(accessToken, Date.now() + expiresInSeconds * 1000);
            refreshTokens.set(refreshToken, {
                clientId: codeEntry.clientId,
                expiry: Date.now() + 86400 * 365 * 1000, // 1 year
                scope: codeEntry.scope || "mcp",
            });

            console.log(`[OAuth] Successfully issued access_token and refresh_token for ${codeEntry.clientId || "client"}`);

            // Google Gemini mandates refresh_token to persist connected app
            res.json({
                access_token: accessToken,
                token_type: "Bearer",
                expires_in: expiresInSeconds,
                refresh_token: refreshToken,
                scope: codeEntry.scope || "mcp",
            });
            return;
        }

        // 2. Refresh Token Grant
        if (grantType === "refresh_token") {
            const reqRefreshToken = req.body?.refresh_token;
            const tokenEntry = reqRefreshToken ? refreshTokens.get(reqRefreshToken) : undefined;

            if (!tokenEntry || Date.now() > tokenEntry.expiry) {
                res.status(400).json({
                    error: "invalid_grant",
                    error_description: "Invalid or expired refresh token.",
                });
                return;
            }

            const newAccessToken = crypto.randomBytes(32).toString("hex");
            const newRefreshToken = crypto.randomBytes(32).toString("hex");
            const expiresInSeconds = 86400 * 30;
            issuedTokens.set(newAccessToken, Date.now() + expiresInSeconds * 1000);
            refreshTokens.delete(reqRefreshToken);
            refreshTokens.set(newRefreshToken, {
                clientId: tokenEntry.clientId,
                expiry: Date.now() + 86400 * 365 * 1000,
                scope: tokenEntry.scope,
            });

            console.log(`[OAuth] Refreshed tokens for ${tokenEntry.clientId || "client"}`);

            res.json({
                access_token: newAccessToken,
                token_type: "Bearer",
                expires_in: expiresInSeconds,
                refresh_token: newRefreshToken,
                scope: tokenEntry.scope || "mcp",
            });
            return;
        }

        // 3. Client Credentials Grant
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
        const refreshToken = crypto.randomBytes(32).toString("hex");
        const expiresInSeconds = 86400 * 30; // 30 days
        issuedTokens.set(accessToken, Date.now() + expiresInSeconds * 1000);
        refreshTokens.set(refreshToken, {
            clientId: reqClientId,
            expiry: Date.now() + 86400 * 365 * 1000,
        });

        res.json({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: expiresInSeconds,
            refresh_token: refreshToken,
            scope: "mcp",
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

        // Ensure Accept header satisfies MCP specification (must include application/json AND text/event-stream)
        const currentAccept = req.headers.accept;
        if (!currentAccept || !currentAccept.includes("application/json") || !currentAccept.includes("text/event-stream")) {
            const requiredAccept = "application/json, text/event-stream";
            req.headers.accept = requiredAccept;
            // @hono/node-server (used internally by MCP SDK) parses req.rawHeaders to create Web Standard Request
            if (Array.isArray(req.rawHeaders)) {
                let found = false;
                for (let i = 0; i < req.rawHeaders.length; i += 2) {
                    if (req.rawHeaders[i].toLowerCase() === "accept") {
                        req.rawHeaders[i + 1] = requiredAccept;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    req.rawHeaders.push("accept", requiredAccept);
                }
            }
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
