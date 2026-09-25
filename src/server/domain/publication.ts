import { assertBothReviewsCurrent } from "./drafts";
import { assertExpectedVersion, DomainError } from "./errors";
import { stablePayloadHash } from "./idempotency";
import type { Asset, Draft, Job, Release, WorkshopSnapshot } from "./types";

export type PublicationState = {
  job: Job;
  draft: Draft;
  assets: Asset[];
  workshop: WorkshopSnapshot | null;
  currentInputFingerprint: string;
  geometryValid: boolean;
  evidenceValid: boolean;
};

/** Pure final gate; geometry and source-pointer validators supply their own verified result. */
export function assertPublishable(state: PublicationState, expectedDraftVersion: number): void {
  const { job, draft, workshop } = state;
  assertExpectedVersion(draft.version, expectedDraftVersion);
  if (job.draftId !== draft.id || draft.jobId !== job.id) {
    throw new DomainError("VERSION_CONFLICT", "The draft is no longer the current draft for this job.");
  }
  if (!job.workshopSnapshotId || !job.machineId || !workshop) {
    throw new DomainError("REVIEW_REQUIRED", "Select and confirm a workshop setup before publication.");
  }
  if (
    workshop.id !== job.workshopSnapshotId ||
    workshop.workspaceId !== job.workspaceId ||
    draft.content.workshopSnapshotId !== workshop.id ||
    draft.content.machineId !== job.machineId ||
    !workshop.machines.some((machine) => machine.id === job.machineId)
  ) {
    throw new DomainError("VERSION_CONFLICT", "The draft setup differs from the current job setup.");
  }
  if (!workshop.confirmedBy || !workshop.confirmedAt) {
    throw new DomainError("REVIEW_REQUIRED", "The selected workshop snapshot has not been confirmed.");
  }
  if (state.currentInputFingerprint !== draft.inputFingerprint) {
    throw new DomainError("VERSION_CONFLICT", "The draft was generated from different source or setup inputs.");
  }

  const selectedIds = new Set(job.sourceAssetIds);
  if (selectedIds.size === 0) {
    throw new DomainError("REVIEW_REQUIRED", "At least one verified source drawing is required for publication.");
  }
  const draftIds = new Set(draft.content.sourceAssetIds);
  if (selectedIds.size !== draftIds.size || [...selectedIds].some((id) => !draftIds.has(id))) {
    throw new DomainError("VERSION_CONFLICT", "The draft source assets differ from the current job inputs.");
  }
  const assetsById = new Map(state.assets.map((asset) => [asset.id, asset]));
  const unready = [...selectedIds].filter((id) => {
    const asset = assetsById.get(id);
    return !asset || asset.jobId !== job.id || asset.releaseId !== null || asset.status !== "ready";
  });
  if (unready.length) {
    throw new DomainError("REVIEW_REQUIRED", "Every selected source asset must be verified and ready.", { assetIds: unready });
  }
  if (![...selectedIds].some((id) => assetsById.get(id)?.kind === "drawing_pdf")) {
    throw new DomainError("REVIEW_REQUIRED", "The selected source assets must include the drawing PDF.");
  }
  if (!draft.content.panelModel || !draft.content.panelModel.reviewed || !state.geometryValid) {
    throw new DomainError("MAPPING_REQUIRED", "A valid, reviewed panel and hinge mapping is required.");
  }
  if (!state.evidenceValid) {
    throw new DomainError("REVIEW_REQUIRED", "Source evidence must be validated before publication.");
  }

  const bendIds = draft.content.bends.map((bend) => bend.bendId);
  const stepBendIds = draft.content.steps.map((step) => step.bendId);
  if (
    new Set(bendIds).size !== bendIds.length ||
    new Set(stepBendIds).size !== stepBendIds.length ||
    stepBendIds.length !== bendIds.length ||
    bendIds.some((bendId) => !stepBendIds.includes(bendId))
  ) {
    throw new DomainError("MAPPING_REQUIRED", "Every numbered bend must map to exactly one ordered step.");
  }
  const hingeIds = new Set(draft.content.panelModel.hinges.map((hinge) => hinge.id));
  for (const bend of draft.content.bends) {
    const rotation = bend.foldRotationDeg;
    if (
      !bend.hingeId ||
      !hingeIds.has(bend.hingeId) ||
      rotation.value === null ||
      rotation.evidenceState !== "supported" ||
      rotation.evidence.length === 0 ||
      !Number.isFinite(rotation.value)
    ) {
      throw new DomainError("MAPPING_REQUIRED", `Bend ${bend.bendId} needs a mapped hinge and supported signed fold rotation.`, {
        bendId: bend.bendId,
      });
    }
    for (const [field, sourcedValue] of [
      ["finishedAngle", bend.finishedAngle],
      ["insideRadiusMm", bend.insideRadiusMm],
      ["directionText", bend.directionText],
    ] as const) {
      if (
        sourcedValue.value !== null &&
        (sourcedValue.evidenceState !== "supported" || sourcedValue.evidence.length === 0)
      ) {
        throw new DomainError("REVIEW_REQUIRED", `Bend ${bend.bendId} has an unsupported ${field} value.`, {
          bendId: bend.bendId,
          field,
        });
      }
    }
  }
  const openBlockers = draft.content.findings.filter(
    (finding) => finding.severity === "blocking" && finding.disposition === "open",
  );
  if (openBlockers.length) {
    throw new DomainError("REVIEW_REQUIRED", "Resolve all blocking findings before publication.", {
      findingIds: openBlockers.map((finding) => finding.id),
    });
  }
  if (draft.content.machineProposals.some((proposal) => proposal.status === "proposed")) {
    throw new DomainError("REVIEW_REQUIRED", "Decide each machine sequence proposal before publication.");
  }
  assertBothReviewsCurrent(draft);
}

