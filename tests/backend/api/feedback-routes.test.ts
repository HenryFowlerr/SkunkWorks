import { beforeEach, describe, expect, it, vi } from "vitest";
import { ids, memberActor, openFlag, releaseContext } from "../../contracts/fixtures";
import { ApiFault } from "@/server/http/api";
import { DataAdapterError } from "@/server/data/errors";

const mocks = vi.hoisted(() => ({
  getJobApiContext: vi.fn(), getFlagResponseApiContext: vi.fn(),
  claimIdempotency: vi.fn(), createFlag: vi.fn(), respondToFlag: vi.fn(),
}));
vi.mock("@/server/api/context", async (original) => ({
  ...await original<typeof import("@/server/api/context")>(),
  getJobApiContext: mocks.getJobApiContext,
}));
vi.mock("@/server/api/feedback-context", () => ({ getFlagResponseApiContext: mocks.getFlagResponseApiContext }));
import { POST as createFlag } from "@/app/api/flags/route";
import { POST as respondToFlag } from "@/app/api/flags/[id]/response/route";

const key = "create-flag-test-0001";
const createBody = { context: releaseContext, question: "Which drawing detail applies?", photoAssetIds: [] };
const responseBody = { expectedVersion: 1, text: "Use drawing detail A.", kind: "explanation", replacementReleaseId: null };
const routeContext = { params: Promise.resolve({ id: ids.flag }) };
const claim = { state: "claimed", recordId: ids.review, claimToken: ids.proposal, leaseExpiresAt: "2026-09-26T12:00:00Z" };
function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://chappe.example/api/flags", {
    method: "POST", headers: { origin: "https://chappe.example", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const context = { repository: { ...mocks, workspaceId: ids.workspace }, actor: memberActor };
  mocks.getJobApiContext.mockResolvedValue(context);
  mocks.getFlagResponseApiContext.mockResolvedValue(context);
  mocks.claimIdempotency.mockResolvedValue(claim);
  mocks.createFlag.mockResolvedValue({ ...openFlag, createdBy: memberActor });
  mocks.respondToFlag.mockResolvedValue({ ...openFlag, version: 2, status: "responded", response: {
    text: responseBody.text, authorId: ids.member, at: "2026-09-26T12:00:00Z", kind: "explanation", replacementReleaseId: null,
  } });
});

