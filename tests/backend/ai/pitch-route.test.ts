import { beforeEach, describe, expect, it, vi } from "vitest";
import { ids, job, sourceAsset, workshopSnapshot } from "../../contracts/fixtures";

const mocks = vi.hoisted(() => ({
  getJobApiContext: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  preparePitchPacket: vi.fn(),
  buildPitchCapabilityInput: vi.fn(),
  createPitchAiAdapter: vi.fn(),
  getGenerationContext: vi.fn(),
  authorizeMemberAsset: vi.fn(),
  assessCapability: vi.fn(),
  createKnowledgeBase: vi.fn(),
  triageIssue: vi.fn(),
  answerDraftQuestion: vi.fn(),
  assertPitchRequestQuotaAvailable: vi.fn(),
  consumePitchRequestQuota: vi.fn(),
  cachePitchCapability: vi.fn(),
  getCachedPitchCapability: vi.fn(),
  getCachedPitchKnowledgeBase: vi.fn(),
  getOrCreatePitchKnowledgeBase: vi.fn(),
}));

vi.mock("@/server/api/context", () => ({
  getJobApiContext: mocks.getJobApiContext,
  parseRouteId: (id: string) => id,
}));
vi.mock("@/server/auth/service-client", () => ({ createSupabaseServiceClient: mocks.createSupabaseServiceClient }));
vi.mock("@/server/ai/pitch-input", () => ({
  buildPitchCapabilityInput: mocks.buildPitchCapabilityInput,
  preparePitchPacket: mocks.preparePitchPacket,
}));
vi.mock("@/server/ai", () => ({ createPitchAiAdapter: mocks.createPitchAiAdapter }));
vi.mock("@/server/ai/pitch-mobile-preview", () => ({
  createPitchMobilePreviewAdapter: () => ({ answerDraftQuestion: mocks.answerDraftQuestion }),
}));
vi.mock("@/server/ai/pitch-guardrails", () => ({
  assertPitchRequestQuotaAvailable: mocks.assertPitchRequestQuotaAvailable,
  consumePitchRequestQuota: mocks.consumePitchRequestQuota,
  cachePitchCapability: mocks.cachePitchCapability,
  getCachedPitchCapability: mocks.getCachedPitchCapability,
  getCachedPitchKnowledgeBase: mocks.getCachedPitchKnowledgeBase,
  getOrCreatePitchKnowledgeBase: mocks.getOrCreatePitchKnowledgeBase,
}));

import { POST } from "@/app/api/jobs/[id]/pitch/route";

const capabilityInput = {
  partName: job.title,
  partNumber: job.partNumber,
  sources: [{ sourceKey: `document:${ids.asset}:1`, label: "Drawing, page 1", text: "Material thickness 2.0 mm." }],
  supplier: {
    supplierName: workshopSnapshot.name,
    profileVersion: "1",
    confirmed: true,
    machines: [{ id: ids.machine, name: "Press brake 1", process: "press_brake", capabilities: [] }],
    sources: [{ sourceKey: `supplier_profile:${ids.workshopSnapshot}:${ids.machine}`, label: "Confirmed supplier profile", text: "Supplier profile confirmation: confirmed." }],
  },
};

const clearCapability = {
  approvalState: "draft",
  decision: "clear_for_engineer_review",
  code: "SETUP_REVIEW_REQUIRED",
  title: "Ready for engineer review",
  explanation: "The supplied evidence contains no direct blocking conflict.",
  checks: [],
  requiredEngineerDecisions: ["Confirm setup before release."],
  sourceKeysRead: [capabilityInput.sources[0].sourceKey],
};

const blockedCapability = {
  ...clearCapability,
  decision: "blocked",
  code: "CAPABILITY_CONFLICT",
  title: "Supplier conflict",
};

const knowledgeBase = {
  approvalState: "draft",
  title: "Part knowledge base",
  partSummary: "Draft only.",
  sourceSummary: "One source was read.",
  operatorSteps: [],
  attentionPoints: [],
  openQuestions: [],
  recommendedPhoneStartStepId: null,
};

const previewAnswer = {
  approvalState: "draft",
  evidenceState: "not_found",
  text: "This draft knowledge base does not establish that point. Keep it for engineer review before work.",
  citations: [],
  suggestedEngineerReview: "Confirm the drilling setup before release.",
};