export type PublishedIdempotency = {
  actorId: string;
  operation: "release.publish";
  key: string;
  payloadHash: string;
  releaseId: string;
};

export type PublicationAggregate = PublicationState & {
  latestRelease: Release | null;
};

/** Persistence adapter must lock the job/draft/current predecessor for the transaction. */
export interface PublicationTransaction {
  lockPublication(jobId: string): Promise<PublicationAggregate | null>;
  getIdempotency(actorId: string, operation: "release.publish", key: string): Promise<PublishedIdempotency | null>;
  getReleaseByIdempotency(releaseId: string): Promise<Release | null>;
  commitPublication(input: { release: Release; idempotency: PublishedIdempotency }): Promise<void>;
}
export interface PublicationPersistence {
  transaction<T>(work: (transaction: PublicationTransaction) => Promise<T>): Promise<T>;
}

export type PublishCommand = {
  jobId: string;
  expectedDraftVersion: number;
  supersedesReleaseId: string | null;
  allowPredecessorVisitors: boolean;
  actorId: string;
  idempotencyKey: string;
  publishedAt: string;
};

/** Atomic, idempotent orchestration over a persistence transaction interface. */
export async function publishRelease(
  persistence: PublicationPersistence,
  command: PublishCommand,
  createId: () => string,
): Promise<Release> {
  if (!command.idempotencyKey.trim()) {
    throw new DomainError("VALIDATION_FAILED", "Publication requires an idempotency key.");
  }
  const payloadHash = stablePayloadHash({
      jobId: command.jobId,
      expectedDraftVersion: command.expectedDraftVersion,
      supersedesReleaseId: command.supersedesReleaseId,
      allowPredecessorVisitors: command.allowPredecessorVisitors,
    });

  return persistence.transaction(async (transaction) => {
    const previousAttempt = await transaction.getIdempotency(command.actorId, "release.publish", command.idempotencyKey);
    if (previousAttempt) {
      if (previousAttempt.payloadHash !== payloadHash) {
        throw new DomainError("IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for a different publication request.");
      }
      const priorRelease = await transaction.getReleaseByIdempotency(previousAttempt.releaseId);
      if (!priorRelease) throw new DomainError("VALIDATION_FAILED", "Publication retry record has no release.");
      return priorRelease;
    }

    const aggregate = await transaction.lockPublication(command.jobId);
    if (!aggregate) throw new DomainError("NOT_FOUND", "Job or draft not found.");
    assertPublishable(aggregate, command.expectedDraftVersion);
    const latest = aggregate.latestRelease;
    if ((latest?.id ?? null) !== command.supersedesReleaseId) {
      throw new DomainError("VERSION_CONFLICT", "Only the current published release can be superseded.", {
        expectedSupersedesReleaseId: latest?.id ?? null,
        suppliedSupersedesReleaseId: command.supersedesReleaseId,
      });
    }
    if (latest && latest.jobId !== aggregate.job.id) {
      throw new DomainError("VALIDATION_FAILED", "A release from another job cannot be superseded.");
    }

    const release: Release = deepFreeze({
      id: createId(),
      jobId: aggregate.job.id,
      revisionNumber: (latest?.revisionNumber ?? 0) + 1,
      snapshot: structuredClone(aggregate.draft.content),
      sourceDraftVersion: aggregate.draft.version,
      reviews: structuredClone(aggregate.draft.reviews.filter((review) => review.draftVersion === aggregate.draft.version)),
      publishedAt: command.publishedAt,
      publishedBy: command.actorId,
      supersedesReleaseId: latest?.id ?? null,
      allowPredecessorVisitors: command.allowPredecessorVisitors,
    });
    await transaction.commitPublication({
      release,
      idempotency: {
        actorId: command.actorId,
        operation: "release.publish",
        key: command.idempotencyKey,
        payloadHash,
        releaseId: release.id,
      },
    });
    return release;
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
