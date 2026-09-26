import "server-only";

import { createHash } from "node:crypto";
import type { Asset, AskQuestionInput, Flag, Release, WorkshopSnapshot } from "@/contracts";
import { extractPdfEvidence, MAX_PDF_BYTES, PdfTextError } from "@/server/ai/pdf-text";
import type { GroundingSource, QuestionInput } from "@/server/ai/types";
import { ApiFault } from "@/server/http/api";

type ApprovedContext = {
  releaseId: string;
  revisionNumber: number;
  machineId: string | null;
  selectedStep: {
    id: string;
    bendId: string;
    instruction: string;
    guidanceDecision: "include" | "exclude" | "pending" | null;
  } | null;
};

/** Assemble model input only from a published, authorized release and its exact source set. */
export async function assembleReleaseQuestionInput(input: {
  request: AskQuestionInput;
  release: Release;
  assets: Asset[];
  flags?: Flag[];
  workshop: WorkshopSnapshot;
  readSource: (asset: Asset) => Promise<Uint8Array>;
}): Promise<QuestionInput & { approvedContext: ApprovedContext }> {
  const { context } = input.request;
  if (context.releaseId === null || context.draftId !== null || context.draftVersion !== null) {
    throw new ApiFault("REVIEW_REQUIRED", "Questions require a published release, not a draft.");
  }
  if (context.jobId !== input.release.jobId || context.releaseId !== input.release.id) {
    throw new ApiFault("NOT_FOUND", "Release not found for this job.");
  }

  const snapshot = input.release.snapshot;
  if (input.workshop.id !== snapshot.workshopSnapshotId ||
      !input.workshop.confirmedBy || !input.workshop.confirmedAt ||
      !input.workshop.machines.some((machine) => machine.id === snapshot.machineId)) {
    throw new ApiFault("REVIEW_REQUIRED", "The approved facility evidence for this release is unavailable.");
  }

  const knownBendIds = snapshot.bends.map((bend) => bend.bendId);
  const knownStepTargets = snapshot.steps.map((step) => ({ id: step.id, bendId: step.bendId }));
  if (context.bendId !== null && !knownBendIds.includes(context.bendId)) {
    throw new ApiFault("VALIDATION_FAILED", "The selected bend is not in this release.");
  }
  const selectedStep = context.stepId === null ? null : snapshot.steps.find((step) => step.id === context.stepId);
  if (context.stepId !== null && (!selectedStep ||
      (context.bendId !== null && selectedStep.bendId !== context.bendId))) {
    throw new ApiFault("VALIDATION_FAILED", "The selected step does not match this release and bend.");
  }

  const sourceIds = snapshot.sourceAssetIds;
  if (sourceIds.length === 0 || new Set(sourceIds).size !== sourceIds.length) {
    throw new ApiFault("REVIEW_REQUIRED", "Approved source evidence for this release is unavailable.");
  }
  const assets = sourceIds.map((id) => input.assets.find((asset) => asset.id === id));
  if (assets.some((asset) => !asset || asset.jobId !== input.release.jobId ||
      asset.releaseId !== null || asset.status !== "ready" || asset.sha256 === null)) {
    throw new ApiFault("REVIEW_REQUIRED", "A verified source from this release is unavailable.");
  }
  const drawings = (assets as Asset[]).filter((asset) => asset.kind === "drawing_pdf");
  if (drawings.length === 0 || drawings.reduce((total, asset) => total + asset.byteSize, 0) >= MAX_PDF_BYTES) {
    throw new ApiFault("REVIEW_REQUIRED", "A readable drawing PDF from this release is unavailable.");
  }

  const pdfs = await Promise.all(drawings.map(async (asset) => {
    const bytes = await input.readSource(asset);
    if (bytes.byteLength !== asset.byteSize ||
        createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
      throw new ApiFault("VERSION_CONFLICT", "A release drawing changed after verification.");
    }
    try {
      return await extractPdfEvidence({ assetId: asset.id, filename: asset.filename, bytes });
    } catch (cause) {
      if (cause instanceof PdfTextError) {
        throw new ApiFault("REVIEW_REQUIRED", "A release drawing has no readable source evidence.");
      }
      throw cause;
    }
  }));
  const sources: GroundingSource[] = pdfs.flatMap((pdf) => pdf.pages
    .filter((page) => page.text.trim())
    .map((page) => ({ kind: "document" as const, assetId: pdf.assetId, page: page.page, text: page.text })));
  if (sources.length === 0) {
    throw new ApiFault("REVIEW_REQUIRED", "The approved drawings have no extractable text for an answer.");
  }
  const machine = input.workshop.machines.find((item) => item.id === snapshot.machineId)!;
  for (const note of machine.notes) {
    if (note.confirmedBy !== null) sources.push({
      kind: "workshop_note", snapshotId: input.workshop.id, machineId: machine.id, noteId: note.id, text: note.text,
    });
  }
  // A floor report is not evidence. Only a persisted engineer response for
  // this exact release/operation becomes part of the question knowledge packet.
  const approvedClarifications = (input.flags ?? []).filter((flag) =>
    flag.context.jobId === input.release.jobId &&
    flag.context.releaseId === input.release.id &&
    flag.status !== "open" &&
    flag.response?.kind === "explanation" &&
    (context.stepId === null ? flag.context.stepId === null : flag.context.stepId === context.stepId) &&
    (context.bendId === null ? flag.context.bendId === null : flag.context.bendId === context.bendId),
  ).map((flag) => ({ recordId: flag.id, text: flag.response!.text }));
  for (const clarification of approvedClarifications) {
    sources.push({ kind: "human_clarification", ...clarification });
  }

  return {
    context,
    question: input.request.question,
    pdfs,
    sources,
    workshopSnapshot: input.workshop,
    knownBendIds,
    knownStepTargets,
    approvedClarifications,
    approvedContext: {
      releaseId: input.release.id,
      revisionNumber: input.release.revisionNumber,
      machineId: snapshot.machineId,
      selectedStep: selectedStep ? {
        id: selectedStep.id,
        bendId: selectedStep.bendId,
        instruction: selectedStep.instruction,
        guidanceDecision: selectedStep.guidance?.decision ?? null,
      } : null,
    },
  };
}
