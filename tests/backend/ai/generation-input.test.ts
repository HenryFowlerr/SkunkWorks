import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Asset } from "../../../src/contracts";
import { prepareGenerationInput } from "../../../src/server/ai/generation-input";
import { ids, job, workshopSnapshot } from "../../contracts/fixtures";

const manifestId = "10000000-0000-4000-8000-000000000001";
const demo = (name: string) => resolve(process.cwd(), "public", "demo", name);

async function fixture() {
  const pdf = new Uint8Array(await readFile(demo("sensor-mount-alpha.drawing.pdf")));
  const manifest = new Uint8Array(await readFile(demo("sensor-mount-alpha.bend.json")));
  const asset = (id: string, kind: Asset["kind"], filename: string, bytes: Uint8Array): Asset => ({
    id, jobId: ids.job, releaseId: null, kind, filename,
    mimeType: kind === "drawing_pdf" ? "application/pdf" : "application/json",
    byteSize: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"),
    version: 1, status: "ready", drawingRevision: "A",
  });
  const assets = [
    asset(ids.asset, "drawing_pdf", "sensor-mount-alpha.drawing.pdf", pdf),
    asset(manifestId, "bend_manifest", "sensor-mount-alpha.bend.json", manifest),
  ];
  const bytes = new Map([[ids.asset, pdf], [manifestId, manifest]]);
  return {
    job: { ...job, sourceAssetIds: assets.map((item) => item.id) },
    assets,
    workshop: workshopSnapshot,
    readSource: async (item: Asset) => bytes.get(item.id)!,
  };
}

describe("generation input preparation", () => {
  it("reads real prepared files and keeps uploaded approval claims untrusted", async () => {
    const result = await prepareGenerationInput(await fixture());
    expect(result.aiInput.pdfs).toHaveLength(1);
    expect(result.aiInput.sources.some((source) => source.kind === "document")).toBe(true);
    expect(result.aiInput.stepTargets).toHaveLength(5);
    expect(result.aiInput.mappedBends.map((bend) => bend.bendId)).toEqual(["B1", "B3", "B4", "B5", "B2"]);
    expect(result.panelModel.reviewed).toBe(false);
  });

  it("rejects bytes that changed after upload verification", async () => {
    const input = await fixture();
    const changed = input.assets.map((asset) => asset.kind === "bend_manifest"
      ? { ...asset, sha256: "0".repeat(64) }
      : asset);
    await expect(prepareGenerationInput({ ...input, assets: changed })).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
    });
  });

  it("reports a verified but unreadable PDF as an asset error", async () => {
    const input = await fixture();
    const invalid = new Uint8Array(new TextEncoder().encode("not a PDF"));
    const assets = input.assets.map((asset) => asset.kind === "drawing_pdf"
      ? { ...asset, byteSize: invalid.byteLength, sha256: createHash("sha256").update(invalid).digest("hex") }
      : asset);
    await expect(prepareGenerationInput({
      ...input,
      assets,
      readSource: async (asset) => asset.kind === "drawing_pdf" ? invalid : input.readSource(asset),
    })).rejects.toMatchObject({ code: "UNSUPPORTED_ASSET" });
  });

  it("requires an authored mapping instead of inferring geometry from a PDF", async () => {
    const input = await fixture();
    const assets = input.assets.filter((asset) => asset.kind === "drawing_pdf");
    await expect(prepareGenerationInput({
      ...input, assets, job: { ...input.job, sourceAssetIds: assets.map((asset) => asset.id) },
    })).rejects.toMatchObject({ code: "MAPPING_REQUIRED" });
  });
});
