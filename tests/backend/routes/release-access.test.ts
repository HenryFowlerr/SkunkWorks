import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getJobApiContext,
  getVerifiedRequestIdentity,
  parseRouteId,
  createSupabaseServiceClient,
  getSupabasePrivilegedConfig,
  resolveVisitorReleaseScope,
  createVisitorReleaseRepository,
  readVisitorSessionToken,
  exchangeReleaseAccessLink,
  visitorSessionSetCookie,
} = vi.hoisted(() => ({
  getJobApiContext: vi.fn(),
  getVerifiedRequestIdentity: vi.fn(),
  parseRouteId: vi.fn((value: string) => value),
  createSupabaseServiceClient: vi.fn(),
  getSupabasePrivilegedConfig: vi.fn(),
  resolveVisitorReleaseScope: vi.fn(),
  createVisitorReleaseRepository: vi.fn(),
  readVisitorSessionToken: vi.fn().mockReturnValue(null),
  exchangeReleaseAccessLink: vi.fn(),
  visitorSessionSetCookie: vi.fn().mockReturnValue("skw_visitor_session=opaque; HttpOnly; Secure; SameSite=Lax; Path=/"),
}));

vi.mock("@/server/api/context", () => ({ getJobApiContext, parseRouteId }));
vi.mock("@/lib/auth/request-identity", () => ({ getVerifiedRequestIdentity }));
vi.mock("@/server/auth/service-client", () => ({ createSupabaseServiceClient, getSupabasePrivilegedConfig }));
vi.mock("@/server/data/tokens", () => ({ resolveVisitorReleaseScope, exchangeReleaseAccessLink }));
vi.mock("@/server/data/visitor", () => ({ createVisitorReleaseRepository }));
vi.mock("@/server/access/visitor-cookie", () => ({ readVisitorSessionToken, visitorSessionSetCookie }));
vi.mock("@/server/data/errors", () => ({ DataAdapterError: class DataAdapterError extends Error {} }));

import { GET as getRelease } from "@/app/api/releases/[releaseId]/route";
import { POST as followReplacement } from "@/app/api/releases/[releaseId]/follow-replacement/route";
import { POST as createShareLink } from "@/app/api/releases/[releaseId]/share-links/route";
import { DELETE as revokeShareLink } from "@/app/api/releases/[releaseId]/share-links/[linkId]/route";
import { GET as exchangeLink } from "@/app/r/[token]/route";

const releaseId = "10000000-0000-4000-8000-000000000001";
const replacementReleaseId = "10000000-0000-4000-8000-000000000002";
const jobId = "10000000-0000-4000-8000-000000000003";
const workspaceId = "10000000-0000-4000-8000-000000000004";
const sessionId = "10000000-0000-4000-8000-000000000005";

function scopedRequest(path: string, init: RequestInit = {}) {
  return new Request(`https://skunkworks.example${path}`, {
    ...init,
    headers: {
      origin: "https://skunkworks.example",
      ...(init.headers ?? {}),
    },
  });
}

function rlsIdentity(row: Record<string, string>) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const supabase = { from: vi.fn().mockReturnValue({ select }) };
  getVerifiedRequestIdentity.mockResolvedValue({ supabase });
  return { supabase };
}

