import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFault } from "../../../src/server/http/api";
import { ids, releaseContext } from "../../contracts/fixtures";

const mocks = vi.hoisted(() => ({
  getJobApiContext: vi.fn(),
  loadQuestionInput: vi.fn(),
  createAiAdapter: vi.fn(),
  answerQuestion: vi.fn(),
  assertFloorRequestQuotaAvailable: vi.fn(),
  consumeFloorRequestQuota: vi.fn(),
}));

vi.mock("@/server/api/context", () => ({ getJobApiContext: mocks.getJobApiContext }));
vi.mock("@/server/api/load-question-input", () => ({ loadQuestionInput: mocks.loadQuestionInput }));
vi.mock("@/server/ai", () => ({ createAiAdapter: mocks.createAiAdapter }));
vi.mock("@/server/ai/floor-guardrails", () => ({
  assertFloorRequestQuotaAvailable: mocks.assertFloorRequestQuotaAvailable,
  consumeFloorRequestQuota: mocks.consumeFloorRequestQuota,
}));

import { POST } from "../../../src/app/api/questions/route";

function request(context = releaseContext, origin = "https://chappe.example") {
  return new Request("https://chappe.example/api/questions", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ context, question: "How is B1 oriented?" }),
  });
}

const actor = { id: "f0a7e622-c0e0-4d6e-a9bb-1b86e991d0fd" };
const aiInput = { context: releaseContext, question: "How is B1 oriented?" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getJobApiContext.mockResolvedValue({ repository: {}, actor });
  mocks.loadQuestionInput.mockResolvedValue(aiInput);
  mocks.createAiAdapter.mockReturnValue({ answerQuestion: mocks.answerQuestion });
  mocks.answerQuestion.mockResolvedValue({
    id: ids.flag,
    context: releaseContext,
    evidenceState: "not_found",
    text: "The released evidence does not establish this. Ask the engineer to clarify.",
    evidence: [],
    suggestedFlag: "Ask the designer to confirm this point.",
    model: "gpt-6-luna",
  });
});

describe("questions route", () => {
  it("authorizes the member, reserves a bounded Luna question call, and returns the grounded answer", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { context: releaseContext, evidenceState: "not_found" } });
    expect(mocks.getJobApiContext).toHaveBeenCalledWith(ids.job);
    expect(mocks.assertFloorRequestQuotaAvailable).toHaveBeenCalledWith({
      actorId: actor.id, jobId: ids.job, action: "question",
    });
    expect(mocks.loadQuestionInput).toHaveBeenCalledWith({}, expect.objectContaining({ context: releaseContext }));
    expect(mocks.consumeFloorRequestQuota).toHaveBeenCalledWith({
      actorId: actor.id, jobId: ids.job, action: "question",
    });
    expect(mocks.answerQuestion).toHaveBeenCalledWith(aiInput);
  });

  it("returns a standard 429 before private evidence load or the Luna adapter when the quota is exhausted", async () => {
    mocks.assertFloorRequestQuotaAvailable.mockImplementation(() => {
      throw new ApiFault("RATE_LIMITED", "Luna requests are temporarily limited.", {
        retryable: true,
        retryAfterSeconds: 60,
      });
    });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    await expect(response.json()).resolves.toMatchObject({ error: { code: "RATE_LIMITED", retryable: true } });
    expect(mocks.loadQuestionInput).not.toHaveBeenCalled();
    expect(mocks.answerQuestion).not.toHaveBeenCalled();
  });

  it("does not check the quota or invoke Luna when membership access fails", async () => {
    mocks.getJobApiContext.mockRejectedValue(new ApiFault("NOT_FOUND", "Job not found."));

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(mocks.assertFloorRequestQuotaAvailable).not.toHaveBeenCalled();
    expect(mocks.answerQuestion).not.toHaveBeenCalled();
  });

  it("rejects drafts and foreign origins before membership or quota checks", async () => {
    const draftResponse = await POST(request({ ...releaseContext, releaseId: null, draftId: ids.draft, draftVersion: 1 }));
    expect(draftResponse.status).toBe(422);
    const originResponse = await POST(request(releaseContext, "https://other.example"));
    expect(originResponse.status).toBe(403);
    expect(mocks.getJobApiContext).not.toHaveBeenCalled();
    expect(mocks.assertFloorRequestQuotaAvailable).not.toHaveBeenCalled();
  });
});