const triage = {
  approvalState: "draft",
  severity: "hold",
  title: "Review reported hole position",
  summary: "The floor report requires engineer review.",
  affectedOperation: "Hole drilling",
  knownEvidence: ["The drawing contains a recorded thickness."],
  knownEvidenceCitations: [[{ sourceKey: capabilityInput.sources[0].sourceKey, excerpt: "Material thickness 2.0 mm." }]],
  unknowns: ["The fixture has not been recorded."],
  engineerDecisionNeeded: "Confirm the drawing context before work resumes.",
  suggestedReply: "Keep the affected work pending while engineering reviews it.",
  citations: [{ sourceKey: capabilityInput.sources[0].sourceKey, excerpt: "Material thickness 2.0 mm." }],
};

const pitchPacket = {
  job,
  partSources: capabilityInput.sources,
  supplierNoteSources: [],
  workshop: workshopSnapshot,
  machineId: ids.machine,
};

function request(
  body: Record<string, unknown> = {},
  origin = "https://chappe.example",
) {
  return new Request(`https://chappe.example/api/jobs/${ids.job}/pitch`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ expectedJobVersion: job.version, action: "capability", ...body }),
  });
}

const context = { params: Promise.resolve({ id: ids.job }) };
const actor = { id: "f0a7e622-c0e0-4d6e-a9bb-1b86e991d0fd" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertPitchRequestQuotaAvailable.mockImplementation(() => undefined);
  mocks.consumePitchRequestQuota.mockImplementation(() => undefined);
  mocks.getJobApiContext.mockResolvedValue({
    actor,
    repository: {
      getGenerationContext: mocks.getGenerationContext,
      authorizeMemberAsset: mocks.authorizeMemberAsset,
    },
  });
  mocks.getGenerationContext.mockResolvedValue({
    bundle: { job, assets: [sourceAsset], draft: null, releases: [] },
    workshop: workshopSnapshot,
    inputFingerprint: "a".repeat(64),
  });
  mocks.createSupabaseServiceClient.mockReturnValue({ storage: { from: vi.fn() } });
  mocks.preparePitchPacket.mockResolvedValue(pitchPacket);
  mocks.buildPitchCapabilityInput.mockReturnValue(capabilityInput);
  mocks.createPitchAiAdapter.mockReturnValue({
    assessCapability: mocks.assessCapability,
    createKnowledgeBase: mocks.createKnowledgeBase,
    triageIssue: mocks.triageIssue,
  });
  mocks.assessCapability.mockResolvedValue(clearCapability);
  mocks.createKnowledgeBase.mockResolvedValue(knowledgeBase);
  mocks.triageIssue.mockResolvedValue(triage);
  mocks.answerDraftQuestion.mockResolvedValue(previewAnswer);
  mocks.getCachedPitchCapability.mockReturnValue(clearCapability);
  mocks.getCachedPitchKnowledgeBase.mockReturnValue(Promise.resolve(knowledgeBase));
  mocks.getOrCreatePitchKnowledgeBase.mockImplementation(async (_key: unknown, create: () => Promise<unknown>) => create());
});

