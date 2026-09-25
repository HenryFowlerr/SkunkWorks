import { describe, expect, it } from "vitest";
import { extractPdfEvidence, MAX_PDF_BYTES, MAX_PDF_PAGES, PdfTextError } from "../../../src/server/ai/pdf-text";

function makePdf(pageTexts: string[]): Uint8Array {
  const pageObjectIds = pageTexts.map((_, index) => index + 3);
  const fontObjectId = pageTexts.length + 3;
  const contentObjectIds = pageTexts.map((_, index) => fontObjectId + index + 1);
  const objects = new Map<number, string>();

  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(2, `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageTexts.length} >>`);
  pageTexts.forEach((_, index) => {
    objects.set(pageObjectIds[index], [
      "<< /Type /Page",
      "/Parent 2 0 R",
      "/MediaBox [0 0 300 300]",
      `/Resources << /Font << /F1 ${fontObjectId} 0 R >> >>`,
      `/Contents ${contentObjectIds[index]} 0 R >>`,
    ].join(" "));
  });
  objects.set(fontObjectId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pageTexts.forEach((pageText, index) => {
    const escaped = pageText.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
    const stream = `BT /F1 12 Tf 20 200 Td (${escaped}) Tj ET\n`;
    objects.set(contentObjectIds[index], `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`);
  });

  const lastObjectId = Math.max(...objects.keys());
  let source = "%PDF-1.4\n";
  const offsets = new Array<number>(lastObjectId + 1).fill(0);
  for (let id = 1; id <= lastObjectId; id += 1) {
    offsets[id] = Buffer.byteLength(source, "ascii");
    source += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(source, "ascii");
  source += `xref\n0 ${lastObjectId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= lastObjectId; id += 1) {
    source += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  source += `trailer\n<< /Size ${lastObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(source, "ascii"));
}

describe("trusted PDF text extraction", () => {
  it("returns exact page-indexed text and preserves the uploaded file identity", async () => {
    const bytes = makePdf(["B4 inside radius 3 mm", "B5 finished angle 90 degrees"]);
    const result = await extractPdfEvidence({ assetId: "asset-1", filename: "drawing.pdf", bytes });

    expect(result).toMatchObject({
      assetId: "asset-1",
      filename: "drawing.pdf",
      mimeType: "application/pdf",
      pageCount: 2,
      pages: [
        { page: 1, text: "B4 inside radius 3 mm" },
        { page: 2, text: "B5 finished angle 90 degrees" },
      ],
    });
    expect(result.bytes).toEqual(bytes);
  });

  it("rejects empty and malformed bytes with stable error codes", async () => {
    await expect(extractPdfEvidence({ assetId: "asset-1", filename: "empty.pdf", bytes: new Uint8Array() }))
      .rejects.toMatchObject({ code: "EMPTY_PDF" } satisfies Partial<PdfTextError>);
    await expect(extractPdfEvidence({ assetId: "asset-1", filename: "broken.pdf", bytes: new Uint8Array([1, 2, 3]) }))
      .rejects.toMatchObject({ code: "INVALID_PDF" } satisfies Partial<PdfTextError>);
  });

  it("rejects PDFs at the Responses byte ceiling before invoking the parser", async () => {
    const bytes = new Uint8Array(MAX_PDF_BYTES);
    await expect(extractPdfEvidence({ assetId: "asset-1", filename: "large.pdf", bytes }))
      .rejects.toMatchObject({ code: "PDF_TOO_LARGE" } satisfies Partial<PdfTextError>);
  });

  it("rejects a document whose page count exceeds the configured maximum", async () => {
    const bytes = makePdf(Array.from({ length: MAX_PDF_PAGES + 1 }, (_, index) => `Page ${index + 1}`));
    await expect(extractPdfEvidence({ assetId: "asset-1", filename: "many-pages.pdf", bytes }))
      .rejects.toMatchObject({ code: "PDF_TOO_MANY_PAGES" } satisfies Partial<PdfTextError>);
  });
});
