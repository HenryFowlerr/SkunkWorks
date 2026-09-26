import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  PanelModelInputSchema,
  type Asset,
  type DraftContent,
  type Job,
  type PanelModel,
  type WorkshopSnapshot,
} from "@/contracts";
import { type DraftProposal, type GenerationInput, type GroundingSource } from "./types";
import { extractPdfEvidence, MAX_PDF_BYTES, PdfTextError } from "./pdf-text";
import { ApiFault } from "@/server/http/api";

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const BendMappingSchema = z.object({
  bendId: z.string().trim().min(1),
  hingeId: z.string().trim().min(1),
  foldRotationDeg: z.number().finite(),
}).passthrough();
const ManifestSchema = z.object({
  manifestVersion: z.literal("skunkworks-bend-manifest/1.0"),
  panelModel: z.unknown(),
  bendMappings: z.array(BendMappingSchema).min(1).max(200),
  stepOrder: z.array(z.string().trim().min(1)).min(1).max(200),
}).passthrough();

export type SourceReader = (asset: Asset) => Promise<Uint8Array>;

/** Prepare only server-authorized, hash-checked sources. An uploaded JSON `reviewed` flag is ignored. */
export async function prepareGenerationInput(input: {
  job: Job;
  assets: Asset[];
  workshop: WorkshopSnapshot;
  readSource: SourceReader;
}): Promise<{ aiInput: GenerationInput; panelModel: PanelModel; manifestAssetId: string }> {
  const { job, workshop } = input;
  if (!job.workshopSnapshotId || job.workshopSnapshotId !== workshop.id || !job.machineId ||
      !workshop.machines.some((machine) => machine.id === job.machineId)) {
    throw new ApiFault("REVIEW_REQUIRED", "Select a valid facility and machine before generation.");
  }
  if (!workshop.confirmedBy || !workshop.confirmedAt) {
    throw new ApiFault("REVIEW_REQUIRED", "The selected facility profile must be confirmed before generation.");
  }
  const selected = job.sourceAssetIds.map((id) => input.assets.find((asset) => asset.id === id));
  if (selected.some((asset) => !asset || asset.jobId !== job.id || asset.status !== "ready" || !asset.sha256)) {
    throw new ApiFault("REVIEW_REQUIRED", "Every selected source must finish verification before generation.");
  }
  const assets = selected as Asset[];
  const drawings = assets.filter((asset) => asset.kind === "drawing_pdf");
  const manifests = assets.filter((asset) => asset.kind === "bend_manifest");
  if (!drawings.length) throw new ApiFault("REVIEW_REQUIRED", "Select at least one verified drawing PDF.");
  if (manifests.length !== 1) {
    throw new ApiFault("MAPPING_REQUIRED", "Select exactly one authored bend manifest for this geometry-backed generation.");
  }
  if (drawings.reduce((sum, asset) => sum + asset.byteSize, 0) > MAX_PDF_BYTES) {
    throw new ApiFault("UNSUPPORTED_ASSET", "Combined drawing PDFs exceed the 50 MB generation limit.");
  }

  const pdfs = await Promise.all(drawings.map(async (asset) => {
    const bytes = await checkedBytes(asset, input.readSource);
    try {
      return await extractPdfEvidence({ assetId: asset.id, filename: asset.filename, bytes });
    } catch (cause) {
      if (cause instanceof PdfTextError) throw new ApiFault("UNSUPPORTED_ASSET", cause.message);
      throw cause;
    }
  }));
  const manifestAsset = manifests[0];
  const manifestBytes = await checkedBytes(manifestAsset, input.readSource);
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new ApiFault("UNSUPPORTED_ASSET", "The authored bend manifest exceeds 2 MB.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  } catch {
    throw new ApiFault("UNSUPPORTED_ASSET", "The authored bend manifest is not readable JSON.");
  }
  const manifest = ManifestSchema.safeParse(decoded);
  if (!manifest.success) throw new ApiFault("MAPPING_REQUIRED", "The authored bend manifest is incomplete or unsupported.");
  const rawPanelModel = manifest.data.panelModel;
  if (!rawPanelModel || typeof rawPanelModel !== "object" || Array.isArray(rawPanelModel)) {
    throw new ApiFault("MAPPING_REQUIRED", "The authored panel model is missing.");
  }
  const { reviewed: _ignored, ...modelFields } = rawPanelModel as Record<string, unknown>;
  void _ignored;
  const model = PanelModelInputSchema.safeParse(modelFields);
  if (!model.success || model.data.origin !== "authored_manifest") {
    throw new ApiFault("MAPPING_REQUIRED", "The authored panel model is invalid; review its panels and hinges.");
  }
  const hingeIds = new Set(model.data.hinges.map((hinge) => hinge.id));
  const bendIds = manifest.data.bendMappings.map((bend) => bend.bendId);
  if (new Set(bendIds).size !== bendIds.length ||
      new Set(manifest.data.stepOrder).size !== bendIds.length ||
      manifest.data.stepOrder.some((id) => !bendIds.includes(id)) ||
      manifest.data.bendMappings.some((bend) => !hingeIds.has(bend.hingeId))) {
    throw new ApiFault("MAPPING_REQUIRED", "Manifest bend order and hinge mapping must be complete and unique.");
  }
  const byBend = new Map(manifest.data.bendMappings.map((bend) => [bend.bendId, bend]));
  const mappedBends = manifest.data.stepOrder.map((bendId) => {
    const bend = byBend.get(bendId)!;
    return {
      bendId,
      hingeId: bend.hingeId,
      foldRotationDeg: {
        value: bend.foldRotationDeg,
        evidence: [],
        evidenceState: "supported" as const,
        originalText: `Authored manifest rotation ${bend.foldRotationDeg} degrees; engineer evidence review required`,
      },
    };
  });
  const sources: GroundingSource[] = pdfs.flatMap((pdf) => pdf.pages
    .filter((page) => page.text.trim())
    .map((page) => ({ kind: "document" as const, assetId: pdf.assetId, page: page.page, text: page.text })));
  const machine = workshop.machines.find((candidate) => candidate.id === job.machineId)!;
  for (const note of machine.notes) {
    if (note.confirmedBy !== null) sources.push({
      kind: "workshop_note", snapshotId: workshop.id, machineId: machine.id, noteId: note.id, text: note.text,
    });
  }
  if (!sources.some((source) => source.kind === "document")) {
    throw new ApiFault("REVIEW_REQUIRED", "The drawing PDFs have no extractable text for cited generation.");
  }
  return {
    aiInput: {
      jobId: job.id,
      partFamily: job.partFamily,
      sourceAssetIds: [...job.sourceAssetIds],
      pdfs,
      sources,
      workshopSnapshot: workshop,
      machineId: job.machineId,
      mappedBends,
      stepTargets: manifest.data.stepOrder.map((bendId) => ({ id: randomUUID(), bendId })),
    },
    panelModel: { ...model.data, reviewed: false },
    manifestAssetId: manifestAsset.id,
  };
}

