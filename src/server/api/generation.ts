import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DraftContentSchema,
  DraftContentInputSchema,
  GenerationSchema,
  PanelModelSchema,
  PanelModelInputSchema,
  type Asset,
  type DraftContent,
  type Generation,
  type Id,
  type PanelModelInput,
  type WorkshopSnapshot,
} from "@/contracts";
import type { PrivateStorageAdapter } from "@/server/data/storage";
import type { WorkspaceDataRepository } from "@/server/data/repository";
import { ApiFault } from "@/server/http/api";
import { extractPdfEvidence, PdfTextError } from "@/server/ai/pdf-text";
import { AiProviderError, type DraftProposal, type GenerationInput, type PdfEvidenceFile } from "@/server/ai/types";
import type { AiAdapter } from "@/server/ai/openai";
import type { AuthorizedPrivateAsset } from "@/server/data/repository";

type GenerationRepository = Pick<
  WorkspaceDataRepository,
  | "startGeneration"
  | "getGeneration"
  | "getGenerationResult"
  | "getJobBundle"
  | "getWorkshopSnapshot"
  | "listGenerationSourceAssets"
  | "completeGeneration"
  | "failGeneration"
>;

export type GenerationDependencies = {
  repository: GenerationRepository;
  storage: Pick<PrivateStorageAdapter, "loadAuthorizedAsset">;
  ai: AiAdapter;
  fingerprint: (input: {
    job: { partFamily: string; workshopSnapshotId: Id | null; machineId: Id | null; sourceAssetIds: Id[] };
    assets: Asset[];
    workshopSnapshot: WorkshopSnapshot;
  }) => string;
  createId?: () => Id;
};

export type CreateGenerationRequest = {
  jobId: Id;
  expectedJobVersion: number;
  idempotencyKey: string;
};

const BendManifestSchema = z.object({
  manifestVersion: z.literal("1.0"),
  panelModel: PanelModelInputSchema,
  bends: z.array(z.object({
    bendId: z.string().trim().min(1),
    hingeId: z.string().trim().min(1).nullable(),
  }).strict()),
}).strict();

const MAX_BEND_MANIFEST_BYTES = 2_000_000;

type ManifestMapping = {
  panelModel: PanelModelInput | null;
  mappedBends: GenerationInput["mappedBends"];
  issue: string | null;
};

