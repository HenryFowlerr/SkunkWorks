import { DomainError } from "./errors";
import type { ContextRef, Draft, Release } from "./types";

export type ContextResource =
  | { kind: "draft"; draft: Draft }
  | { kind: "release"; release: Release };

/** The caller loads the resource from persistence; IDs and step labels are never trusted alone. */
export function validateContext(
  context: ContextRef,
  resource: ContextResource,
  surface: "studio" | "floor",
): ContextRef {
  const hasRelease = context.releaseId !== null;
  const hasDraft = context.draftId !== null;
  if (hasRelease === hasDraft) {
    throw new DomainError("VALIDATION_FAILED", "Context must identify exactly one draft or release.");
  }

  let content: Draft["content"];
  if (hasRelease) {
    if (resource.kind !== "release") throw new DomainError("NOT_FOUND", "The selected release was not loaded.");
    if (resource.release.id !== context.releaseId || resource.release.jobId !== context.jobId) {
      throw new DomainError("NOT_FOUND", "The release does not belong to this job.");
    }
    if (context.draftVersion !== null) {
      throw new DomainError("VALIDATION_FAILED", "Release context cannot include a draft version.");
    }
    content = resource.release.snapshot;
  } else {
    if (surface === "floor" || resource.kind !== "draft") {
      throw new DomainError("VALIDATION_FAILED", "Draft context is available only in the studio.");
    }
    if (resource.draft.id !== context.draftId || resource.draft.jobId !== context.jobId) {
      throw new DomainError("NOT_FOUND", "The draft does not belong to this job.");
    }
    if (context.draftVersion === null || context.draftVersion !== resource.draft.version) {
      throw new DomainError("VERSION_CONFLICT", "Draft context must identify its current version.", {
        expectedVersion: context.draftVersion,
        currentVersion: resource.draft.version,
      });
    }
    content = resource.draft.content;
  }

  if (context.stepId !== null) {
    const step = content.steps.find((item) => item.id === context.stepId);
    if (!step) throw new DomainError("VALIDATION_FAILED", "The step is not part of the selected context.");
    if (context.bendId !== step.bendId) {
      throw new DomainError("VALIDATION_FAILED", "The bend ID does not match the selected step.");
    }
  }
  if (context.bendId !== null && !content.bends.some((bend) => bend.bendId === context.bendId)) {
    throw new DomainError("VALIDATION_FAILED", "The bend is not part of the selected context.");
  }
  return { ...context };
}
