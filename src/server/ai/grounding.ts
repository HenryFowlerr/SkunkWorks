import {
  EvidenceRefSchema,
  WorkshopSnapshotSchema,
  type EvidenceRef,
} from "../../contracts/domain";
import { AiProviderError } from "./types";
import type {
  GenerationInput,
  GroundingSource,
  PdfEvidenceFile,
  PreparedEvidence,
  QuestionInput,
  RawCitation,
} from "./types";

const MAX_TOTAL_PDF_BYTES = 50_000_000;
const MAX_EXCERPT_LENGTH = 600;

export function prepareGenerationEvidence(input: GenerationInput): PreparedEvidence[] {
  WorkshopSnapshotSchema.parse(input.workshopSnapshot);
  if (!input.sourceAssetIds.length || new Set(input.sourceAssetIds).size !== input.sourceAssetIds.length) {
    throw new TypeError("Generation source asset IDs must be non-empty and unique.");
  }
  if (!input.pdfs.length || input.pdfs.some((pdf) => !input.sourceAssetIds.includes(pdf.assetId))) {
    throw new TypeError("Generation must include an authorised drawing PDF.");
  }
  if (!input.workshopSnapshot.machines.some((machine) => machine.id === input.machineId)) {
    throw new TypeError("The selected machine is not part of the supplied workshop snapshot.");
  }
  assertUnique(input.mappedBends.map((bend) => bend.bendId), "bend IDs");
  assertUnique(input.stepTargets.map((step) => step.id), "step IDs");
  assertUnique(input.stepTargets.map((step) => step.bendId), "step bend IDs");
  const bendIds = new Set(input.mappedBends.map((bend) => bend.bendId));
  for (const target of input.stepTargets) {
    if (!bendIds.has(target.bendId)) throw new TypeError("Each step target must map to a known bend ID.");
  }
  return prepareEvidence(input.pdfs, input.sources, input.workshopSnapshot);
}

export function prepareQuestionEvidence(input: QuestionInput): PreparedEvidence[] {
  assertUnique(input.knownBendIds, "bend IDs");
  assertUnique(input.knownStepTargets.map((step) => step.id), "step IDs");
  assertUnique(input.knownStepTargets.map((step) => step.bendId), "step bend IDs");
  const bendIds = new Set(input.knownBendIds);
  for (const target of input.knownStepTargets) {
    if (!bendIds.has(target.bendId)) throw new TypeError("Each step target must map to a known bend ID.");
  }
  const context = input.context;
  if (context.bendId !== null && !bendIds.has(context.bendId)) {
    throw new TypeError("Question context refers to an unknown bend ID.");
  }
  const stepById = new Map(input.knownStepTargets.map((step) => [step.id, step]));
  if (context.stepId !== null) {
    const step = stepById.get(context.stepId);
    if (!step || (context.bendId !== null && step.bendId !== context.bendId)) {
      throw new TypeError("Question context refers to an unknown or mismatched step ID.");
    }
  }
  if (input.workshopSnapshot) WorkshopSnapshotSchema.parse(input.workshopSnapshot);
  return prepareEvidence(input.pdfs, input.sources, input.workshopSnapshot ?? undefined);
}