describe("member flag writes", () => {
  it("accepts the typed client's header-only key and derives author from the session", async () => {
    const result = await createFlag(request(createBody, { "idempotency-key": key }));
    expect(result.status).toBe(201);
    expect(mocks.getJobApiContext).toHaveBeenCalledWith(ids.job);
    expect(mocks.claimIdempotency).toHaveBeenCalledWith(expect.objectContaining({ operation: "flag.create", key }));
    expect(mocks.createFlag).toHaveBeenCalledWith(expect.objectContaining({
      context: releaseContext, displayName: memberActor.displayName,
      idempotencyRecordId: claim.recordId, idempotencyClaimToken: claim.claimToken,
    }));
    expect((await result.json()).data).toMatchObject({ status: "open", response: null });
  });

  it("replays the exact committed result without another report", async () => {
    mocks.claimIdempotency.mockResolvedValue({ state: "completed", response: openFlag, resourceId: ids.flag });
    const result = await createFlag(request(createBody, { "idempotency-key": key }));
    expect(result.status).toBe(201);
    expect((await result.json()).data).toEqual(openFlag);
    expect(mocks.createFlag).not.toHaveBeenCalled();
  });

  it("keeps an in-flight claim retryable and does not create a duplicate", async () => {
    mocks.claimIdempotency.mockResolvedValue({ state: "running", retryAfterSeconds: 20 });
    const result = await createFlag(request(createBody, { "idempotency-key": key }));
    expect(result.status).toBe(409);
    expect((await result.json()).error.retryable).toBe(true);
    expect(mocks.createFlag).not.toHaveBeenCalled();
  });

  it.each([
    ["missing key", createBody, {}],
    ["oversized question", { ...createBody, question: "x".repeat(10001) }, { "idempotency-key": key }],
    ["mismatched key", { ...createBody, idempotencyKey: "different-key-0001" }, { "idempotency-key": key }],
    ["unsupported photo", { ...createBody, photoAssetIds: [ids.asset] }, { "idempotency-key": key }],
    ["draft context", { ...createBody, context: { ...releaseContext, releaseId: null, draftId: ids.draft, draftVersion: 1 } }, { "idempotency-key": key }],
    ["forged author", { ...createBody, createdBy: memberActor }, { "idempotency-key": key }],
  ])("rejects %s before claiming a write", async (_label, body, headers) => {
    const result = await createFlag(request(body, headers as Record<string, string>));
    expect(result.status).toBe(400);
    expect(mocks.claimIdempotency).not.toHaveBeenCalled();
    expect(mocks.createFlag).not.toHaveBeenCalled();
  });

  it("denies cross-origin writes", async () => {
    const result = await createFlag(request(createBody, { "idempotency-key": key, origin: "https://attacker.example" }));
    expect(result.status).toBe(403);
    expect(mocks.getJobApiContext).not.toHaveBeenCalled();
  });

  it("does not claim or write without workspace authorization", async () => {
    mocks.getJobApiContext.mockRejectedValue(new ApiFault("FORBIDDEN", "Membership required."));
    const result = await createFlag(request(createBody, { "idempotency-key": key }));
    expect(result.status).toBe(403);
    expect(mocks.claimIdempotency).not.toHaveBeenCalled();
  });

  it("propagates wrong-operation context and conflicting key failures", async () => {
    mocks.createFlag.mockRejectedValue(new DataAdapterError("VALIDATION_FAILED", "Invalid operation context."));
    expect((await createFlag(request(createBody, { "idempotency-key": key }))).status).toBe(400);
    mocks.claimIdempotency.mockRejectedValue(new DataAdapterError("IDEMPOTENCY_KEY_REUSED", "Different payload."));
    expect((await createFlag(request(createBody, { "idempotency-key": key }))).status).toBe(409);
  });
});

describe("explicit engineer responses", () => {
  it("accepts the typed client's path ID and forwards expectedVersion", async () => {
    const result = await respondToFlag(request(responseBody), routeContext);
    expect(result.status).toBe(200);
    expect(mocks.getFlagResponseApiContext).toHaveBeenCalledWith(ids.flag);
    expect(mocks.respondToFlag).toHaveBeenCalledWith({ ...responseBody, flagId: ids.flag });
    expect((await result.json()).data).toMatchObject({ status: "responded", version: 2, response: { authorId: ids.member } });
  });

  it.each([
    { ...responseBody, flagId: ids.job },
    { ...responseBody, text: "x".repeat(10001) },
    { ...responseBody, expectedVersion: 0 },
    { ...responseBody, kind: "replacement_release" },
    { ...responseBody, replacementReleaseId: ids.release },
    { ...responseBody, authorId: ids.member },
  ])("rejects invalid or forged response fields", async (body) => {
    expect((await respondToFlag(request(body), routeContext)).status).toBe(400);
    expect(mocks.getFlagResponseApiContext).not.toHaveBeenCalled();
  });

  it("does not let a fabricator approve a report", async () => {
    mocks.getFlagResponseApiContext.mockRejectedValue(new ApiFault("FORBIDDEN", "Engineer required."));
    expect((await respondToFlag(request(responseBody), routeContext)).status).toBe(403);
    expect(mocks.respondToFlag).not.toHaveBeenCalled();
  });

  it("reports stale versions without claiming a successful approval", async () => {
    mocks.respondToFlag.mockRejectedValue(new DataAdapterError("VERSION_CONFLICT", "The flag changed."));
    const result = await respondToFlag(request(responseBody), routeContext);
    expect(result.status).toBe(409);
    expect((await result.json()).error.code).toBe("VERSION_CONFLICT");
  });
});