export function proposalToDraftContent(input: {
  aiInput: GenerationInput;
  panelModel: PanelModel;
  manifestAssetId: string;
  proposal: DraftProposal;
}): DraftContent {
  const { aiInput, proposal } = input;
  const manifestFinding = {
    id: randomUUID(),
    kind: "mapping" as const,
    severity: "blocking" as const,
    bendId: null,
    message: "The authored manifest supplies signed fold rotations, but the engineer must verify the mapping and attach supporting evidence before release.",
    evidence: [],
    disposition: "open" as const,
    resolutionRecordId: null,
  };
  const machineProposals = proposal.machineProposal ? [{
    ...proposal.machineProposal,
    id: randomUUID(),
    snapshotId: aiInput.workshopSnapshot.id,
    machineId: aiInput.machineId,
    status: "proposed" as const,
    decidedBy: null,
  }] : [];
  return {
    sourceAssetIds: [...aiInput.sourceAssetIds],
    workshopSnapshotId: aiInput.workshopSnapshot.id,
    machineId: aiInput.machineId,
    panelModel: input.panelModel,
    bends: proposal.bends,
    steps: proposal.steps,
    findings: [...proposal.findings, manifestFinding],
    machineProposals,
  };
}

async function checkedBytes(asset: Asset, readSource: SourceReader): Promise<Uint8Array> {
  const bytes = await readSource(asset);
  if (bytes.byteLength !== asset.byteSize ||
      createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
    throw new ApiFault("VERSION_CONFLICT", "A selected source changed after verification; upload it again.");
  }
  return bytes;
}
