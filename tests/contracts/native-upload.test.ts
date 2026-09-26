import { describe, expect, it } from "vitest";
import { SOURCE_UPLOAD_LIMIT_BYTES, UploadAssetPreparationBodySchema } from "@/contracts";

describe("native source upload boundary", () => {
  it.each([['native_part', 'Engineering test block.SLDPRT'], ['native_drawing', 'manufacturing test sheet.SLDDRW']] as const)("accepts bounded opaque %s sources", (kind, filename) => {
    expect(UploadAssetPreparationBodySchema.safeParse({ kind, filename, mimeType: "application/octet-stream", byteSize: 80_000 }).success).toBe(true);
    expect(UploadAssetPreparationBodySchema.safeParse({ kind, filename, mimeType: "application/octet-stream", byteSize: SOURCE_UPLOAD_LIMIT_BYTES[kind] + 1 }).success).toBe(false);
  });

  it.each([
    { filename: "part.pdf", mimeType: "application/octet-stream", byteSize: 1 },
    { filename: "part.SLDPRT", mimeType: "text/html", byteSize: 1 },
    { filename: "part.SLDPRT", mimeType: "application/octet-stream", byteSize: 0 },
  ])("rejects mislabeled, empty or unsafe source metadata %j", (input) => {
    expect(UploadAssetPreparationBodySchema.safeParse({ kind: "native_part", ...input }).success).toBe(false);
  });
});
