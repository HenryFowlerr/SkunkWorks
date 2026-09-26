import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFault } from "../../../src/server/http/api";
import { ids, job, release, releaseContext, sourceAsset, workshopSnapshot } from "../../contracts/fixtures";

const mocks = vi.hoisted(() => ({
  getJobApiContext: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  assembleReleaseQuestionInput: vi.fn(),
  createAiAdapter: vi.fn(),
  getRelease: vi.fn(),
  getJobBundle: vi.fn(),
  getWorkshopSnapshot: vi.fn(),
  listFlags: vi.fn(),
  answerQuestion: vi.fn(),
}));

vi.mock("@/server/api/context", () => ({ getJobApiContext: mocks.getJobApiContext }));
vi.mock("@/server/api/question-context", () => ({ assembleReleaseQuestionInput: mocks.assembleReleaseQuestionInput }));
vi.mock("@/server/auth/service-client", () => ({ createSupabaseServiceClient: mocks.createSupabaseServiceClient }));
vi.mock("@/server/ai", () => ({ createAiAdapter: mocks.createAiAdapter }));

import { POST } from "../../../src/app/api/questions/route";

function request(context = releaseContext, origin = "https://chappe.example") {
  return new Request("https://chappe.example/api/questions", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ context, question: "How is B1 oriented?" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getJobApiContext.mockResolvedValue({ repository: {
    getRelease: mocks.getRelease,
    getJobBundle: mocks.getJobBundle,
    getWorkshopSnapshot: mocks.getWorkshopSnapshot,
    listFlags: mocks.listFlags,
  } });
  mocks.getRelease.mockResolvedValue(release);
  mocks.getJobBundle.mockResolvedValue({ job, assets: [sourceAsset], draft: null, releases: [release] });
  mocks.getWorkshopSnapshot.mockResolvedValue(workshopSnapshot);
  mocks.listFlags.mockResolvedValue([]);
  mocks.createSupabaseServiceClient.mockReturnValue({ storage: {} });
  mocks.assembleReleaseQuestionInput.mockResolvedValue({ context: releaseContext, question: "How is B1 oriented?" });
  mocks.createAiAdapter.mockReturnValue({ answerQuestion: mocks.answerQuestion });
  mocks.answerQuestion.mockResolvedValue({
    id: ids.flag,
    context: releaseContext,
    evidenceState: "not_found",
    text: "The released evidence does not establish this. Ask the engineer to clarify.",
    evidence: [],
    suggestedFlag: "Ask the designer to confirm this point.",
    model: "test-model",
  });
});

describe("questions route", () => {
  it("checks member job scope and exact release before calling the adapter", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { context: releaseContext, evidenceState: "not_found" } });
    expect(mocks.getJobApiContext).toHaveBeenCalledWith(ids.job);
    expect(mocks.getRelease).toHaveBeenCalledWith(ids.release);
    expect(mocks.listFlags).toHaveBeenCalledWith({ releaseId: ids.release });
    expect(mocks.assembleReleaseQuestionInput).toHaveBeenCalledWith(expect.objectContaining({ release }));
    expect(mocks.answerQuestion).toHaveBeenCalledTimes(1);
  });

  it("rejects a release belonging to another job before source access", async () => {
    mocks.getRelease.mockResolvedValue({ ...release, jobId: ids.generation });
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(mocks.getJobBundle).not.toHaveBeenCalled();
    expect(mocks.answerQuestion).not.toHaveBeenCalled();
  });

  it("does not read releases or invoke AI when membership access fails", async () => {
    mocks.getJobApiContext.mockRejectedValue(new ApiFault("NOT_FOUND", "Job not found."));
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(mocks.getRelease).not.toHaveBeenCalled();
    expect(mocks.answerQuestion).not.toHaveBeenCalled();
  });

  it("rejects drafts and foreign origins before private source access", async () => {
    const draftResponse = await POST(request({ ...releaseContext, releaseId: null, draftId: ids.draft, draftVersion: 1 }));
    expect(draftResponse.status).toBe(422);
    const originResponse = await POST(request(releaseContext, "https://other.example"));
    expect(originResponse.status).toBe(403);
    expect(mocks.getJobApiContext).not.toHaveBeenCalled();
    expect(mocks.answerQuestion).not.toHaveBeenCalled();
  });
});
