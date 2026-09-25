import { DomainError } from "./errors";
import type { Actor, Draft, EvidenceRef, Machine, MachineProposal, WorkshopSnapshot } from "./types";

export type ProposalValidation = {
  valid: boolean;
  errors: string[];
  unresolvedApplicability: string[];
  applicableConstraints: Machine["approvedOrderConstraints"];
};

/** Checks a proposed order against known IDs and only the selected part-family constraints. */
export function validateMachineProposal(input: {
  proposal: MachineProposal;
  bends: { bendId: string }[];
  workshop: WorkshopSnapshot;
  machine: Machine;
  partFamily: string | null;
}): ProposalValidation {
  const { proposal, bends, workshop, machine, partFamily } = input;
  const errors: string[] = [];
  const unresolvedApplicability: string[] = [];
  if (proposal.snapshotId !== workshop.id || !workshop.machines.some((item) => item.id === machine.id)) {
    errors.push("The proposal machine and workshop snapshot do not match the selected setup.");
  }
  if (proposal.machineId !== machine.id) errors.push("The proposal names a different machine.");
  if (!workshop.confirmedBy || !workshop.confirmedAt) errors.push("The workshop snapshot must be confirmed.");
  if (!proposal.rationale.trim()) errors.push("A proposal requires an explanation.");
  if (proposal.evidence.length === 0) errors.push("A machine proposal requires source evidence.");

  const expected = bends.map((bend) => bend.bendId);
  const expectedSet = new Set(expected);
  const proposedSet = new Set(proposal.proposedBendOrder);
  if (expectedSet.size !== expected.length) errors.push("The draft contains duplicate bend IDs.");
  if (proposedSet.size !== proposal.proposedBendOrder.length) errors.push("The proposed order repeats a bend ID.");
  if (
    proposedSet.size !== expectedSet.size ||
    [...expectedSet].some((bendId) => !proposedSet.has(bendId)) ||
    [...proposedSet].some((bendId) => !expectedSet.has(bendId))
  ) {
    errors.push("The proposed order must include every draft bend exactly once.");
  }

  const applicableConstraints = machine.approvedOrderConstraints.filter((constraint) => {
    if (!partFamily) {
      unresolvedApplicability.push(constraint.noteId);
      return false;
    }
    return constraint.appliesToPartFamily === partFamily;
  });
  const positions = new Map(proposal.proposedBendOrder.map((bendId, index) => [bendId, index]));
  for (const constraint of applicableConstraints) {
    const note = machine.notes.find((item) => item.id === constraint.noteId);
    if (!note || note.confirmedBy === null) {
      errors.push(`Constraint ${constraint.noteId} is not backed by a confirmed machine note.`);
    }
    const before = positions.get(constraint.beforeBendId);
    const after = positions.get(constraint.afterBendId);
    if (before === undefined || after === undefined) {
      errors.push(`Constraint ${constraint.noteId} refers to a bend outside this draft.`);
    } else if (before >= after) {
      errors.push(`The proposed order violates confirmed constraint ${constraint.noteId}.`);
    }
    const cited = proposal.evidence.some(
      (evidence): evidence is Extract<EvidenceRef, { kind: "workshop_note" }> =>
        evidence.kind === "workshop_note" &&
        evidence.snapshotId === workshop.id &&
        evidence.machineId === machine.id &&
        evidence.noteId === constraint.noteId,
    );
    if (!cited) errors.push(`The proposal is missing evidence for constraint ${constraint.noteId}.`);
  }

  return { valid: errors.length === 0, errors, unresolvedApplicability, applicableConstraints };
}

/** Decisions are server-authored. Acceptance changes content/order and invalidates reviews. */
export function decideMachineProposal(input: {
  draft: Draft;
  expectedVersion: number;
  proposalId: string;
  decision: "accept" | "reject";
  actor: Actor;
  workshop: WorkshopSnapshot;
  machine: Machine;
  partFamily: string | null;
}): Draft {
  const { draft, expectedVersion, proposalId, decision, actor, workshop, machine, partFamily } = input;
  if (draft.version !== expectedVersion) {
    throw new DomainError("VERSION_CONFLICT", "The draft changed before the proposal decision.", {
      expectedVersion,
      currentVersion: draft.version,
    });
  }
  if (actor.kind !== "member" || !(actor.roles.includes("admin") || actor.roles.includes("fabricator"))) {
    throw new DomainError("FORBIDDEN", "Only a fabricator or admin can decide a machine proposal.");
  }
  const proposal = draft.content.machineProposals.find((item) => item.id === proposalId);
  if (!proposal) throw new DomainError("NOT_FOUND", "Machine proposal not found.");
  if (proposal.status !== "proposed") throw new DomainError("VERSION_CONFLICT", "This proposal was already decided.");

  if (decision === "reject") {
    return {
      ...draft,
      content: {
        ...draft.content,
        machineProposals: draft.content.machineProposals.map((item) =>
          item.id === proposalId ? { ...item, status: "rejected", decidedBy: actor.id } : item,
        ),
      },
    };
  }

  const validation = validateMachineProposal({
    proposal,
    bends: draft.content.bends,
    workshop,
    machine,
    partFamily,
  });
  if (!validation.valid) {
    throw new DomainError("VALIDATION_FAILED", "The machine proposal fails deterministic setup validation.", {
      errors: validation.errors,
    });
  }
  if (validation.unresolvedApplicability.some((noteId) => !hasOpenApplicabilityFinding(draft, noteId, workshop.id, machine.id))) {
    throw new DomainError("REVIEW_REQUIRED", "Unknown constraint applicability must remain visible as a review finding.", {
      noteIds: validation.unresolvedApplicability,
    });
  }
  const stepsByBend = new Map(draft.content.steps.map((step) => [step.bendId, step]));
  if (stepsByBend.size !== draft.content.steps.length || proposal.proposedBendOrder.some((bendId) => !stepsByBend.has(bendId))) {
    throw new DomainError("VALIDATION_FAILED", "The current step list cannot be reordered by the proposed bend IDs.");
  }
  return {
    ...draft,
    version: draft.version + 1,
    reviews: [],
    content: {
      ...draft.content,
      steps: proposal.proposedBendOrder.map((bendId) => stepsByBend.get(bendId)!),
      machineProposals: draft.content.machineProposals.map((item) =>
        item.id === proposalId ? { ...item, status: "accepted", decidedBy: actor.id } : item,
      ),
    },
  };
}

function hasOpenApplicabilityFinding(
  draft: Draft,
  noteId: string,
  snapshotId: string,
  machineId: string,
): boolean {
  return draft.content.findings.some((finding) =>
    finding.kind === "capability" &&
    finding.severity === "review" &&
    finding.disposition === "open" &&
    finding.evidence.some((evidence) =>
      evidence.kind === "workshop_note" &&
      evidence.snapshotId === snapshotId &&
      evidence.machineId === machineId &&
      evidence.noteId === noteId,
    ),
  );
}
