import { describe, expect, it } from "vitest";
import { AssetSchema, SOURCE_UPLOAD_LIMIT_BYTES, UploadAssetPreparationBodySchema } from "@/contracts";
import { ids, sourceAsset } from "./fixtures";

describe("STL visual-source upload boundary", () => {
  it.each(["model/stl", "application/sla", "application/octet-stream"])("accepts a bounded .stl visual source with %s", (mimeType) => {
    expect(UploadAssetPreparationBodySchema.safeParse({
      kind: "model_stl",
      filename: "Engineering test block (1).STL",
      mimeType,
      byteSize: SOURCE_UPLOAD_LIMIT_BYTES.model_stl,
    }).success).toBe(true);
  });

  it("rejects a mislabeled, over-limit, or empty STL source", () => {
    const valid = {
      kind: "model_stl" as const,
      filename: "Engineering test block (1).stl",
      mimeType: "model/stl",
      byteSize: 31_284,
    };
    expect(UploadAssetPreparationBodySchema.safeParse({ ...valid, filename: "block.glb" }).success).toBe(false);
    expect(UploadAssetPreparationBodySchema.safeParse({ ...valid, mimeType: "text/plain" }).success).toBe(false);
    expect(UploadAssetPreparationBodySchema.safeParse({ ...valid, byteSize: 0 }).success).toBe(false);
    expect(UploadAssetPreparationBodySchema.safeParse({ ...valid, byteSize: SOURCE_UPLOAD_LIMIT_BYTES.model_stl + 1 }).success).toBe(false);
  });

  it("keeps the STL job-scoped and visual-only in the shared asset contract", () => {
    expect(AssetSchema.safeParse({ ...sourceAsset, id: ids.asset, kind: "model_stl", releaseId: null }).success).toBe(true);
    expect(AssetSchema.safeParse({ ...sourceAsset, id: ids.asset, kind: "model_stl", releaseId: ids.release }).success).toBe(false);
  });
});