/** Executes one synchronous, idempotent generation request using only authorized server data. */
export async function createGeneration(
  input: CreateGenerationRequest,
  dependencies: GenerationDependencies,
): Promise<Generation> {
  const started = await dependencies.repository.startGeneration({
    jobId: input.jobId,
    expectedJobVersion: input.expectedJobVersion,
    idempotencyKey: input.idempotencyKey,
  });

  if (started.state === "running") {
    throw new ApiFault("GENERATION_RUNNING", "A generation with this request is already running.", { retryable: true });
  }
  if (started.state === "completed") return GenerationSchema.parse(started.generation);
  if (started.state === "failed") throw faultForPersistedFailure(started.errorCode);

  const generationId = started.generation.id;
  let terminalStatePersisted = false;
  try {
    const bundle = await dependencies.repository.getJobBundle(input.jobId);
    if (bundle.job.version !== started.jobVersion || (bundle.draft?.version ?? null) !== started.baseDraftVersion) {
      throw new ApiFault("VERSION_CONFLICT", "Job inputs or the current draft changed before generation could start.");
    }
    if (!bundle.job.workshopSnapshotId || !bundle.job.machineId) {
      throw new ApiFault("REVIEW_REQUIRED", "Select a workshop profile and machine before generating a draft.");
    }

    const snapshot = await dependencies.repository.getWorkshopSnapshot(bundle.job.workshopSnapshotId);
    const machine = snapshot.machines.find((candidate) => candidate.id === bundle.job.machineId);
    if (!machine || snapshot.confirmedBy === null) {
      throw new ApiFault("REVIEW_REQUIRED", "The selected workshop profile and machine must be confirmed before generation.");
    }

    const sourceAssets = await dependencies.repository.listGenerationSourceAssets(generationId);
    assertSourceSet(bundle.job.sourceAssetIds, sourceAssets);
    const inputFingerprint = dependencies.fingerprint({ job: bundle.job, assets: bundle.assets, workshopSnapshot: snapshot });
    if (inputFingerprint !== started.generation.inputFingerprint) {
      throw new ApiFault("VERSION_CONFLICT", "Job source inputs changed before generation could start.");
    }

    const manifest = await loadManifestMapping({
      authorizedAssets: sourceAssets,
      storage: dependencies.storage,
      currentDraft: bundle.draft,
      job: bundle.job,
      inputFingerprint,
      workshopSnapshotId: snapshot.id,
      machineId: machine.id,
    });
    const pdfs = await loadTrustedPdfEvidence(sourceAssets, dependencies.storage);
    const sources = [
      ...pdfs.flatMap((pdf) => pdf.pages.map((page) => ({
        kind: "document" as const,
        assetId: pdf.assetId,
        page: page.page,
        text: page.text,
      }))),
      ...machine.notes
        .filter((note) => note.confirmedBy !== null)
        .map((note) => ({
          kind: "workshop_note" as const,
          snapshotId: snapshot.id,
          machineId: machine.id,
          noteId: note.id,
          text: note.text,
        })),
    ];
    const stepTargets = manifest.mappedBends.map(({ bendId }) => ({ id: newId(dependencies), bendId }));
    const generationInput: GenerationInput = {
      jobId: bundle.job.id,
      partFamily: bundle.job.partFamily,
      sourceAssetIds: bundle.job.sourceAssetIds,
      pdfs,
      sources,
      workshopSnapshot: snapshot,
      machineId: machine.id,
      mappedBends: manifest.mappedBends,
      stepTargets,
    };

    const proposal = await dependencies.ai.generateDraft(generationInput);
    const modelIdentifier = proposal.model.trim();
    if (!modelIdentifier) {
      throw new ApiFault("PROVIDER_UNAVAILABLE", "The AI provider returned no model identifier.");
    }
    const content = buildDraftContent({
      proposal,
      jobSourceAssetIds: bundle.job.sourceAssetIds,
      snapshot,
      machineId: machine.id,
      panelModel: manifest.panelModel,
      mappingIssue: manifest.issue,
      createId: () => newId(dependencies),
    });
    const completion = await dependencies.repository.completeGeneration({
      generationId,
      claimToken: started.claimToken,
      content,
      modelIdentifier,
    });
    terminalStatePersisted = true;
    if (!completion.applied) {
      if (completion.reason === "expired") {
        throw new ApiFault("PROVIDER_TIMEOUT", "Generation expired before its result could be saved.", { retryable: true });
      }
      throw new ApiFault("VERSION_CONFLICT", "Job inputs or the draft changed while generation was running; no generated content was saved.");
    }

    const completedGeneration = await dependencies.repository.getGeneration(generationId);
    if (!completedGeneration) {
      throw new ApiFault("PROVIDER_UNAVAILABLE", "The completed generation could not be reloaded.", { retryable: true });
    }
    return GenerationSchema.parse(completedGeneration);
  } catch (cause) {
    if (!terminalStatePersisted) {
      try {
        await dependencies.repository.failGeneration({
          generationId,
          claimToken: started.claimToken,
          errorCode: persistedFailureCode(cause),
        });
      } catch {
        throw new ApiFault("PROVIDER_UNAVAILABLE", "Generation failed and its status could not be saved.", { retryable: true });
      }
    }
    throw publicFailure(cause);
  }
}

