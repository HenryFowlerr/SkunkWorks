import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiProviderError } from "../../../src/server/ai/types";

const mocks = vi.hoisted(() => ({
  getJobApiContext: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  prepareGenerationInput: vi.fn(),
  proposalToDraftContent: vi.fn(),
  createAiAdapter: vi.fn(),
  claimIdempotency: vi.fn(),
  getGenerationContext: vi.fn(),
  startGeneration: vi.fn(),
  failGeneration: vi.fn(),
  getGeneration: vi.fn(),
  generateDraft: vi.fn(),
}));

vi.mock("@/server/api/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/api/context")>()),
  getJobApiContext: mocks.getJobApiContext,
}));
vi.mock("@/server/auth/service-client", () => ({ createSupabaseServiceClient: mocks.createSupabaseServiceClient }));
vi.mock("@/server/ai", () => ({ createAiAdapter: mocks.createAiAdapter }));
vi.mock("@/server/ai/generation-input", () => ({
  prepareGenerationInput: mocks.prepareGenerationInput,
  proposalToDraftContent: mocks.proposalToDraftContent,
}));

import { POST } from "../../../src/app/api/jobs/[id]/generate/route";

const jobId = "10000000-0000-4000-8000-000000000001";
const generationId = "10000000-0000-4000-8000-000000000002";
const running = {
  id: generationId, jobId, inputFingerprint: "a".repeat(64), state: "running",
  startedAt: "2026-09-26T00:00:00.000Z", expiresAt: "2026-09-26T00:01:30.000Z",
  draftVersion: null, errorCode: null,
};
const failed = { ...running, state: "failed", errorCode: "MISSING_CREDENTIALS" };
const context = { params: Promise.resolve({ id: jobId }) };

function request(origin = "https://chappe.example") {
  return new Request("https://chappe.example/api/jobs/" + jobId + "/generate", {
    method: "POST",
    headers: { origin, "content-type": "application/json", "idempotency-key": "generation-test-0001" },
    body: JSON.stringify({ expectedJobVersion: 1 }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getJobApiContext.mockResolvedValue({ repository: {
    claimIdempotency: mocks.claimIdempotency,
    getGenerationContext: mocks.getGenerationContext,
    startGeneration: mocks.startGeneration,
    failGeneration: mocks.failGeneration,
    getGeneration: mocks.getGeneration,
  } });
  mocks.createSupabaseServiceClient.mockReturnValue({ storage: {} });
  mocks.createAiAdapter.mockReturnValue({ generateDraft: mocks.generateDraft });
  mocks.getGenerationContext.mockResolvedValue({
    bundle: { job: { id: jobId, version: 1 }, assets: [] }, workshop: {}, inputFingerprint: "a".repeat(64),
  });
  mocks.prepareGenerationInput.mockResolvedValue({ aiInput: {}, panelModel: {}, manifestAssetId: generationId });
  mocks.startGeneration.mockResolvedValue(running);
  mocks.failGeneration.mockResolvedValue(failed);
});

describe("generation route", () => {
  it("persists a missing-provider failure without claiming a generated draft", async () => {
    mocks.claimIdempotency.mockResolvedValue({
      state: "claimed", recordId: generationId, claimToken: generationId,
    });
    mocks.generateDraft.mockRejectedValue(new AiProviderError("MISSING_CREDENTIALS"));
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: failed });
    expect(mocks.getJobApiContext).toHaveBeenCalledWith(jobId, ["designer"]);
    expect(mocks.failGeneration).toHaveBeenCalledWith(generationId, "MISSING_CREDENTIALS");
    expect(mocks.proposalToDraftContent).not.toHaveBeenCalled();
  });

  it("replays a completed key without loading files or calling the model", async () => {
    mocks.claimIdempotency.mockResolvedValue({ state: "completed", response: running, resourceId: generationId });
    mocks.getGeneration.mockResolvedValue({ generation: failed, draft: null });
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: failed });
    expect(mocks.prepareGenerationInput).not.toHaveBeenCalled();
    expect(mocks.generateDraft).not.toHaveBeenCalled();
  });

  it("rejects a foreign origin before authorization or any database write", async () => {
    const response = await POST(request("https://other.example"), context);
    expect(response.status).toBe(403);
    expect(mocks.getJobApiContext).not.toHaveBeenCalled();
  });
});
