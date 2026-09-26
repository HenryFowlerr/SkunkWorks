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
  assertPitchRequestQuotaAvailable: vi.fn(),
  consumePitchRequestQuota: vi.fn(),
  cachePitchCapability: vi.fn(),
  getCachedPitchCapability: vi.fn(),
  getCachedPitchKnowledgeBase: vi.fn(),
}));

vi.mock("@/server/api/context", () => ({
  getJobApiContext: mocks.getJobApiContext,
  parseRouteId: (id: string) => id,
}));
vi.mock("@/server/auth/service-client", () => ({ createSupabaseServiceClient: mocks.createSupabaseServiceClient }));
vi.mock("@/server/ai", () => ({ createPitchAiAdapter: mocks.createPitchAiAdapter }));
vi.mock("@/server/ai/pitch-mobile-preview", () => ({ createPitchMobilePreviewAdapter: vi.fn() }));
vi.mock("@/server/ai/pitch-guardrails", () => ({
  assertPitchRequestQuotaAvailable: mocks.assertPitchRequestQuotaAvailable,
  consumePitchRequestQuota: mocks.consumePitchRequestQuota,
  cachePitchCapability: mocks.cachePitchCapability,
  getCachedPitchCapability: mocks.getCachedPitchCapability,
  getCachedPitchKnowledgeBase: mocks.getCachedPitchKnowledgeBase,
  getOrCreatePitchKnowledgeBase: vi.fn(),
}));

import { POST } from "@/app/api/jobs/[id]/pitch/route";

const demo = (name: string) => resolve(process.cwd(), "public", "demo", name);

function visualStl(): Uint8Array {
  const bytes = Buffer.alloc(134);
  bytes.write("pitch visual", 0, "ascii");
  bytes.writeUInt32LE(1, 80);
  let offset = 96;
  for (const [x, y, z] of [[0, 0, 0], [1, 0, 0], [0, 1, 0]]) {
    bytes.writeFloatLE(x, offset);
    bytes.writeFloatLE(y, offset + 4);
    bytes.writeFloatLE(z, offset + 8);
    offset += 12;
  }
  return new Uint8Array(bytes);
}

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
  mocks.getJobApiContext.mockResolvedValue({
    actor: { id: "f0a7e622-c0e0-4d6e-a9bb-1b86e991d0fd" },
    repository: {
      getGenerationContext: mocks.getGenerationContext,
      authorizeMemberAsset: mocks.authorizeMemberAsset,
    },
  });
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
  it("uses a selected verified STL only as a derived visual capability input, never semantic evidence", async () => {
    const bytes = new Uint8Array(await readFile(demo("sensor-mount-alpha.drawing.pdf")));
    const drawing: Asset = {
      ...sourceAsset,
      filename: "sensor-mount-alpha.drawing.pdf",
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const stlBytes = visualStl();
    const retainedModel: Asset = {
      ...sourceAsset,
      id: "10000000-0000-4000-8000-000000000002",
      kind: "model_stl",
      filename: "engineering-test-block.stl",
      mimeType: "model/stl",
      byteSize: stlBytes.byteLength,
      sha256: createHash("sha256").update(stlBytes).digest("hex"),
    };
    const pitchJob: Job = { ...job, sourceAssetIds: [drawing.id, retainedModel.id] };
    const bytesByKey = new Map([
      ["workspace/sensor-mount-alpha.drawing.pdf", bytes],
      ["workspace/engineering-test-block.stl", stlBytes],
    ]);
    const download = vi.fn().mockImplementation(async (objectKey: string) => {
      const source = bytesByKey.get(objectKey);
      if (!source) return { data: null, error: new Error("missing source") };
      return {
        data: { arrayBuffer: vi.fn().mockResolvedValue(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)) },
        error: null,
      };
    });
    const from = vi.fn().mockReturnValue({ download });

    mocks.getGenerationContext.mockResolvedValue({
      bundle: { job: pitchJob, assets: [drawing, retainedModel], draft: null, releases: [] },
      workshop: workshopSnapshot,
      inputFingerprint: "a".repeat(64),
    });
    mocks.authorizeMemberAsset.mockImplementation(async (_jobId: string, assetId: string) => ({
      bucketId: "skunkworks-private",
      objectKey: assetId === drawing.id ? "workspace/sensor-mount-alpha.drawing.pdf" : "workspace/engineering-test-block.stl",
      asset: assetId === drawing.id ? drawing : retainedModel,
    }));
    mocks.createSupabaseServiceClient.mockReturnValue({ storage: { from } });

    const response = await POST(request(pitchJob.version), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: {
      action: "capability",
      capability: { approvalState: "draft" },
    } });
    expect(download).toHaveBeenCalledTimes(2);
    expect(mocks.authorizeMemberAsset).toHaveBeenCalledWith(ids.job, drawing.id);
    expect(mocks.authorizeMemberAsset).toHaveBeenCalledWith(ids.job, retainedModel.id);
    expect(mocks.assessCapability).toHaveBeenCalledWith(expect.objectContaining({
      pdfs: [expect.objectContaining({
        assetId: drawing.id,
        filename: drawing.filename,
        mimeType: "application/pdf",
        bytes: expect.any(Uint8Array),
      })],
      stlVisual: expect.objectContaining({
        mimeType: "image/png",
        detail: "low",
        imageDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
        label: expect.stringMatching(/visual reference.*no declared units/i),
      }),
      sources: expect.arrayContaining([
        expect.objectContaining({ sourceKey: `document:${drawing.id}:1` }),
      ]),
    }));
    const promptInput = mocks.assessCapability.mock.calls[0][0];
    expect(JSON.stringify(promptInput.sources)).not.toContain(retainedModel.filename);
    expect(JSON.stringify(promptInput)).not.toContain(Buffer.from(stlBytes).toString("base64"));
    expect(promptInput.pdfs).toHaveLength(1);
  });
});
