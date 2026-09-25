import { assertExpectedVersion, DomainError } from "./errors";
import type { Actor, Draft, DraftContent, DraftContentInput, Review } from "./types";

/** A content edit is a new content version and invalidates both approvals. */
export function editDraft(draft: Draft, expectedVersion: number, content: DraftContent): Draft {
  assertExpectedVersion(draft.version, expectedVersion);
  return {
    ...draft,
    version: draft.version + 1,
    content,
    reviews: [],
  };
}

/** Converts contract v1.0's authority-free save shape into persisted content. */
export function editDraftFromInput(
  draft: Draft,
  expectedVersion: number,
  input: DraftContentInput,
): Draft {
  const findings: DraftContent["findings"] = input.findings.map((finding) => ({
    ...finding,
    disposition: "open",
    resolutionRecordId: null,
  }));

  const existingProposals = new Map(draft.content.machineProposals.map((proposal) => [proposal.id, proposal]));
  const machineProposals: DraftContent["machineProposals"] = input.machineProposals.map((proposal) => {
    const existing = existingProposals.get(proposal.id);
    const unchanged =
      existing &&
      existing.snapshotId === proposal.snapshotId &&
      existing.machineId === proposal.machineId &&
      input.workshopSnapshotId === draft.content.workshopSnapshotId &&
      input.machineId === draft.content.machineId &&
      proposal.snapshotId === input.workshopSnapshotId &&
      proposal.machineId === input.machineId &&
      existing.rationale === proposal.rationale &&
      JSON.stringify(existing.proposedBendOrder) === JSON.stringify(proposal.proposedBendOrder) &&
      JSON.stringify(existing.evidence) === JSON.stringify(proposal.evidence);
    return unchanged
      ? existing
      : { ...proposal, status: "proposed", decidedBy: null };
  });

  const priorModel = draft.content.panelModel;
  const nextModel = input.panelModel
    ? {
        ...input.panelModel,
        reviewed:
          priorModel !== null &&
          JSON.stringify({ ...priorModel, reviewed: false }) ===
            JSON.stringify({ ...input.panelModel, reviewed: false }),
      }
    : null;
  return editDraft(draft, expectedVersion, {
    ...input,
    panelModel: nextModel,
    findings,
    machineProposals,
  });
}

/** Reviews are independent records for the current content version, not edits. */
export function recordDraftReview(
  draft: Draft,
  expectedVersion: number,
  kind: Review["kind"],
  actor: Actor,
  at: string,
): Draft {
  assertExpectedVersion(draft.version, expectedVersion);
  if (actor.kind !== "member") {
    throw new DomainError("FORBIDDEN", "Release visitors cannot review drafts.");
  }
  const mayReview =
    actor.roles.includes("admin") ||
    (kind === "design" && actor.roles.includes("designer")) ||
    (kind === "process" && actor.roles.includes("fabricator"));
  if (!mayReview) throw new DomainError("FORBIDDEN", `This actor cannot record a ${kind} review.`);

  const review: Review = { kind, actorId: actor.id, draftVersion: draft.version, at };
  return {
    ...draft,
    reviews: [...draft.reviews.filter((existing) => existing.kind !== kind), review],
  };
}

export function matchingReviews(draft: Draft): Review[] {
  return draft.reviews.filter((review) => review.draftVersion === draft.version);
}

/** Publish/review code calls this after its other readiness checks. */
export function assertBothReviewsCurrent(draft: Draft): void {
  const reviews = matchingReviews(draft);
  const hasDesign = reviews.some((review) => review.kind === "design");
  const hasProcess = reviews.some((review) => review.kind === "process");
  if (!hasDesign || !hasProcess) {
    throw new DomainError("REVIEW_REQUIRED", "Both design and process reviews must match the current draft version.", {
      draftVersion: draft.version,
      missing: [!hasDesign ? "design" : null, !hasProcess ? "process" : null].filter(Boolean),
    });
  }
}