function prepareEvidence(
  pdfs: PdfEvidenceFile[],
  sources: GroundingSource[],
  snapshot?: GenerationInput["workshopSnapshot"],
): PreparedEvidence[] {
  assertUnique(pdfs.map((pdf) => pdf.assetId), "PDF asset IDs");
  const pdfById = new Map<string, PdfEvidenceFile>();
  let totalBytes = 0;
  for (const pdf of pdfs) {
    if (pdf.mimeType !== "application/pdf" || !pdf.filename.toLocaleLowerCase().endsWith(".pdf")) {
      throw new TypeError("Only PDF files may be passed to the semantic evidence adapter.");
    }
    if (pdf.filename.includes("/") || pdf.filename.includes("\\") || /[\u0000-\u001f]/.test(pdf.filename)) {
      throw new TypeError("PDF filenames must be plain display names.");
    }
    if (pdf.bytes.byteLength <= 0 || pdf.pageCount < 1 || !Number.isInteger(pdf.pageCount)) {
      throw new TypeError("PDF bytes and page count must be valid.");
    }
    if (pdf.pages.length !== pdf.pageCount) {
      throw new TypeError("Trusted PDF text must account for every page in the document.");
    }
    if (pdf.bytes.byteLength >= MAX_TOTAL_PDF_BYTES) throw new TypeError("Each PDF must be under the Responses API 50 MB file limit.");
    totalBytes += pdf.bytes.byteLength;
    if (totalBytes > MAX_TOTAL_PDF_BYTES) throw new TypeError("Combined PDF input exceeds the Responses API 50 MB limit.");
    assertUnique(pdf.pages.map((page) => String(page.page)), `pages in ${pdf.assetId}`);
    for (const [index, page] of pdf.pages.entries()) {
      if (!Number.isInteger(page.page) || page.page < 1 || page.page > pdf.pageCount) {
        throw new TypeError(`PDF text page is outside asset ${pdf.assetId}'s page range.`);
      }
      if (page.page !== index + 1) {
        throw new TypeError(`Trusted PDF text pages for ${pdf.assetId} must be contiguous and 1-based.`);
      }
    }
    pdfById.set(pdf.assetId, pdf);
  }
  if (pdfs.length === 0) throw new TypeError("At least one authorised PDF is required.");

  const sourceKeys = new Set<string>();
  const result: PreparedEvidence[] = [];
  for (const source of sources) {
    let sourceKey: string;
    let label: string;
    let reference: EvidenceRef;
    if (source.kind === "document") {
      const pdf = pdfById.get(source.assetId);
      const page = pdf?.pages.find((candidate) => candidate.page === source.page);
      if (!pdf || !page || !page.text.trim() || normalize(page.text) !== normalize(source.text)) {
        throw new TypeError("Document grounding text must exactly match trusted text extraction from an allowlisted uploaded PDF page.");
      }
      sourceKey = `document:${source.assetId}:${source.page}`;
      label = `${pdf.filename}, page ${source.page}`;
      reference = EvidenceRefSchema.parse({
        kind: "document", assetId: source.assetId, page: source.page, region: null, excerpt: "",
      });
    } else if (source.kind === "workshop_note") {
      const machine = snapshot?.machines.find((candidate) => candidate.id === source.machineId);
      const note = machine?.notes.find((candidate) => candidate.id === source.noteId);
      if (!snapshot || source.snapshotId !== snapshot.id || !machine || !note || note.confirmedBy === null || note.text !== source.text) {
        throw new TypeError("Workshop-note evidence must be a confirmed note from the exact selected snapshot and machine.");
      }
      sourceKey = `workshop_note:${source.snapshotId}:${source.machineId}:${source.noteId}`;
      label = `Confirmed workshop note ${source.noteId}`;
      reference = EvidenceRefSchema.parse({ kind: "workshop_note", snapshotId: source.snapshotId, machineId: source.machineId, noteId: source.noteId });
    } else {
      sourceKey = `human_clarification:${source.recordId}`;
      label = `Recorded designer clarification ${source.recordId}`;
      reference = EvidenceRefSchema.parse({ kind: "human_clarification", recordId: source.recordId });
    }
    if (sourceKeys.has(sourceKey)) throw new TypeError("Grounding source IDs must be unique.");
    sourceKeys.add(sourceKey);
    result.push({ sourceKey, label, text: source.text, target: source, reference });
  }
  return result;
}