function buildDraftContent(input: {
  proposal: DraftProposal;
  jobSourceAssetIds: Id[];
  snapshot: WorkshopSnapshot;
  machineId: Id;
  panelModel: PanelModelInput | null;
  mappingIssue: string | null;
  createId: () => Id;
}): DraftContent {
  const machineProposal = input.proposal.machineProposal;
  const contentInput = {
    sourceAssetIds: input.jobSourceAssetIds,
    workshopSnapshotId: input.snapshot.id,
    machineId: input.machineId,
    // Completion deliberately invalidates the mapping review before designers approve this new content.
    panelModel: input.panelModel,
    bends: input.proposal.bends,
    steps: input.proposal.steps,
    findings: [
      ...input.proposal.findings.map(({ id, kind, severity, bendId, message, evidence }) => ({
      id, kind, severity, bendId, message, evidence,
      })),
      ...(input.mappingIssue ? [{
        id: input.createId(),
        kind: "mapping" as const,
        severity: "blocking" as const,
        bendId: null,
        message: input.mappingIssue,
        evidence: [],
      }] : []),
    ],
    machineProposals: machineProposal ? [{
      id: input.createId(),
      snapshotId: input.snapshot.id,
      machineId: input.machineId,
      proposedBendOrder: machineProposal.proposedBendOrder,
      rationale: machineProposal.rationale,
      evidence: machineProposal.evidence,
    }] : [],
  };
  return DraftContentSchema.parse({
    ...DraftContentInputSchema.parse(contentInput),
    panelModel: input.panelModel ? { ...input.panelModel, reviewed: false } : null,
    findings: contentInput.findings.map((finding) => ({
      ...finding,
      disposition: "open",
      resolutionRecordId: null,
    })),
    machineProposals: contentInput.machineProposals.map((proposal) => ({
      ...proposal,
      status: "proposed",
      decidedBy: null,
    })),
  });
}

async function loadManifestMapping(input: {
  authorizedAssets: AuthorizedPrivateAsset[];
  storage: Pick<PrivateStorageAdapter, "loadAuthorizedAsset">;
  currentDraft: Awaited<ReturnType<WorkspaceDataRepository["getJobBundle"]>>["draft"];
  job: Awaited<ReturnType<WorkspaceDataRepository["getJobBundle"]>>["job"];
  inputFingerprint: string;
  workshopSnapshotId: Id;
  machineId: Id;
}): Promise<ManifestMapping> {
  const manifests = input.authorizedAssets.filter(({ asset }) => asset.kind === "bend_manifest");
  if (manifests.length === 0) {
    const saved = mappingFromCurrentDraft(input);
    if (saved) return saved;
    return emptyMapping("No bend manifest or current bend mapping was supplied. Add or confirm the bend IDs and hinge mappings before publication.");
  }
  if (manifests.length !== 1) {
    return emptyMapping("More than one bend manifest is selected, so the bend mapping is ambiguous. Keep one reviewed manifest before publication.");
  }

  const authorized = manifests[0];
  if (authorized.bucketId !== "skunkworks-private" || authorized.asset.status !== "ready" ||
    authorized.asset.releaseId !== null) {
    throw new ApiFault("UNSUPPORTED_ASSET", "Only a ready private bend manifest may be used for mapping.");
  }
  const bytes = await input.storage.loadAuthorizedAsset(authorized);
  verifyLoadedBytes(authorized.asset, bytes);
  if (bytes.byteLength > MAX_BEND_MANIFEST_BYTES) {
    return emptyMapping("The bend manifest is too large to parse safely. Replace it with a smaller versioned manifest.");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return emptyMapping("The selected bend manifest is not readable versioned JSON; review or replace it before publication.");
  }
  const parsed = BendManifestSchema.safeParse(decoded);
  if (!parsed.success) {
    return emptyMapping("The selected bend manifest does not match version 1.0; review its topology and bend-to-hinge mappings before publication.");
  }

  const { panelModel: suppliedPanelModel, bends } = parsed.data;
  const hingeIds = new Set(suppliedPanelModel.hinges.map(({ id }) => id));
  const bendIds = bends.map(({ bendId }) => bendId);
  if (new Set(bendIds).size !== bendIds.length ||
    bends.some(({ hingeId }) => hingeId !== null && !hingeIds.has(hingeId))) {
    return emptyMapping("The bend manifest contains duplicate bend IDs or a hinge mapping outside its panel model; correct it before publication.");
  }

  // The uploaded file establishes authored topology only. Do not let its
  // `origin` value claim reviewer authority; only an authorised review action
  // can do that, and the generation result always starts unreviewed.
  const panelModel = PanelModelInputSchema.parse({ ...suppliedPanelModel, origin: "authored_manifest" });
  const mappedBends: GenerationInput["mappedBends"] = bends.map(({ bendId, hingeId }) => ({
    bendId,
    hingeId,
    // Contract v1 has no manifest EvidenceRef. Never promote the uploaded
    // mapping to supported engineering evidence for a signed rotation.
    foldRotationDeg: { value: null, evidence: [], evidenceState: "not_found", originalText: null },
  }));
  const issue = mappedBends.length === 0
    ? "The bend manifest has valid panel topology but no bend-to-hinge mappings. Add those mappings before publication."
    : null;
  return { panelModel, mappedBends, issue };
}

