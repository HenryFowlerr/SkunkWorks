import { DomainError } from "./errors";
import type { Draft, DraftContent, Generation, Job } from "./types";

export type GenerationGuardInput = {
  generation: Generation;
  job: Job;
  currentDraft: Draft | null;
  expectedJobVersion: number;
  baseDraftVersion: number | null;
  currentInputFingerprint: string;
  now: string;
};

export type GenerationGuardDecision =
  | { apply: true; nextDraftVersion: number }
  | { apply: false; reason: "expired" | "job_changed" | "inputs_changed" | "draft_edited" | "not_running" };

/** Call inside the same transaction that persists the generated draft result. */
export function guardGenerationResult(input: GenerationGuardInput): GenerationGuardDecision {
  const { generation, job, currentDraft, expectedJobVersion, baseDraftVersion, now } = input;
  if (generation.state !== "running") return { apply: false, reason: "not_running" };
  if (Date.parse(generation.expiresAt) <= Date.parse(now)) return { apply: false, reason: "expired" };
  if (generation.jobId !== job.id || job.version !== expectedJobVersion) return { apply: false, reason: "job_changed" };
  if (
    !generation.inputFingerprint ||
    generation.inputFingerprint !== input.currentInputFingerprint ||
    (currentDraft && currentDraft.inputFingerprint !== generation.inputFingerprint)
  ) {
    return { apply: false, reason: "inputs_changed" };
  }
  if ((currentDraft?.version ?? null) !== baseDraftVersion) return { apply: false, reason: "draft_edited" };
  return { apply: true, nextDraftVersion: (currentDraft?.version ?? 0) + 1 };
}

export function applyGenerationResult(input: {
  job: Job;
  generation: Generation;
  currentDraft: Draft | null;
  expectedJobVersion: number;
  baseDraftVersion: number | null;
  currentInputFingerprint: string;
  now: string;
  draftId: string;
  content: DraftContent;
}): Draft {
  const { generation, currentDraft, draftId, content } = input;
  const decision = guardGenerationResult(input);
  if (!decision.apply) {
    throw new DomainError("GENERATION_STALE", "The generation result is stale and cannot replace current work.", {
      reason: decision.reason,
    });
  }
  return {
    id: currentDraft?.id ?? draftId,
    jobId: generation.jobId,
    version: decision.nextDraftVersion,
    content: {
      ...content,
      panelModel: content.panelModel ? { ...content.panelModel, reviewed: false } : null,
      findings: content.findings.map((finding) => ({ ...finding, disposition: "open", resolutionRecordId: null })),
      machineProposals: content.machineProposals.map((proposal) => ({ ...proposal, status: "proposed", decidedBy: null })),
    },
    reviews: [],
    generationId: generation.id,
    inputFingerprint: generation.inputFingerprint,
  };
}

export type GenerationCompletionState = {
  generation: Generation;
  job: Job;
  currentDraft: Draft | null;
  expectedJobVersion: number;
  baseDraftVersion: number | null;
  currentInputFingerprint: string;
};

/** Adapter locks the generation, job, and current draft until the callback commits. */
export interface GenerationCompletionTransaction {
  lockGenerationCompletion(generationId: string): Promise<GenerationCompletionState | null>;
  /** Atomically persists the next draft, generation success, and current job draft pointer. */
  commitGenerationSuccess(input: { generation: Generation; draft: Draft }): Promise<void>;
  /** Atomically marks stale work expired; it must not write generated content. */
  markGenerationExpired(input: { generation: Generation; reason: Exclude<GenerationGuardDecision, { apply: true }>["reason"] }): Promise<void>;
}

export interface GenerationCompletionPersistence {
  transaction<T>(work: (transaction: GenerationCompletionTransaction) => Promise<T>): Promise<T>;
}

/** Persist result only after rechecking versions/fingerprint under the persistence lock. */
export async function completeGenerationResult(
  persistence: GenerationCompletionPersistence,
  input: { generationId: string; draftId: string; content: DraftContent; now: string },
): Promise<{ applied: true; draft: Draft } | { applied: false; reason: string }> {
  return persistence.transaction(async (transaction) => {
    const state = await transaction.lockGenerationCompletion(input.generationId);
    if (!state) throw new DomainError("GENERATION_STALE", "Generation completion context is no longer available.");
    const guardInput = { ...state, now: input.now };
    const decision = guardGenerationResult(guardInput);
    if (!decision.apply) {
      await transaction.markGenerationExpired({
        generation: { ...state.generation, state: "expired", draftVersion: null, errorCode: null },
        reason: decision.reason,
      });
      return { applied: false, reason: decision.reason };
    }
    const draft = applyGenerationResult({ ...guardInput, draftId: input.draftId, content: input.content });
    const generation: Generation = {
      ...state.generation,
      state: "succeeded",
      draftVersion: draft.version,
      errorCode: null,
    };
    await transaction.commitGenerationSuccess({ generation, draft });
    return { applied: true, draft };
  });
}