export function validateCitations(raw: RawCitation[], evidence: PreparedEvidence[]): EvidenceRef[] {
  if (!Array.isArray(raw)) throw unsupported();
  const byKey = new Map(evidence.map((item) => [item.sourceKey, item]));
  const seen = new Set<string>();
  const citations: EvidenceRef[] = [];
  for (const citation of raw) {
    if (!citation || typeof citation.sourceKey !== "string" || typeof citation.excerpt !== "string" || citation.region !== null) {
      throw unsupported();
    }
    if (citation.excerpt.length === 0 || citation.excerpt.length > MAX_EXCERPT_LENGTH || citation.excerpt.trim() !== citation.excerpt) {
      throw unsupported();
    }
    const prepared = byKey.get(citation.sourceKey);
    const citationIdentity = `${citation.sourceKey}\u0000${normalize(citation.excerpt)}`;
    if (!prepared || seen.has(citationIdentity) || !containsExactExcerpt(prepared.text, citation.excerpt)) {
      throw unsupported();
    }
    seen.add(citationIdentity);
    if (prepared.reference.kind === "document") {
      citations.push(EvidenceRefSchema.parse({ ...prepared.reference, excerpt: citation.excerpt, region: null }));
    } else {
      citations.push(prepared.reference);
    }
  }
  return citations;
}

export function assertEvidenceState(
  state: "supported" | "conflict" | "not_found" | "unreadable",
  valueIsPresent: boolean,
  citations: EvidenceRef[],
  sourceKeys?: string[],
): void {
  switch (state) {
    case "supported":
      if (!valueIsPresent || citations.length < 1) throw unsupported();
      break;
    case "conflict":
      if (valueIsPresent || citations.length < 2 || new Set(sourceKeys ?? []).size < 2) throw unsupported();
      break;
    case "not_found":
    case "unreadable":
      if (valueIsPresent || citations.length !== 0) throw unsupported();
      break;
  }
}

export function distinctCitationIds(citations: RawCitation[]): string[] {
  return citations.map((citation) => `${citation.sourceKey}:${normalize(citation.excerpt)}`);
}

export function assertRawNumericClaimsGrounded(
  text: string,
  citations: RawCitation[],
  evidence: PreparedEvidence[],
  excludedIds: string[] = [],
): void {
  const claim = excludedIds.reduce((current, id) => current.replaceAll(id, " "), text);
  const claimNumbers = extractNumbers(claim);
  const sourceByKey = new Map(evidence.map((item) => [item.sourceKey, item]));
  const quotedText = citations.map((citation) => {
    const source = sourceByKey.get(citation.sourceKey);
    return source && containsExactExcerpt(source.text, citation.excerpt) ? citation.excerpt : "";
  }).join(" ");
  const supportedNumbers = new Set(extractNumbers(quotedText));
  if (claimNumbers.some((value) => !supportedNumbers.has(value))) throw unsupported();
}

export function validateMachineOrder(
  order: string[],
  bendIds: string[],
  partFamily: string,
  constraints: Array<{ beforeBendId: string; afterBendId: string; appliesToPartFamily: string }>,
): void {
  if (order.length !== bendIds.length || new Set(order).size !== order.length ||
    order.some((bendId) => !bendIds.includes(bendId))) throw unsupported();
  const position = new Map(order.map((bendId, index) => [bendId, index]));
  for (const constraint of constraints) {
    if (constraint.appliesToPartFamily.trim().toLocaleLowerCase() !== partFamily.trim().toLocaleLowerCase()) continue;
    const before = position.get(constraint.beforeBendId);
    const after = position.get(constraint.afterBendId);
    if (before === undefined || after === undefined || before >= after) throw unsupported();
  }
}

function containsExactExcerpt(source: string, excerpt: string): boolean {
  return normalize(source).includes(normalize(excerpt));
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function extractNumbers(value: string): string[] {
  return [...value.matchAll(/[-+]?\d+(?:[.,]\d+)?/g)].map((match) => match[0].replace(",", "."));
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must be unique.`);
}

function unsupported(): AiProviderError {
  return new AiProviderError("UNSUPPORTED_CLAIM");
}