describe("release access routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSupabaseServiceClient.mockReturnValue({});
    getSupabasePrivilegedConfig.mockReturnValue({});
    readVisitorSessionToken.mockReturnValue(null);
  });

  it("serves a visitor release through the exact live session and grant", async () => {
    const view = { release: { id: releaseId }, permissions: { canAsk: true, canFlag: true, canRespond: false } };
    const repository = { getReleaseView: vi.fn().mockResolvedValue(view) };
    readVisitorSessionToken.mockReturnValue("visitor-session-token");
    resolveVisitorReleaseScope.mockResolvedValue({
      sessionId,
      releaseId,
      accessLinkId: "10000000-0000-4000-8000-000000000006",
      jobId,
      workspaceId,
      displayName: "Operator",
      expiresAt: "2026-09-26T00:00:00.000Z",
    });
    createVisitorReleaseRepository.mockReturnValue(repository);

    const response = await getRelease(scopedRequest(`/api/releases/${releaseId}`), {
      params: Promise.resolve({ releaseId }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: view });
    expect(resolveVisitorReleaseScope).toHaveBeenCalledWith(expect.objectContaining({
      sessionToken: "visitor-session-token",
      releaseId,
    }));
    expect(createVisitorReleaseRepository).toHaveBeenCalledWith(expect.objectContaining({ sessionId, releaseId }));
    expect(repository.getReleaseView).toHaveBeenCalledWith();
    expect(getVerifiedRequestIdentity).not.toHaveBeenCalled();
  });

  it("resolves a member release under RLS before reading the workspace view", async () => {
    const { supabase } = rlsIdentity({ job_id: jobId });
    const view = { release: { id: releaseId }, permissions: { canAsk: true, canFlag: true, canRespond: true } };
    const repository = { getReleaseView: vi.fn().mockResolvedValue(view) };
    getJobApiContext.mockResolvedValue({ repository });

    const response = await getRelease(scopedRequest(`/api/releases/${releaseId}`), {
      params: Promise.resolve({ releaseId }),
    });
    expect(response.status).toBe(200);
    expect(supabase.from).toHaveBeenCalledWith("releases");
    expect(getJobApiContext).toHaveBeenCalledWith(jobId);
    expect(repository.getReleaseView).toHaveBeenCalledWith(releaseId);
  });

  it("extends only the scoped visitor session after an explicit replacement follow", async () => {
    const view = { release: { id: replacementReleaseId }, permissions: { canAsk: true, canFlag: true, canRespond: false } };
    const repository = { followReplacement: vi.fn().mockResolvedValue(view) };
    readVisitorSessionToken.mockReturnValue("visitor-session-token");
    resolveVisitorReleaseScope.mockResolvedValue({ sessionId, releaseId, accessLinkId: "10000000-0000-4000-8000-000000000006", jobId, workspaceId, displayName: "Operator", expiresAt: "2026-09-26T00:00:00.000Z" });
    createVisitorReleaseRepository.mockReturnValue(repository);

    const response = await followReplacement(scopedRequest(`/api/releases/${releaseId}/follow-replacement`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ replacementReleaseId }),
    }), { params: Promise.resolve({ releaseId }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: view });
    expect(repository.followReplacement).toHaveBeenCalledWith({ replacementReleaseId });
    expect(getVerifiedRequestIdentity).not.toHaveBeenCalled();
  });

  it("does not allow replacement follow without an active visitor cookie", async () => {
    const response = await followReplacement(scopedRequest(`/api/releases/${releaseId}/follow-replacement`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ replacementReleaseId }),
    }), { params: Promise.resolve({ releaseId }) });
    expect(response.status).toBe(410);
    expect(resolveVisitorReleaseScope).not.toHaveBeenCalled();
    expect(createVisitorReleaseRepository).not.toHaveBeenCalled();
  });

  it("creates an idempotent share link only for a designer-scoped member", async () => {
    const { supabase } = rlsIdentity({ job_id: jobId });
    const repository = { createShareLink: vi.fn().mockResolvedValue({
      linkId: "10000000-0000-4000-8000-000000000007",
      releaseId,
      token: "skw1_signed-access-link-token",
    }) };
    getJobApiContext.mockResolvedValue({ repository });

    const response = await createShareLink(scopedRequest(`/api/releases/${releaseId}/share-links`, {
      method: "POST",
      headers: { "idempotency-key": "share-link-key-0001" },
    }), { params: Promise.resolve({ releaseId }) });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.accessUrl).toBe("https://skunkworks.example/r/skw1_signed-access-link-token");
    expect(getJobApiContext).toHaveBeenCalledWith(jobId, ["designer"]);
    expect(repository.createShareLink).toHaveBeenCalledWith({ releaseId, idempotencyKey: "share-link-key-0001" });
    expect(supabase.from).toHaveBeenCalledWith("releases");
  });

  it("requires the idempotency header before creating a share link", async () => {
    const response = await createShareLink(scopedRequest(`/api/releases/${releaseId}/share-links`, {
      method: "POST",
    }), { params: Promise.resolve({ releaseId }) });
    expect(response.status).toBe(400);
    expect(getVerifiedRequestIdentity).not.toHaveBeenCalled();
    expect(getJobApiContext).not.toHaveBeenCalled();
  });

  it("revokes only a share link scoped to the authorized release", async () => {
    const { supabase } = rlsIdentity({ job_id: jobId });
    const linkId = "10000000-0000-4000-8000-000000000008";
    const revokedAt = "2026-09-26T00:00:00.000Z";
    const repository = { revokeShareLink: vi.fn().mockResolvedValue({ linkId, revokedAt }) };
    getJobApiContext.mockResolvedValue({ repository });

    const response = await revokeShareLink(scopedRequest(`/api/releases/${releaseId}/share-links/${linkId}`, { method: "DELETE" }), {
      params: Promise.resolve({ releaseId, linkId }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { linkId, revokedAt } });
    expect(getJobApiContext).toHaveBeenCalledWith(jobId, ["designer"]);
    expect(repository.revokeShareLink).toHaveBeenCalledWith({ releaseId, linkId });
    expect(supabase.from).toHaveBeenCalledWith("releases");
  });

  it("exchanges the QR bearer path into an HttpOnly scoped cookie then redirects away from the token", async () => {
    const token = "a".repeat(40);
    exchangeReleaseAccessLink.mockResolvedValue({
      sessionToken: "opaque-session-token",
      scope: { sessionId, releaseId, accessLinkId: "10000000-0000-4000-8000-000000000006", jobId, workspaceId, displayName: "Operator", expiresAt: "2026-09-26T00:00:00.000Z" },
    });
    const request = scopedRequest(`/r/${token}`);

    const response = await exchangeLink(request, { params: Promise.resolve({ token }) });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`https://skunkworks.example/floor/${releaseId}`);
    expect(response.headers.get("location")).not.toContain(token);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(exchangeReleaseAccessLink).toHaveBeenCalledWith(expect.objectContaining({ linkToken: token }));
    expect(visitorSessionSetCookie).toHaveBeenCalledWith(request, "opaque-session-token", "2026-09-26T00:00:00.000Z");
  });

  it("masks revoked visitor access without falling back to workspace membership", async () => {
    readVisitorSessionToken.mockReturnValue("visitor-session-token");
    resolveVisitorReleaseScope.mockRejectedValue(Object.assign(new Error("Release access is unavailable."), {
      name: "DataAdapterError",
      code: "RELEASE_REVOKED",
    }));

    const response = await getRelease(scopedRequest(`/api/releases/${releaseId}`), {
      params: Promise.resolve({ releaseId }),
    });
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "RELEASE_REVOKED" } });
    expect(getVerifiedRequestIdentity).not.toHaveBeenCalled();
  });
});