describe("pitch analysis route", () => {
  it("authorizes a designer, prepares trusted input, and returns a draft capability result", async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: {
      action: "capability",
      capability: { approvalState: "draft", decision: "clear_for_engineer_review" },
    } });
    expect(mocks.getJobApiContext).toHaveBeenCalledWith(ids.job, ["designer"]);
    expect(mocks.getGenerationContext).toHaveBeenCalledWith(ids.job);
    expect(mocks.preparePitchPacket).toHaveBeenCalledWith(expect.objectContaining({
      job,
      assets: [sourceAsset],
      workshop: workshopSnapshot,
      readSource: expect.any(Function),
    }));
    expect(mocks.buildPitchCapabilityInput).toHaveBeenCalledWith(pitchPacket);
    expect(mocks.assessCapability).toHaveBeenCalledWith(capabilityInput);
    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled();
    expect(mocks.consumePitchRequestQuota).toHaveBeenCalledWith({ actorId: actor.id, jobId: ids.job, action: "capability" });
    expect(mocks.cachePitchCapability).toHaveBeenCalledWith({
      actorId: actor.id,
      jobId: ids.job,
      jobVersion: job.version,
      inputFingerprint: "a".repeat(64),
    }, clearCapability);
  });

  it("creates a knowledge-base draft from the server-held capability result with one provider call", async () => {
    const response = await POST(request({ action: "knowledge_base" }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: {
      action: "knowledge_base",
      capability: { approvalState: "draft" },
      knowledgeBase: { approvalState: "draft" },
    } });
    expect(mocks.createKnowledgeBase).toHaveBeenCalledWith({
      ...capabilityInput,
      capability: clearCapability,
    });
    expect(mocks.assessCapability).not.toHaveBeenCalled();
    expect(mocks.consumePitchRequestQuota).toHaveBeenCalledWith({ actorId: actor.id, jobId: ids.job, action: "knowledge_base" });
    expect(mocks.getCachedPitchCapability).toHaveBeenCalledWith({
      actorId: actor.id,
      jobId: ids.job,
      jobVersion: job.version,
      inputFingerprint: "a".repeat(64),
    });
    expect(mocks.getOrCreatePitchKnowledgeBase).toHaveBeenCalledWith(expect.objectContaining({
      actorId: actor.id,
      jobId: ids.job,
    }), expect.any(Function));
  });

  it("returns a blocked capability result without asking the model for a knowledge base", async () => {
    mocks.getCachedPitchCapability.mockReturnValue(blockedCapability);

    const response = await POST(request({ action: "knowledge_base" }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: {
      capability: { decision: "blocked", approvalState: "draft" },
      knowledgeBase: null,
    } });
    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled();
    expect(mocks.assessCapability).not.toHaveBeenCalled();
    expect(mocks.consumePitchRequestQuota).not.toHaveBeenCalled();
  });

  it("requires a fresh server-held capability result before a knowledge-base click", async () => {
    mocks.getCachedPitchCapability.mockReturnValue(null);

    const response = await POST(request({ action: "knowledge_base" }), context);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: {
      code: "REVIEW_REQUIRED",
      message: expect.stringMatching(/capability check again/i),
    } });
    expect(mocks.assessCapability).not.toHaveBeenCalled();
    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled();
    expect(mocks.consumePitchRequestQuota).not.toHaveBeenCalled();
  });

  it("creates a floor triage draft from trusted PDF and confirmed supplier sources without accepting browser knowledge-base content", async () => {
    const response = await POST(request({
      action: "triage",
      issue: { operation: "Hole drilling", text: "The hole position is unclear." },
    }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: {
      action: "triage",
      triage: { approvalState: "draft", severity: "hold" },
    } });
    expect(mocks.triageIssue).toHaveBeenCalledWith({
      partName: capabilityInput.partName,
      partNumber: capabilityInput.partNumber,
      issue: { operation: "Hole drilling", text: "The hole position is unclear." },
      sources: [...capabilityInput.sources, ...capabilityInput.supplier.sources],
      knowledgeBase: null,
    });
    expect(mocks.assessCapability).not.toHaveBeenCalled();
    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled();
    expect(mocks.consumePitchRequestQuota).toHaveBeenCalledWith({ actorId: actor.id, jobId: ids.job, action: "triage" });
  });

  it("answers a designer-only phone preview from the exact server-held draft without reading source files or creating a release", async () => {
    const response = await POST(request({
      action: "preview_question",
      preview: { question: "Which drawing point should I check first?" },
    }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: {
      action: "preview_question",
      answer: { approvalState: "draft", evidenceState: "not_found" },
    } });
    expect(mocks.getCachedPitchKnowledgeBase).toHaveBeenCalledWith({
      actorId: actor.id,
      jobId: ids.job,
      jobVersion: job.version,
      inputFingerprint: "a".repeat(64),
    });
    expect(mocks.answerDraftQuestion).toHaveBeenCalledWith({
      partName: job.title,
      partNumber: job.partNumber,
      question: "Which drawing point should I check first?",
      knowledgeBase,
    });
    expect(mocks.preparePitchPacket).not.toHaveBeenCalled();
    expect(mocks.assessCapability).not.toHaveBeenCalled();
    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled();
    expect(mocks.consumePitchRequestQuota).toHaveBeenCalledWith({ actorId: actor.id, jobId: ids.job, action: "preview_question" });
  });

  it("refuses a phone preview when its exact server-held draft has expired", async () => {
    mocks.getCachedPitchKnowledgeBase.mockReturnValue(null);

    const response = await POST(request({
      action: "preview_question",
      preview: { question: "Which drawing point should I check first?" },
    }), context);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: {
      code: "REVIEW_REQUIRED",
      message: expect.stringMatching(/knowledge-base draft again/i),
    } });
    expect(mocks.answerDraftQuestion).not.toHaveBeenCalled();
    expect(mocks.preparePitchPacket).not.toHaveBeenCalled();
  });

  it("refuses a phone preview when the capability result that authorised its draft has expired", async () => {
    mocks.getCachedPitchCapability.mockReturnValue(null);

    const response = await POST(request({
      action: "preview_question",
      preview: { question: "Which drawing point should I check first?" },
    }), context);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: {
      code: "REVIEW_REQUIRED",
      message: expect.stringMatching(/capability check again/i),
    } });
    expect(mocks.getCachedPitchKnowledgeBase).not.toHaveBeenCalled();
    expect(mocks.answerDraftQuestion).not.toHaveBeenCalled();
  });

  it("rejects stale inputs before reading private source files or calling the model", async () => {
    const response = await POST(request({ expectedJobVersion: job.version + 1 }), context);

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("VERSION_CONFLICT");
    expect(mocks.preparePitchPacket).not.toHaveBeenCalled();
    expect(mocks.assessCapability).not.toHaveBeenCalled();
  });

  it("rejects an exhausted pitch bucket before preparing private source input", async () => {
    const { ApiFault } = await import("@/server/http/api");
    mocks.assertPitchRequestQuotaAvailable.mockImplementation(() => {
      throw new ApiFault("RATE_LIMITED", "Pitch AI requests are temporarily limited.", { retryable: true, retryAfterSeconds: 60 });
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(mocks.preparePitchPacket).not.toHaveBeenCalled();
    expect(mocks.assessCapability).not.toHaveBeenCalled();
  });

  it("checks an asset again under member scope before the source reader returns its bytes", async () => {
    const data = { arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer) };
    const download = vi.fn().mockResolvedValue({ data, error: null });
    const from = vi.fn().mockReturnValue({ download });
    mocks.createSupabaseServiceClient.mockReturnValue({ storage: { from } });
    mocks.authorizeMemberAsset.mockResolvedValue({
      bucketId: "skunkworks-private",
      objectKey: "workspace/source.pdf",
      asset: sourceAsset,
    });
    mocks.preparePitchPacket.mockImplementation(async (input: { readSource: (asset: typeof sourceAsset) => Promise<Uint8Array> }) => {
      await input.readSource(sourceAsset);
      return pitchPacket;
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    expect(mocks.authorizeMemberAsset).toHaveBeenCalledWith(ids.job, sourceAsset.id);
    expect(from).toHaveBeenCalledWith("skunkworks-private");
    expect(download).toHaveBeenCalledWith("workspace/source.pdf", {}, { cache: "no-store" });
    expect(data.arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin writes before membership lookup or source access", async () => {
    const response = await POST(request({}, "https://other.example"), context);

    expect(response.status).toBe(403);
    expect(mocks.getJobApiContext).not.toHaveBeenCalled();
    expect(mocks.preparePitchPacket).not.toHaveBeenCalled();
  });

  it("returns a clear retryable 429 before the adapter when the pitch safety window is full", async () => {
    const { ApiFault } = await import("@/server/http/api");
    mocks.consumePitchRequestQuota.mockImplementation(() => {
      throw new ApiFault("RATE_LIMITED", "Pitch AI requests for this job and action are limited to 2 requests per 10 minutes. Try again in about 8 minutes.", {
        retryable: true,
        retryAfterSeconds: 480,
      });
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("480");
    await expect(response.json()).resolves.toMatchObject({ error: {
      code: "RATE_LIMITED",
      retryable: true,
      message: expect.stringMatching(/try again/i),
    } });
    expect(mocks.assessCapability).not.toHaveBeenCalled();
  });
});
