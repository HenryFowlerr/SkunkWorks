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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getJobApiContext.mockResolvedValue({ repository: {
    getGenerationContext: mocks.getGenerationContext,
    authorizeMemberAsset: mocks.authorizeMemberAsset,
  } });
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
  });

  it("creates a knowledge-base draft only after a non-blocking capability result", async () => {
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
  });

  it("returns a blocked capability result without asking the model for a knowledge base", async () => {
    mocks.assessCapability.mockResolvedValue(blockedCapability);

    const response = await POST(request({ action: "knowledge_base" }), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: {
      capability: { decision: "blocked", approvalState: "draft" },
      knowledgeBase: null,
    } });
    expect(mocks.createKnowledgeBase).not.toHaveBeenCalled();
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
  });

  it("rejects stale inputs before reading private source files or calling the model", async () => {
    const response = await POST(request({ expectedJobVersion: job.version + 1 }), context);

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("VERSION_CONFLICT");
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
});