function mappingFromCurrentDraft(input: {
  currentDraft: Awaited<ReturnType<WorkspaceDataRepository["getJobBundle"]>>["draft"];
  job: Awaited<ReturnType<WorkspaceDataRepository["getJobBundle"]>>["job"];
  inputFingerprint: string;
  workshopSnapshotId: Id;
  machineId: Id;
}): ManifestMapping | null {
  const draft = input.currentDraft;
  if (!draft) return null;
  const sourceIdsMatch = new Set(draft.content.sourceAssetIds).size === draft.content.sourceAssetIds.length &&
    draft.content.sourceAssetIds.length === input.job.sourceAssetIds.length &&
    draft.content.sourceAssetIds.every((id) => input.job.sourceAssetIds.includes(id));
  if (draft.inputFingerprint !== input.inputFingerprint || !sourceIdsMatch ||
    draft.content.workshopSnapshotId !== input.workshopSnapshotId || draft.content.machineId !== input.machineId) {
    return emptyMapping("The saved bend mapping is stale for the selected drawing or workshop profile. Update it before publication.");
  }

  if (!draft.content.panelModel) {
    return emptyMapping("The saved draft has no panel topology. Add or confirm a bend mapping before publication.");
  }
  const modelResult = PanelModelSchema.safeParse(draft.content.panelModel);
  if (!modelResult.success) {
    return emptyMapping("The saved panel topology is invalid. Correct it before publication.");
  }
  const storedModel = modelResult.data;
  const panelModel = PanelModelInputSchema.parse({
    schemaVersion: storedModel.schemaVersion,
    units: storedModel.units,
    thicknessMm: storedModel.thicknessMm,
    rootPanelId: storedModel.rootPanelId,
    panels: storedModel.panels,
    hinges: storedModel.hinges,
    origin: "ai_proposed",
    referenceFaceLabel: storedModel.referenceFaceLabel,
  });
  const hingeIds = new Set(panelModel.hinges.map(({ id }) => id));
  const bendIds = draft.content.bends.map(({ bendId }) => bendId);
  if (new Set(bendIds).size !== bendIds.length || draft.content.bends.some(({ hingeId }) =>
    hingeId !== null && !hingeIds.has(hingeId),
  )) {
    return emptyMapping("The saved draft has duplicate bend IDs or a hinge mapping outside its panel model. Correct it before publication.");
  }
  const mappedBends: GenerationInput["mappedBends"] = draft.content.bends.map(({ bendId, hingeId }) => ({
    bendId,
    hingeId,
    foldRotationDeg: { value: null, evidence: [], evidenceState: "not_found", originalText: null },
  }));
  const issue = mappedBends.length === 0
    ? "The saved panel topology has no bend mappings. Add bend IDs and hinge assignments before publication."
    : null;
  return { panelModel, mappedBends, issue };
}

function emptyMapping(issue: string): ManifestMapping {
  return { panelModel: null, mappedBends: [], issue };
}

export async function loadTrustedPdfEvidence(
  authorizedAssets: AuthorizedPrivateAsset[],
  storage: Pick<PrivateStorageAdapter, "loadAuthorizedAsset">,
): Promise<PdfEvidenceFile[]> {
  const drawings = authorizedAssets.filter(({ asset }) => asset.kind === "drawing_pdf");
  if (drawings.length === 0) {
    throw new ApiFault("UNSUPPORTED_ASSET", "Add at least one verified drawing PDF before generating instructions.");
  }
  try {
    return await Promise.all(drawings.map(async (authorized) => {
      if (authorized.bucketId !== "skunkworks-private" || authorized.asset.status !== "ready" ||
        authorized.asset.releaseId !== null) {
        throw new ApiFault("UNSUPPORTED_ASSET", "Only ready private PDF sources may be used as evidence.");
      }
      const bytes = await storage.loadAuthorizedAsset(authorized);
      verifyLoadedBytes(authorized.asset, bytes);
      return extractPdfEvidence({
        assetId: authorized.asset.id,
        filename: authorized.asset.filename,
        bytes,
      });
    }));
  } catch (error) {
    if (error instanceof PdfTextError) throw new ApiFault("UNSUPPORTED_ASSET", error.message);
    throw error;
  }
}

