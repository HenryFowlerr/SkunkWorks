import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Asset, Job, WorkshopSnapshot } from "@/contracts";
import { MAX_PDF_BYTES } from "@/server/ai/pdf-text";
import { MAX_STL_VISUAL_BYTES } from "@/server/ai/stl-visual-evidence";
import {
  assertHighDetailPitchPdfBounds,
  buildPitchCapabilityInput,
  MAX_CAPABILITY_PDF_BYTES,
  MAX_CAPABILITY_PDF_PAGES,
  preparePitchPacket,
} from "@/server/ai/pitch-input";
import { ids, job, sourceAsset, workshopSnapshot } from "../../contracts/fixtures";

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

async function readableDrawingFixture() {
  const bytes = new Uint8Array(await readFile(demo("sensor-mount-alpha.drawing.pdf")));
  const drawing: Asset = {
    ...sourceAsset,
    filename: "sensor-mount-alpha.drawing.pdf",
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const pitchJob: Job = { ...job, sourceAssetIds: [drawing.id] };
  return { bytes, drawing, pitchJob };
}

describe("pitch source preparation", () => {
  it("creates a cited prompt packet from a readable drawing PDF and confirmed supplier without a bend manifest", async () => {
    const { bytes, drawing, pitchJob } = await readableDrawingFixture();
    const packet = await preparePitchPacket({
      job: pitchJob,
      assets: [drawing],
      workshop: workshopSnapshot,
      readSource: async (asset) => {
        expect(asset.id).toBe(drawing.id);
        return bytes;
      },
    });
    const result = buildPitchCapabilityInput(packet);

    expect(packet.partSources.length).toBeGreaterThan(0);
    expect(packet.drawingPdfs).toEqual([
      expect.objectContaining({ assetId: drawing.id, filename: drawing.filename, mimeType: "application/pdf", bytes: expect.any(Uint8Array) }),
    ]);
    expect(packet.drawingPdfs[0].bytes.byteLength).toBe(bytes.byteLength);
    expect(result).toMatchObject({
      partName: pitchJob.title,
      partNumber: pitchJob.partNumber,
      pdfs: [expect.objectContaining({ assetId: drawing.id, filename: drawing.filename, mimeType: "application/pdf", bytes: expect.any(Uint8Array) })],
      supplier: {
        supplierName: workshopSnapshot.name,
        profileVersion: String(workshopSnapshot.version),
        confirmed: true,
        machines: [{ id: ids.machine, name: "Press brake 1", process: "press_brake" }],
        capabilitySourceKeys: [`supplier_capability:${ids.workshopSnapshot}:${ids.machine}`],
      },
    });
    expect(result.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKey: `document:${drawing.id}:1` }),
    ]));
    expect(result.supplier.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceKey: `supplier_profile:${ids.workshopSnapshot}:${ids.machine}`,
        text: expect.stringContaining("Supplier profile confirmation: confirmed."),
      }),
      expect.objectContaining({
        sourceKey: `workshop_note:${ids.workshopSnapshot}:${ids.machine}:${ids.machineNote}`,
        text: "Setup checked",
      }),
    ]));
  });

  it("does not treat an unknown capacity note or listed tool as affirmative machine capability evidence", async () => {
    const { bytes, drawing, pitchJob } = await readableDrawingFixture();
    const incompleteWorkshop: WorkshopSnapshot = structuredClone(workshopSnapshot);
    incompleteWorkshop.machines[0].usableBendLengthMm = {
      value: null,
      evidence: [],
      evidenceState: "not_found",
      originalText: null,
    };
    incompleteWorkshop.machines[0].tools[0].specification = "Tooling unknown";
    incompleteWorkshop.machines[0].notes[0].text = "Machine capacity unknown — confirm tooling before setup.";

    const packet = await preparePitchPacket({
      job: pitchJob,
      assets: [drawing],
      workshop: incompleteWorkshop,
      readSource: async () => bytes,
    });
    const result = buildPitchCapabilityInput(packet);

    expect(result.supplier.capabilitySourceKeys).toEqual([]);
    expect(result.supplier.sources.map((source) => source.sourceKey)).not.toContain(
      `supplier_capability:${ids.workshopSnapshot}:${ids.machine}`,
    );
  });

  it("accepts a confirmed numeric machine-limit note as capability evidence", async () => {
    const { bytes, drawing, pitchJob } = await readableDrawingFixture();
    const notedWorkshop: WorkshopSnapshot = structuredClone(workshopSnapshot);
    notedWorkshop.machines[0].usableBendLengthMm = {
      value: null,
      evidence: [],
      evidenceState: "not_found",
      originalText: null,
    };
    notedWorkshop.machines[0].notes[0].text = "Confirmed travel envelope: X 762 mm, Y 406 mm, Z 508 mm.";

    const packet = await preparePitchPacket({
      job: pitchJob,
      assets: [drawing],
      workshop: notedWorkshop,
      readSource: async () => bytes,
    });
    const result = buildPitchCapabilityInput(packet);

    expect(result.supplier.capabilitySourceKeys).toEqual([
      `workshop_note:${ids.workshopSnapshot}:${ids.machine}:${ids.machineNote}`,
    ]);
  });

  it("rejects native-only input instead of claiming SolidWorks drawing evidence", async () => {
    const native: Asset = {
      ...sourceAsset,
      id: "10000000-0000-4000-8000-000000000001",
      kind: "native_drawing",
      filename: "Engineering test block.SLDDRW",
      mimeType: "application/octet-stream",
    };
    const pitchJob: Job = { ...job, sourceAssetIds: [native.id] };

    await expect(preparePitchPacket({
      job: pitchJob,
      assets: [native],
      workshop: workshopSnapshot,
      readSource: async () => new Uint8Array(),
    })).rejects.toMatchObject({
      code: "UNSUPPORTED_ASSET",
      message: expect.stringMatching(/Native SolidWorks files.*readable drawing PDF export/i),
    });
  });

  it("verifies the stored source hash before parsing a drawing export", async () => {
    const { drawing, pitchJob } = await readableDrawingFixture();

    await expect(preparePitchPacket({
      job: pitchJob,
      assets: [drawing],
      workshop: workshopSnapshot,
      readSource: async () => new Uint8Array([1, 2, 3]),
    })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });

  it("turns a selected hash-checked STL into optional visual-only capability context", async () => {
    const { bytes: drawingBytes, drawing } = await readableDrawingFixture();
    const stlBytes = visualStl();
    const stl: Asset = {
      ...sourceAsset,
      id: "10000000-0000-4000-8000-000000000007",
      kind: "model_stl",
      filename: "engineering-test-block.stl",
      mimeType: "model/stl",
      byteSize: stlBytes.byteLength,
      sha256: createHash("sha256").update(stlBytes).digest("hex"),
    };
    const pitchJob: Job = { ...job, sourceAssetIds: [drawing.id, stl.id] };
    const readSource = async (asset: Asset) => asset.id === drawing.id ? drawingBytes : stlBytes;

    const packet = await preparePitchPacket({
      job: pitchJob,
      assets: [drawing, stl],
      workshop: workshopSnapshot,
      readSource,
    });
    const input = buildPitchCapabilityInput(packet);

    expect(packet.stlVisual).toMatchObject({
      mimeType: "image/png",
      detail: "low",
      imageDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      label: expect.stringMatching(/visual reference.*no declared units/i),
    });
    expect(input.stlVisual).toEqual(packet.stlVisual);
    expect(JSON.stringify(input.sources)).not.toContain(stl.filename);
    expect(JSON.stringify(input.sources)).not.toContain(Buffer.from(stlBytes).toString("base64"));
  });

  it("skips optional STL download and rasterization when a later pitch action does not need visual input", async () => {
    const { bytes: drawingBytes, drawing } = await readableDrawingFixture();
    const stlBytes = visualStl();
    const stl: Asset = {
      ...sourceAsset,
      id: "10000000-0000-4000-8000-000000000009",
      kind: "model_stl",
      filename: "engineering-test-block.stl",
      mimeType: "model/stl",
      byteSize: stlBytes.byteLength,
      sha256: createHash("sha256").update(stlBytes).digest("hex"),
    };
    const pitchJob: Job = { ...job, sourceAssetIds: [drawing.id, stl.id] };
    const reads: string[] = [];

    const packet = await preparePitchPacket({
      job: pitchJob,
      assets: [drawing, stl],
      workshop: workshopSnapshot,
      includeStlVisual: false,
      readSource: async (asset) => {
        reads.push(asset.id);
        if (asset.id === drawing.id) return drawingBytes;
        throw new Error("The later pitch action must not read the STL.");
      },
    });

    expect(packet.stlVisual).toBeNull();
    expect(reads).toEqual([drawing.id]);
  });

  it("does not download an optional STL that exceeds the bounded visual-preview limit", async () => {
    const { bytes: drawingBytes, drawing } = await readableDrawingFixture();
    const oversizedStl: Asset = {
      ...sourceAsset,
      id: "10000000-0000-4000-8000-000000000008",
      kind: "model_stl",
      filename: "oversized-visual-only.stl",
      mimeType: "model/stl",
      byteSize: MAX_STL_VISUAL_BYTES + 1,
      sha256: "f".repeat(64),
    };
    const pitchJob: Job = { ...job, sourceAssetIds: [drawing.id, oversizedStl.id] };
    const readIds: string[] = [];

    const packet = await preparePitchPacket({
      job: pitchJob,
      assets: [drawing, oversizedStl],
      workshop: workshopSnapshot,
      readSource: async (asset) => {
        readIds.push(asset.id);
        if (asset.id === drawing.id) return drawingBytes;
        throw new Error("The oversized optional STL must not be downloaded.");
      },
    });

    expect(packet.stlVisual).toBeNull();
    expect(readIds).toEqual([drawing.id]);
  });

  it("rejects an oversized combined PDF packet before it reads any source", async () => {
    const oversized: Asset = {
      ...sourceAsset,
      byteSize: MAX_PDF_BYTES,
      sha256: "b".repeat(64),
    };
    const pitchJob: Job = { ...job, sourceAssetIds: [oversized.id] };
    const readSource = async () => {
      throw new Error("should not read an oversized packet");
    };

    await expect(preparePitchPacket({
      job: pitchJob,
      assets: [oversized],
      workshop: workshopSnapshot,
      readSource,
    })).rejects.toMatchObject({
      code: "UNSUPPORTED_ASSET",
      message: expect.stringMatching(/50 MB pitch-analysis limit/i),
    });
  });

  it("keeps high-detail capability PDF attachments within small byte and page bounds", () => {
    expect(() => assertHighDetailPitchPdfBounds([
      { bytes: new Uint8Array(MAX_CAPABILITY_PDF_BYTES + 1), pageCount: 1 },
    ])).toThrow(/5 MB high-detail capability-review limit/i);
    expect(() => assertHighDetailPitchPdfBounds([
      { bytes: new Uint8Array(1), pageCount: MAX_CAPABILITY_PDF_PAGES + 1 },
    ])).toThrow(/20-page high-detail capability-review limit/i);
  });
});
