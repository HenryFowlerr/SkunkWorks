import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Asset, Job } from "@/contracts";
import { ids, job, sourceAsset, workshopSnapshot } from "../../contracts/fixtures";

const mocks = vi.hoisted(() => ({
  getJobApiContext: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  createPitchAiAdapter: vi.fn(),
  getGenerationContext: vi.fn(),
  authorizeMemberAsset: vi.fn(),
  assessCapability: vi.fn(),
}));

vi.mock("@/server/api/context", () => ({
  getJobApiContext: mocks.getJobApiContext,
  parseRouteId: (id: string) => id,
}));
vi.mock("@/server/auth/service-client", () => ({ createSupabaseServiceClient: mocks.createSupabaseServiceClient }));
vi.mock("@/server/ai", () => ({ createPitchAiAdapter: mocks.createPitchAiAdapter }));

import { POST } from "@/app/api/jobs/[id]/pitch/route";

const demo = (name: string) => resolve(process.cwd(), "public", "demo", name);

function request(expectedJobVersion: number) {
  return new Request(`https://chappe.example/api/jobs/${ids.job}/pitch`, {
    method: "POST",
    headers: { origin: "https://chappe.example", "content-type": "application/json" },
    body: JSON.stringify({ expectedJobVersion, action: "capability" }),
  });
}

const context = { params: Promise.resolve({ id: ids.job }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getJobApiContext.mockResolvedValue({ repository: {
    getGenerationContext: mocks.getGenerationContext,
    authorizeMemberAsset: mocks.authorizeMemberAsset,
  } });
  mocks.createPitchAiAdapter.mockReturnValue({ assessCapability: mocks.assessCapability });
  mocks.assessCapability.mockResolvedValue({
    approvalState: "draft",
    decision: "needs_supplier_input",
    code: "SOURCE_EVIDENCE_MISSING",
    title: "Draft check",
    explanation: "Draft result.",
    checks: [],
    requiredEngineerDecisions: [],
    sourceKeysRead: [],
  });
});

describe("pitch analysis route PDF packet", () => {
  it("runs from a verified readable PDF with no bend manifest and leaves model assets out of semantic evidence", async () => {
    const bytes = new Uint8Array(await readFile(demo("sensor-mount-alpha.drawing.pdf")));
    const drawing: Asset = {
      ...sourceAsset,
      filename: "sensor-mount-alpha.drawing.pdf",
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const retainedModel: Asset = {
      ...sourceAsset,
      id: "10000000-0000-4000-8000-000000000002",
      kind: "model_glb",
      filename: "sensor-mount-alpha.final.glb",
      mimeType: "model/gltf-binary",
      byteSize: 1024,
      sha256: "c".repeat(64),
    };
    const pitchJob: Job = { ...job, sourceAssetIds: [drawing.id, retainedModel.id] };
    const arrayBuffer = vi.fn().mockResolvedValue(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const download = vi.fn().mockResolvedValue({ data: { arrayBuffer }, error: null });
    const from = vi.fn().mockReturnValue({ download });

    mocks.getGenerationContext.mockResolvedValue({
      bundle: { job: pitchJob, assets: [drawing, retainedModel], draft: null, releases: [] },
      workshop: workshopSnapshot,
      inputFingerprint: "a".repeat(64),
    });
    mocks.authorizeMemberAsset.mockResolvedValue({
      bucketId: "skunkworks-private",
      objectKey: "workspace/sensor-mount-alpha.drawing.pdf",
      asset: drawing,
    });
    mocks.createSupabaseServiceClient.mockReturnValue({ storage: { from } });

    const response = await POST(request(pitchJob.version), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: {
      action: "capability",
      capability: { approvalState: "draft" },
    } });
    expect(download).toHaveBeenCalledTimes(1);
    expect(mocks.authorizeMemberAsset).toHaveBeenCalledWith(ids.job, drawing.id);
    expect(mocks.authorizeMemberAsset).not.toHaveBeenCalledWith(ids.job, retainedModel.id);
    expect(mocks.assessCapability).toHaveBeenCalledWith(expect.objectContaining({
      sources: expect.arrayContaining([
        expect.objectContaining({ sourceKey: `document:${drawing.id}:1` }),
      ]),
    }));
    const promptInput = mocks.assessCapability.mock.calls[0][0];
    expect(JSON.stringify(promptInput)).not.toContain(retainedModel.filename);
  });
});