function assertSourceSet(jobAssetIds: Id[], sourceAssets: AuthorizedPrivateAsset[]): void {
  const ids = sourceAssets.map(({ asset }) => asset.id);
  if (new Set(ids).size !== ids.length || ids.length !== jobAssetIds.length ||
    jobAssetIds.some((id) => !ids.includes(id))) {
    throw new ApiFault("VERSION_CONFLICT", "The job source set changed while generation was starting.");
  }
  if (sourceAssets.some(({ asset }) => asset.status !== "ready" || asset.releaseId !== null || asset.kind === "issue_photo")) {
    throw new ApiFault("UNSUPPORTED_ASSET", "Only ready job source files may be used for generation.");
  }
  if (sourceAssets.some(({ bucketId }) => bucketId !== "skunkworks-private")) {
    throw new ApiFault("PROVIDER_UNAVAILABLE", "A job source could not be loaded from private storage.");
  }
}

function verifyLoadedBytes(asset: Asset, bytes: Uint8Array): void {
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== asset.byteSize || !asset.sha256 || hash !== asset.sha256.toLowerCase()) {
    throw new ApiFault("PROVIDER_UNAVAILABLE", "A verified source file did not match its stored size and digest.");
  }
}

function newId(dependencies: GenerationDependencies): Id {
  return dependencies.createId?.() ?? randomUUID();
}

function persistedFailureCode(cause: unknown): string {
  if (cause instanceof ApiFault) return cause.code;
  if (cause instanceof AiProviderError) return cause.code;
  if (cause instanceof PdfTextError) return cause.code;
  if (cause instanceof Error && "code" in cause && typeof cause.code === "string") return cause.code;
  return "INTERNAL_ERROR";
}

function publicFailure(cause: unknown): unknown {
  if (cause instanceof PdfTextError) return new ApiFault("UNSUPPORTED_ASSET", cause.message);
  if (cause instanceof AiProviderError) {
    const code = cause.code === "PROVIDER_TIMEOUT" ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE";
    return new ApiFault(code, "The AI provider could not complete a grounded generation.", {
      retryable: cause.retryable,
    });
  }
  return cause;
}

function faultForPersistedFailure(errorCode: string): ApiFault {
  if (errorCode === "PROVIDER_TIMEOUT") {
    return new ApiFault("PROVIDER_TIMEOUT", "The AI provider did not respond before the generation timed out.", { retryable: true });
  }
  if (["PROVIDER_UNAVAILABLE", "MISSING_CREDENTIALS", "MISSING_MODEL_CONFIGURATION", "MODEL_OR_FEATURE_UNAVAILABLE"].includes(errorCode)) {
    return new ApiFault("PROVIDER_UNAVAILABLE", "The AI provider could not complete generation.", {
      retryable: errorCode === "PROVIDER_UNAVAILABLE",
    });
  }
  if (["PROVIDER_REFUSAL", "MALFORMED_OUTPUT", "UNSUPPORTED_CLAIM"].includes(errorCode)) {
    return new ApiFault("PROVIDER_UNAVAILABLE", "The AI provider did not produce a grounded generation.");
  }
  if (errorCode === "MAPPING_REQUIRED") return new ApiFault("MAPPING_REQUIRED", "Review the bend mapping before retrying generation.");
  if (errorCode === "UNSUPPORTED_ASSET" || errorCode.startsWith("PDF_")) {
    return new ApiFault("UNSUPPORTED_ASSET", "A source file could not be used for generation.");
  }
  if (errorCode === "VERSION_CONFLICT" || errorCode === "GENERATION_STALE") {
    return new ApiFault("VERSION_CONFLICT", "Job inputs changed; reload before retrying generation.");
  }
  if (errorCode === "REVIEW_REQUIRED") {
    return new ApiFault("REVIEW_REQUIRED", "Confirm the selected workshop profile before retrying generation.");
  }
  return new ApiFault("PROVIDER_UNAVAILABLE", "The prior generation request failed. Use a new idempotency key to retry.");
}
