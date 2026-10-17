const JULES_BASE_URL = "https://jules.googleapis.com/v1alpha";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GithubRepo {
    owner: string;
    repo: string;
}

export interface Source {
    name: string;
    id: string;
    githubRepo?: GithubRepo;
}

export interface ListSourcesResponse {
    sources: Source[];
    nextPageToken?: string;
}

export interface GithubRepoContext {
    startingBranch?: string;
}

export interface SourceContext {
    source: string;
    githubRepoContext?: GithubRepoContext;
}

export type AutomationMode = "AUTO_CREATE_PR" | "NONE";

export interface PullRequest {
    url: string;
    title: string;
    description: string;
}

export interface SessionOutput {
    pullRequest?: PullRequest;
}

export interface Session {
    name: string;
    id: string;
    title?: string;
    prompt: string;
    sourceContext: SourceContext;
    automationMode?: AutomationMode;
    requirePlanApproval?: boolean;
    outputs?: SessionOutput[];
    createTime?: string;
    updateTime?: string;
}

export interface CreateSessionRequest {
    prompt: string;
    sourceContext: SourceContext;
    automationMode?: AutomationMode;
    title?: string;
    requirePlanApproval?: boolean;
}

export interface ListSessionsResponse {
    sessions: Session[];
    nextPageToken?: string;
}

export interface PlanStep {
    id: string;
    title: string;
    index?: number;
}

export interface Plan {
    id: string;
    steps: PlanStep[];
}

export interface PlanGeneratedActivity {
    plan: Plan;
}

export interface PlanApprovedActivity {
    planId: string;
}

export interface ProgressUpdatedActivity {
    title: string;
    description?: string;
}

export interface BashOutput {
    command?: string;
    output?: string;
    exitCode?: number;
}

export interface GitPatch {
    unidiffPatch?: string;
    baseCommitId?: string;
    suggestedCommitMessage?: string;
}

export interface ChangeSet {
    source: string;
    gitPatch?: GitPatch;
}

export interface MediaArtifact {
    data: string;
    mimeType: string;
}

export interface ActivityArtifact {
    bashOutput?: BashOutput;
    changeSet?: ChangeSet;
    media?: MediaArtifact;
}

export interface Activity {
    name: string;
    id: string;
    createTime?: string;
    originator: "agent" | "user";
    planGenerated?: PlanGeneratedActivity;
    planApproved?: PlanApprovedActivity;
    progressUpdated?: ProgressUpdatedActivity;
    sessionCompleted?: Record<string, never>;
    artifacts?: ActivityArtifact[];
}

export interface ListActivitiesResponse {
    activities: Activity[];
    nextPageToken?: string;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export function cleanSessionId(sessionId: string): string {
    return sessionId.trim().replace(/^sessions\//, "");
}

export function cleanSource(source: string): string {
    const s = source.trim();
    if (s.startsWith("sources/")) return s;
    if (s.startsWith("github/")) return `sources/${s}`;
    return `sources/github/${s}`;
}

export class JulesClient {
    private readonly apiKey: string;

    constructor(apiKey: string) {
        if (!apiKey) {
            throw new Error("JULES_API_KEY is required");
        }
        this.apiKey = apiKey;
    }

    private async request<T>(
        path: string,
        options: RequestInit = {}
    ): Promise<T> {
        const url = `${JULES_BASE_URL}${path}`;
        const response = await fetch(url, {
            ...options,
            headers: {
                "X-Goog-Api-Key": this.apiKey,
                "Content-Type": "application/json",
                ...options.headers,
            },
        });

        if (!response.ok) {
            let errorBody = "";
            try {
                errorBody = await response.text();
            } catch {
                // ignore
            }
            let friendlyMessage = `Jules API error ${response.status} ${response.statusText}: ${errorBody}`;
            try {
                const parsed = JSON.parse(errorBody);
                if (parsed.error?.message) {
                    friendlyMessage = `Jules API error (${response.status} ${parsed.error.status || response.statusText}): ${parsed.error.message}`;
                }
            } catch {
                // keep fallback
            }
            throw new Error(friendlyMessage);
        }

        // Some endpoints return empty body (e.g., sendMessage, approvePlan)
        const text = await response.text();
        if (!text.trim()) {
            return {} as T;
        }
        return JSON.parse(text) as T;
    }

    /** List all GitHub sources (repos) connected to Jules. */
    async listSources(params?: {
        pageSize?: number;
        pageToken?: string;
    }): Promise<ListSourcesResponse> {
        const query = new URLSearchParams();
        if (params?.pageSize) query.set("pageSize", String(params.pageSize));
        if (params?.pageToken) query.set("pageToken", params.pageToken);
        const qs = query.toString() ? `?${query}` : "";
        return this.request<ListSourcesResponse>(`/sources${qs}`);
    }

    /** Create a new Jules coding session. */
    async createSession(body: CreateSessionRequest): Promise<Session> {
        const payload: CreateSessionRequest = {
            ...body,
            sourceContext: {
                ...body.sourceContext,
                source: cleanSource(body.sourceContext.source),
            },
        };
        return this.request<Session>("/sessions", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    /** Get a specific session by ID. */
    async getSession(sessionId: string): Promise<Session> {
        return this.request<Session>(`/sessions/${cleanSessionId(sessionId)}`);
    }

    /** List all sessions. */
    async listSessions(params?: {
        pageSize?: number;
        pageToken?: string;
    }): Promise<ListSessionsResponse> {
        const query = new URLSearchParams();
        if (params?.pageSize) query.set("pageSize", String(params.pageSize));
        if (params?.pageToken) query.set("pageToken", params.pageToken);
        const qs = query.toString() ? `?${query}` : "";
        return this.request<ListSessionsResponse>(`/sessions${qs}`);
    }

    /** Approve the pending plan for a session. */
    async approvePlan(sessionId: string): Promise<void> {
        await this.request<Record<string, never>>(
            `/sessions/${cleanSessionId(sessionId)}:approvePlan`,
            { method: "POST" }
        );
    }

    /** Send a follow-up message to the Jules agent in a session. */
    async sendMessage(sessionId: string, prompt: string): Promise<void> {
        await this.request<Record<string, never>>(
            `/sessions/${cleanSessionId(sessionId)}:sendMessage`,
            {
                method: "POST",
                body: JSON.stringify({ prompt }),
            }
        );
    }

    /** List activities (agent steps, messages) in a session. */
    async listActivities(
        sessionId: string,
        params?: { pageSize?: number; pageToken?: string }
    ): Promise<ListActivitiesResponse> {
        const query = new URLSearchParams();
        if (params?.pageSize) query.set("pageSize", String(params.pageSize));
        if (params?.pageToken) query.set("pageToken", params.pageToken);
        const qs = query.toString() ? `?${query}` : "";
        return this.request<ListActivitiesResponse>(
            `/sessions/${cleanSessionId(sessionId)}/activities${qs}`
        );
    }
}
