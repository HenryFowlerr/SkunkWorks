import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getWorkspaceActor: vi.fn(),
  getVerifiedRequestIdentity: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  getSupabasePrivilegedConfig: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/server/auth/authorization", () => ({ getWorkspaceActor: mocks.getWorkspaceActor }));
vi.mock("@/lib/auth/request-identity", () => ({ getVerifiedRequestIdentity: mocks.getVerifiedRequestIdentity }));
vi.mock("@/server/auth/service-client", () => ({
  createSupabaseServiceClient: mocks.createSupabaseServiceClient,
  getSupabasePrivilegedConfig: mocks.getSupabasePrivilegedConfig,
}));

import { POST as issue } from "@/app/api/workspaces/[id]/invites/route";
import { POST as redeem } from "@/app/api/invites/redeem/route";
import { deriveInviteToken, hashInviteToken } from "@/server/auth/invite-token";
import { ApiFault } from "@/server/http/api";

const actorId = "dd761dbb-b026-4e23-b91e-e041b832c789";
const workspaceId = "8165e055-9c99-4d16-9c49-223f844213ec";
const memberId = "4b6ee611-805d-4527-86ed-f95676c92547";
const key = "invite-request-0001";
const token = deriveInviteToken({ secret: "test-secret", actorId, workspaceId, idempotencyKey: key });

function issueRequest(origin = "https://chappe.example", role = "fabricator", email = "floor@example.com") {
  return new Request(`${origin}/api/workspaces/${workspaceId}/invites`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ role, invitedEmail: email }),
  });
}

function redeemRequest(rawToken = token) {
  return new Request("https://chappe.example/api/invites/redeem", {
    method: "POST",
    headers: { origin: "https://chappe.example", "content-type": "application/json", "idempotency-key": "redeem-request-0001" },
    body: JSON.stringify({ token: rawToken }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getWorkspaceActor.mockResolvedValue({ user: { id: actorId } });
  mocks.getVerifiedRequestIdentity.mockResolvedValue({ user: { id: actorId } });
  mocks.getSupabasePrivilegedConfig.mockReturnValue({ serviceRoleKey: "test-secret" });
  mocks.createSupabaseServiceClient.mockReturnValue({ rpc: mocks.rpc });
});

describe("workspace invitation routes", () => {
  it("issues a recipient-bound link while persisting only the digest", async () => {
    mocks.rpc.mockResolvedValue({ data: {
      id: memberId, workspaceId, role: "fabricator", invitedEmail: "floor@example.com",
      createdAt: "2026-09-26T00:00:00Z", expiresAt: "2026-10-03T00:00:00Z",
    }, error: null });

    const response = await issue(issueRequest(), { params: Promise.resolve({ id: workspaceId }) });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.data.inviteUrl).toBe(`https://chappe.example/invite/${token}`);
    expect(mocks.getWorkspaceActor).toHaveBeenCalledWith(workspaceId, ["admin"]);
    expect(mocks.rpc).toHaveBeenCalledWith("issue_workspace_invite_internal", expect.objectContaining({
      p_actor_id: actorId,
      p_workspace_id: workspaceId,
      p_invited_email: "floor@example.com",
      p_token_hash: hashInviteToken(token),
    }));
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(token);
  });

  it("rejects a non-admin before privileged mutation", async () => {
    mocks.getWorkspaceActor.mockRejectedValue(new ApiFault("FORBIDDEN", "Only admins may invite."));
    const response = await issue(issueRequest(), { params: Promise.resolve({ id: workspaceId }) });
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires an origin match and a valid recipient email", async () => {
    const mismatched = new Request(`https://chappe.example/api/workspaces/${workspaceId}/invites`, {
      method: "POST",
      headers: { origin: "https://other.example", "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ role: "fabricator", invitedEmail: "floor@example.com" }),
    });
    expect((await issue(mismatched, { params: Promise.resolve({ id: workspaceId }) })).status).toBe(403);
    expect((await issue(issueRequest("https://chappe.example", "fabricator", "not-an-email"), { params: Promise.resolve({ id: workspaceId }) })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("redeems a token hash for the verified actor and rejects malformed tokens", async () => {
    mocks.rpc.mockResolvedValue({ data: {
      id: memberId, workspaceId, userId: actorId, role: "fabricator", createdAt: "2026-09-26T00:00:00Z",
    }, error: null });
    const response = await redeem(redeemRequest());
    expect(response.status).toBe(201);
    expect((await response.json()).data.workspaceId).toBe(workspaceId);
    expect(mocks.rpc).toHaveBeenCalledWith("redeem_workspace_invite_internal", expect.objectContaining({
      p_actor_id: actorId, p_token_hash: hashInviteToken(token),
    }));
    expect((await redeem(redeemRequest("bad"))).status).toBe(400);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
