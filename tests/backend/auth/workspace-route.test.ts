import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVerifiedRequestIdentity: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/auth/request-identity", () => ({ getVerifiedRequestIdentity: mocks.getVerifiedRequestIdentity }));
vi.mock("@/server/auth/service-client", () => ({ createSupabaseServiceClient: mocks.createSupabaseServiceClient }));

import { POST } from "@/app/api/workspaces/route";

const actorId = "dd761dbb-b026-4e23-b91e-e041b832c789";
const workspaceId = "8165e055-9c99-4d16-9c49-223f844213ec";
const membershipId = "4b6ee611-805d-4527-86ed-f95676c92547";
const created = {
  workspace: { id: workspaceId, name: "Chappe demo", createdAt: "2026-09-26T00:00:00Z" },
  membership: {
    id: membershipId,
    workspaceId,
    userId: actorId,
    role: "admin",
    createdAt: "2026-09-26T00:00:00Z",
  },
};

function request(name = "Chappe demo") {
  return new Request("https://chappe.example/api/workspaces", {
    method: "POST",
    headers: {
      origin: "https://chappe.example",
      "content-type": "application/json",
      "idempotency-key": "workspace-demo-0001",
    },
    body: JSON.stringify({ name }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVerifiedRequestIdentity.mockResolvedValue({ user: { id: actorId } });
  mocks.createSupabaseServiceClient.mockReturnValue({ rpc: mocks.rpc });
});

describe("workspace creation route", () => {
  it("creates an admin membership atomically after claiming the request", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { state: "claimed", recordId: workspaceId, claimToken: membershipId }, error: null })
      .mockResolvedValueOnce({ data: created, error: null });

    const response = await POST(request());
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ data: created });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "claim_idempotency_internal", expect.objectContaining({
      p_actor_id: actorId,
      p_operation: "workspace.create",
      p_idempotency_key: "workspace-demo-0001",
    }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "create_workspace_internal", expect.objectContaining({
      p_actor_id: actorId,
      p_name: "Chappe demo",
      p_idempotency_record_id: workspaceId,
      p_idempotency_claim_token: membershipId,
    }));
  });

  it("replays a completed request without creating another workspace", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { state: "completed", response: created }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ data: created });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("rejects a cross-origin request before touching the account", async () => {
    const crossOrigin = new Request("https://chappe.example/api/workspaces", {
      method: "POST",
      headers: { origin: "https://other.example", "content-type": "application/json", "idempotency-key": "workspace-demo-0001" },
      body: JSON.stringify({ name: "Chappe demo" }),
    });
    const response = await POST(crossOrigin);
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
