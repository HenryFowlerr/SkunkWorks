// A deliberately isolated, short-lived prepared demo. This function does not
// read or write real Chappe jobs, releases, users, or facility profiles.
// Deploy with JWT verification enabled; callers use the project's public anon JWT.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const projectUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const allowedOrigin = (origin: string | null) =>
  !origin || origin === "https://henryfowlerr.github.io" ||
  /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SessionRow = {
  id: string;
  engineer_token_hash: string;
  guide_status: "draft" | "approved";
  guide_text: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
};
type IssueRow = {
  id: string;
  session_id: string;
  operation_id: string;
  kind: "question" | "flag";
  body: string;
  report_type: "none" | "assist" | "escalation";
  operator_outcome: "resolved" | "blocked" | null;
  report_summary: string | null;
  recommendation: string | null;
  status: "pending" | "answered";
  hold_active: boolean;
  answer: string | null;
  created_at: string;
  answered_at: string | null;
};

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function cors(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin ?? "https://henryfowlerr.github.io",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}
function json(data: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}
async function query<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!projectUrl || !serviceKey) throw new HttpError(503, "Demo database is not configured.");
  const response = await fetch(`${projectUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...init.headers,
    },
  });
  if (!response.ok) {
    console.error("Chappe demo database error", response.status);
    throw new HttpError(503, "The demo database is temporarily unavailable.");
  }
  return await response.json() as T;
}
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
async function loadSession(id: unknown): Promise<SessionRow> {
  if (typeof id !== "string" || !uuid.test(id)) throw new HttpError(400, "Invalid demo session.");
  const rows = await query<SessionRow[]>(`demo_sessions?id=eq.${id}&select=*`);
  const session = rows[0];
  if (!session || Date.parse(session.expires_at) <= Date.now()) {
    throw new HttpError(404, "This demo session has expired. Start a new walkthrough.");
  }
  return session;
}
async function view(session: SessionRow) {
  const issues = await query<IssueRow[]>(
    `demo_issues?session_id=eq.${session.id}&select=id,session_id,operation_id,kind,body,report_type,operator_outcome,report_summary,recommendation,status,hold_active,answer,created_at,answered_at&order=created_at.desc`,
  );
  return {
    session: {
      id: session.id,
      guideStatus: session.guide_status,
      guideText: session.guide_text,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      expiresAt: session.expires_at,
      issues: issues.map((issue) => ({
        id: issue.id,
        operationId: issue.operation_id,
        kind: issue.kind,
        body: issue.body,
        reportType: issue.report_type,
        operatorOutcome: issue.operator_outcome,
        reportSummary: issue.report_summary,
        recommendation: issue.recommendation,
        status: issue.status,
        holdActive: issue.hold_active,
        answer: issue.answer,
        createdAt: issue.created_at,
        answeredAt: issue.answered_at,
      })),
    },
  };
}
async function requireEngineer(session: SessionRow, token: unknown) {
  if (typeof token !== "string" || token.length < 32 ||
      await digest(token) !== session.engineer_token_hash) {
    throw new HttpError(403, "Only the engineer who started this demo can approve or answer.");
  }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (!allowedOrigin(origin)) return json({ error: "Origin is not allowed." }, 403, null);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new HttpError(400, "Expected a JSON object.");
    }
    const action = body.action;
    if (action === "create") {
      const engineerToken = randomToken();
      const created = await query<SessionRow[]>("demo_sessions", {
        method: "POST",
        body: JSON.stringify({ engineer_token_hash: await digest(engineerToken) }),
      });
      return json({ ...await view(created[0]), engineerToken }, 201, origin);
    }
    const session = await loadSession(body.sessionId);
    if (action === "get") return json(await view(session), 200, origin);
    if (action === "approve") {
      await requireEngineer(session, body.engineerToken);
      if (session.guide_status !== "draft") throw new HttpError(409, "This guide was already approved.");
      const guideText = typeof body.guideText === "string" ? body.guideText.trim() : "";
      if (guideText.length < 20 || guideText.length > 1000) {
        throw new HttpError(400, "Approved guide text must be 20–1000 characters.");
      }
      const updated = await query<SessionRow[]>(
        `demo_sessions?id=eq.${session.id}&guide_status=eq.draft`,
        { method: "PATCH", body: JSON.stringify({
          guide_status: "approved", guide_text: guideText, updated_at: new Date().toISOString(),
        }) },
      );
      if (!updated[0]) throw new HttpError(409, "This guide changed. Refresh the demo.");
      return json(await view(updated[0]), 200, origin);
    }
    if (action === "issue") {
      if (session.guide_status !== "approved") throw new HttpError(409, "Engineering must approve the guide first.");
      if (!["B2", "PART"].includes(body.operationId) || !["question", "flag"].includes(body.kind)) {
        throw new HttpError(400, "Choose a released operation or part-level context and a question or flag.");
      }
      const issueText = typeof body.body === "string" ? body.body.trim() : "";
      if (!issueText || issueText.length > 500) throw new HttpError(400, "Use 1–500 characters.");
      const reportType = body.reportType === "assist" || body.reportType === "escalation" ? body.reportType : "none";
      const operatorOutcome = body.operatorOutcome === "resolved" || body.operatorOutcome === "blocked" ? body.operatorOutcome : null;
      const reportSummary = typeof body.reportSummary === "string" ? body.reportSummary.trim() : null;
      const recommendation = typeof body.recommendation === "string" ? body.recommendation.trim() : null;
      if ((reportSummary && reportSummary.length > 500) || (recommendation && recommendation.length > 500)) {
        throw new HttpError(400, "Assistant report fields must be 500 characters or fewer.");
      }
      if (reportType === "assist" && operatorOutcome !== "resolved") {
        throw new HttpError(400, "An assisted report requires an explicit resolved outcome.");
      }
      if (reportType === "escalation" && (body.kind !== "flag" || operatorOutcome !== "blocked")) {
        throw new HttpError(400, "A hard-stop report requires a red flag and blocked outcome.");
      }
      const existing = await query<Array<{ id: string }>>(
        `demo_issues?session_id=eq.${session.id}&select=id`,
      );
      if (existing.length >= 12) throw new HttpError(429, "This walkthrough has reached its issue limit.");
      await query<IssueRow[]>("demo_issues", {
        method: "POST",
        body: JSON.stringify({
          session_id: session.id,
          operation_id: body.operationId,
          kind: body.kind,
          body: issueText,
          report_type: reportType,
          operator_outcome: operatorOutcome,
          report_summary: reportSummary || null,
          recommendation: recommendation || null,
          // A normal question or a resolved assist never creates a hold. A red
          // flag is a hard stop before engineering reads any assistant draft.
          hold_active: body.kind === "flag" || reportType === "escalation",
        }),
      });
      return json(await view(session), 201, origin);
    }
    if (action === "respond") {
      await requireEngineer(session, body.engineerToken);
      if (typeof body.issueId !== "string" || !uuid.test(body.issueId)) {
        throw new HttpError(400, "Invalid issue.");
      }
      const answer = typeof body.answer === "string" ? body.answer.trim() : "";
      if (!answer || answer.length > 1000) throw new HttpError(400, "Use 1–1000 characters.");
      const holdActive = typeof body.holdActive === "boolean" ? body.holdActive : true;
      const updated = await query<IssueRow[]>(
        `demo_issues?id=eq.${body.issueId}&session_id=eq.${session.id}&status=eq.pending`,
        { method: "PATCH", body: JSON.stringify({
          status: "answered", answer, hold_active: holdActive,
          answered_at: new Date().toISOString(),
        }) },
      );
      if (!updated[0]) throw new HttpError(409, "This issue was already answered or is unavailable.");
      return json(await view(session), 200, origin);
    }
    throw new HttpError(400, "Unknown demo action.");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    const message = error instanceof Error ? error.message : "Invalid demo request.";
    return json({ error: message }, status, origin);
  }
});
