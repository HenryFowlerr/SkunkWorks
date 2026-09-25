import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PdfEvidenceFile } from "./types";

export const MAX_PDF_BYTES = 50_000_000;
export const MAX_PDF_PAGES = 100;

export type PdfTextFailureCode =
  | "EMPTY_PDF"
  | "PDF_TOO_LARGE"
  | "PDF_TOO_MANY_PAGES"
  | "INVALID_PDF"
  | "PDF_TEXT_EXTRACTION_FAILED";

/** Safe, stable error returned when an uploaded PDF cannot become trusted evidence. */
export class PdfTextError extends Error {
  readonly code: PdfTextFailureCode;

  constructor(code: PdfTextFailureCode) {
    super(messageFor(code));
    this.name = "PdfTextError";
    this.code = code;
  }
}

type PdfTextInput = Pick<PdfEvidenceFile, "assetId" | "filename" | "bytes">;

/**
 * Extracts trusted, page-indexed text from PDF bytes that the caller has already
 * authorized and loaded from private storage. The parser receives a copy because
 * PDF.js may transfer ownership of its input buffer while loading the document.
 */
export async function extractPdfEvidence(input: PdfTextInput): Promise<PdfEvidenceFile> {
  if (!(input.bytes instanceof Uint8Array)) throw new PdfTextError("INVALID_PDF");
  if (input.bytes.byteLength === 0) throw new PdfTextError("EMPTY_PDF");
  if (input.bytes.byteLength >= MAX_PDF_BYTES) throw new PdfTextError("PDF_TOO_LARGE");

  const trustedBytes = input.bytes.slice();
  const loadingTask = getDocument({
    data: trustedBytes.slice(),
    useSystemFonts: false,
    disableFontFace: true,
    useWasm: false,
    isImageDecoderSupported: false,
    stopAtErrors: true,
  });
  let stage: "open" | "extract" = "open";

  try {
    const document = await loadingTask.promise;
    if (!Number.isInteger(document.numPages) || document.numPages < 1) {
      throw new PdfTextError("INVALID_PDF");
    }
    if (document.numPages > MAX_PDF_PAGES) throw new PdfTextError("PDF_TOO_MANY_PAGES");

    stage = "extract";
    const pages: PdfEvidenceFile["pages"] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = content.items
          .flatMap((item) => {
            if (!("str" in item) || item.str.length === 0) return [];
            return [`${item.str}${item.hasEOL ? "\n" : " "}`];
          })
          .join("")
          .replace(/[\t ]+/g, " ")
          .trim();
        pages.push({ page: pageNumber, text });
      } finally {
        page.cleanup();
      }
    }

    return {
      assetId: input.assetId,
      filename: input.filename,
      mimeType: "application/pdf",
      bytes: trustedBytes,
      pageCount: document.numPages,
      pages,
    };
  } catch (error) {
    if (error instanceof PdfTextError) throw error;
    throw new PdfTextError(stage === "open" ? "INVALID_PDF" : "PDF_TEXT_EXTRACTION_FAILED");
  } finally {
    // Destroy the loading task even when parsing, page extraction, or a size check fails.
    // Cleanup failures should not replace the actionable extraction result.
    try {
      await loadingTask.destroy();
    } catch {
      // PDF.js may already have torn down a failed loading task.
    }
  }
}

function messageFor(code: PdfTextFailureCode): string {
  switch (code) {
    case "EMPTY_PDF": return "The uploaded PDF is empty.";
    case "PDF_TOO_LARGE": return "The uploaded PDF exceeds the supported byte limit.";
    case "PDF_TOO_MANY_PAGES": return "The uploaded PDF exceeds the supported page limit.";
    case "INVALID_PDF": return "The uploaded file is not a valid readable PDF.";
    case "PDF_TEXT_EXTRACTION_FAILED": return "Text could not be extracted from one or more PDF pages.";
  }
}
