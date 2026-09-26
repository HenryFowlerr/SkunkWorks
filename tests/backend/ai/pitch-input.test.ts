import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Asset, Job } from "@/contracts";
import { MAX_PDF_BYTES } from "@/server/ai/pdf-text";
import { buildPitchCapabilityInput, preparePitchPacket } from "@/server/ai/pitch-input";
import { ids, job, sourceAsset, workshopSnapshot } from "../../contracts/fixtures";

const demo = (name: string) => resolve(process.cwd(), "public", "demo", name);

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
    expect(result).toMatchObject({
      partName: pitchJob.title,
      partNumber: pitchJob.partNumber,
      supplier: {
        supplierName: workshopSnapshot.name,
        profileVersion: String(workshopSnapshot.version),
        confirmed: true,
        machines: [{ id: ids.machine, name: "Press brake 1", process: "press_brake" }],
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
});
