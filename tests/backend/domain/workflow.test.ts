import { describe, expect, it } from "vitest";
import { assertCanFollowReplacement, followReplacement, releaseViewAccess } from "../../../src/server/access/release-access";
import { acknowledgeFlag, createReleaseFlag, createReleaseFlagIdempotently, respondToFlag, type FlagPersistence, type FlagTransaction } from "../../../src/server/domain/flags";
import { guardGenerationResult, applyGenerationResult } from "../../../src/server/domain/generations";
import { DomainError } from "../../../src/server/domain/errors";
import { decideMachineProposal, validateMachineProposal } from "../../../src/server/domain/machine-proposals";
import {
  assertPublishable,
  publishRelease,
  type PublicationAggregate,
  type PublicationPersistence,
  type PublicationTransaction,
  type PublishedIdempotency,
} from "../../../src/server/domain/publication";
import { editDraft, editDraftFromInput, recordDraftReview } from "../../../src/server/domain/drafts";
import { validateContext } from "../../../src/server/domain/contexts";
import type {
  Actor,
  Asset,
  Bend,
  ContextRef,
  Draft,
  DraftContent,
  DraftContentInput,
  Flag,
  Generation,
  Job,
  Machine,
  MachineProposal,
  Release,
  WorkshopSnapshot,
} from "../../../src/server/domain/types";

const designer: Actor = { id: "designer-1", displayName: "Designer", kind: "member", roles: ["designer"] };
const fabricator: Actor = { id: "fabricator-1", displayName: "Fabricator", kind: "member", roles: ["fabricator"] };
const visitor: Actor = { id: "visitor-1", displayName: "Visitor", kind: "release_visitor", roles: [] };

function sourced<T>(value: T | null, evidenceState: "supported" | "not_found" = "supported") {
  return {
    value,
    evidence: value === null ? [] : [{ kind: "document" as const, assetId: "drawing-1", page: 1, region: null, excerpt: "source" }],
    evidenceState,
    originalText: value === null ? null : String(value),
  };
}

function bend(bendId: string): Bend {
  return {
    bendId,
    hingeId: `hinge-${bendId}`,
    finishedAngle: sourced({ degrees: 90, convention: "internal" as const }),
    foldRotationDeg: sourced(90),
    insideRadiusMm: sourced(null, "not_found"),
    directionText: sourced(null, "not_found"),
  };
}

function makeContent(order: string[] = ["B1", "B2"]): DraftContent {
  const bends = [bend("B1"), bend("B2")];
  return {
    sourceAssetIds: ["drawing-1"],
    workshopSnapshotId: "snapshot-1",
    machineId: "machine-1",
    panelModel: {
      schemaVersion: "1.0",
      units: "mm",
      thicknessMm: 1,
      rootPanelId: "root",
      panels: [
        { id: "root", polygonMm: [[0, 0], [1, 0], [1, 1], [0, 1]] },
        { id: "panel-1", polygonMm: [[0, 0], [1, 0], [1, -1], [0, -1]] },
        { id: "panel-2", polygonMm: [[0, -1], [1, -1], [1, -2], [0, -2]] },
      ],
      hinges: [
        { id: "hinge-B1", parentPanelId: "root", childPanelId: "panel-1", axisStartMm: [0, 0], axisEndMm: [1, 0] },
        { id: "hinge-B2", parentPanelId: "panel-1", childPanelId: "panel-2", axisStartMm: [0, -1], axisEndMm: [1, -1] },
      ],
      origin: "reviewer_mapped",
      referenceFaceLabel: "front",
      reviewed: true,
    },
    bends,
    steps: order.map((bendId) => ({
      id: `step-${bendId}`,
      bendId,
      instruction: `Form ${bendId}`,
      evidence: [{ kind: "document", assetId: "drawing-1", page: 1, region: null, excerpt: bendId }],
      camera: null,
    })),
    findings: [],
    machineProposals: [],
  };
}

function makeDraft(content = makeContent(), reviews: Draft["reviews"] = []): Draft {
  return {
    id: "draft-1",
    jobId: "job-1",
    version: 4,
    content,
    reviews,
    generationId: null,
    inputFingerprint: "fingerprint-1",
  };
}

function reviewDraft(draft: Draft): Draft {
  return recordDraftReview(
    recordDraftReview(draft, draft.version, "design", designer, "2026-09-26T10:00:00.000Z"),
    draft.version,
    "process",
    fabricator,
    "2026-09-26T10:01:00.000Z",
  );
}

const asset: Asset = {
  id: "drawing-1",
  jobId: "job-1",
  releaseId: null,
  kind: "drawing_pdf",
  filename: "drawing.pdf",
  mimeType: "application/pdf",
  byteSize: 12,
  sha256: "hash",
  version: 1,
  status: "ready",
  drawingRevision: "A",
};
const machine: Machine = {
  id: "machine-1",
  name: "Brake 1",
  process: "press_brake",
  model: null,
  usableBendLengthMm: sourced(null, "not_found"),
  tools: [],
  notes: [{
    id: "note-1",
    text: "B1 before B2",
    authorId: fabricator.id,
    createdAt: "2026-09-25T10:00:00.000Z",
    source: null,
    confirmedBy: fabricator.id,
  }],
  approvedOrderConstraints: [{ beforeBendId: "B1", afterBendId: "B2", appliesToPartFamily: "bracket", noteId: "note-1" }],
};
const workshop: WorkshopSnapshot = {
  id: "snapshot-1",
  workshopId: "workshop-1",
  workspaceId: "workspace-1",
  version: 2,
  name: "Workshop",
  machines: [machine],
  confirmedBy: fabricator.id,
  confirmedAt: "2026-09-25T10:00:00.000Z",
};
const job: Job = {
  id: "job-1",
  workspaceId: "workspace-1",
  title: "Bracket",
  partNumber: "P-1",
  partFamily: "bracket",
  version: 7,
  workshopSnapshotId: workshop.id,
  machineId: machine.id,
  sourceAssetIds: [asset.id],
  draftId: "draft-1",
  latestReleaseId: null,
  createdAt: "2026-09-25T10:00:00.000Z",
};

function publishAggregate(draft = reviewDraft(makeDraft())): PublicationAggregate {
  return {
    job,
    draft,
    assets: [asset],
    workshop,
    currentInputFingerprint: "fingerprint-1",
    geometryValid: true,
    evidenceValid: true,
    latestRelease: null,
  };
}

function release(overrides: Partial<Release> = {}): Release {
  return {
    id: "release-1",
    jobId: job.id,
    revisionNumber: 1,
    snapshot: makeContent(),
    sourceDraftVersion: 4,
    reviews: [],
    publishedAt: "2026-09-26T10:00:00.000Z",
    publishedBy: designer.id,
    supersedesReleaseId: null,
    allowPredecessorVisitors: false,
    ...overrides,
  };
}

function expectCode(action: () => unknown, code: string) {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}

describe("draft lifecycle", () => {
  it("returns a version conflict instead of accepting a stale edit", () => {
    expectCode(() => editDraft(makeDraft(), 3, makeContent()), "VERSION_CONFLICT");
  });

  it("keeps the other matching review when one review is recorded", () => {
    const first = recordDraftReview(makeDraft(), 4, "design", designer, "now");
    const second = recordDraftReview(first, 4, "process", fabricator, "later");
    expect(second.version).toBe(4);
    expect(second.reviews.map((item) => item.kind).sort()).toEqual(["design", "process"]);
  });

  it("invalidates both approvals after an edit", () => {
    const reviewed = reviewDraft(makeDraft());
    const edited = editDraft(reviewed, 4, makeContent(["B2", "B1"]));
    expect(edited.version).toBe(5);
    expect(edited.reviews).toEqual([]);
  });

  it("does not accept authority-bearing draft save fields from a client", () => {
    const current = makeDraft({
      ...makeContent(),
      findings: [{ id: "finding-1", kind: "missing_data", severity: "review", bendId: null, message: "Clarified", evidence: [], disposition: "resolved", resolutionRecordId: "clarification-1" }],
      machineProposals: [{
        id: "proposal-1", snapshotId: workshop.id, machineId: machine.id, proposedBendOrder: ["B1", "B2"],
        rationale: "Confirmed", evidence: [], status: "accepted", decidedBy: fabricator.id,
      }],
    });
    const input: DraftContentInput = {
      ...current.content,
      panelModel: current.content.panelModel ? {
        schemaVersion: current.content.panelModel.schemaVersion,
        units: current.content.panelModel.units,
        thicknessMm: current.content.panelModel.thicknessMm,
        rootPanelId: current.content.panelModel.rootPanelId,
        panels: current.content.panelModel.panels,
        hinges: current.content.panelModel.hinges,
        origin: current.content.panelModel.origin,
        referenceFaceLabel: current.content.panelModel.referenceFaceLabel,
      } : null,
      findings: current.content.findings.map((finding) => ({
        id: finding.id, kind: finding.kind, severity: finding.severity, bendId: finding.bendId,
        message: finding.message, evidence: finding.evidence,
      })),
      machineProposals: current.content.machineProposals.map((proposal) => ({
        id: proposal.id, snapshotId: proposal.snapshotId, machineId: proposal.machineId,
        proposedBendOrder: proposal.proposedBendOrder, rationale: proposal.rationale, evidence: proposal.evidence,
      })),
    };
    const saved = editDraftFromInput(current, current.version, input);
    expect(saved.content.findings[0]).toMatchObject({ disposition: "open", resolutionRecordId: null });
    expect(saved.content.machineProposals[0]).toMatchObject({ status: "accepted", decidedBy: fabricator.id });
    expect(saved.content.panelModel?.reviewed).toBe(true);
  });

  it("does not allow visitor reviews", () => {
    expectCode(() => recordDraftReview(makeDraft(), 4, "design", visitor, "now"), "FORBIDDEN");
  });
});

describe("exact context binding", () => {
  it("rejects a step whose bend label was swapped by the client", () => {
    const draft = makeDraft();
    const context: ContextRef = {
      jobId: draft.jobId,
      releaseId: null,
      draftId: draft.id,
      draftVersion: draft.version,
      stepId: "step-B1",
      bendId: "B2",
    };
    expectCode(() => validateContext(context, { kind: "draft", draft }, "studio"), "VALIDATION_FAILED");
  });

  it("requires floor flags to reference a release and its exact step", () => {
    const released = release();
    const context: ContextRef = {
      jobId: job.id,
      releaseId: released.id,
      draftId: null,
      draftVersion: null,
      stepId: "step-B2",
      bendId: "B2",
    };
    expect(validateContext(context, { kind: "release", release: released }, "floor")).toEqual(context);
    expectCode(() => validateContext({ ...context, draftId: "draft-1" }, { kind: "release", release: released }, "floor"), "VALIDATION_FAILED");
  });

  it("rejects stale draft context", () => {
    const draft = makeDraft();
    expectCode(() => validateContext({
      jobId: draft.jobId, releaseId: null, draftId: draft.id, draftVersion: 3, stepId: null, bendId: null,
    }, { kind: "draft", draft }, "studio"), "VERSION_CONFLICT");
  });
});

describe("machine proposal validation and decision", () => {
  function proposal(order: string[], evidence = [{ kind: "workshop_note" as const, snapshotId: workshop.id, machineId: machine.id, noteId: "note-1" }]): MachineProposal {
    return {
      id: "proposal-1",
      snapshotId: workshop.id,
      machineId: machine.id,
      proposedBendOrder: order,
      rationale: "Documented setup constraint",
      evidence,
      status: "proposed",
      decidedBy: null,
    };
  }

  it("enforces applicable constraints and requires their source note", () => {
    expect(validateMachineProposal({ proposal: proposal(["B1", "B2"]), bends: [bend("B1"), bend("B2")], workshop, machine, partFamily: "bracket" }).valid).toBe(true);
    const invalid = validateMachineProposal({ proposal: proposal(["B2", "B1"]), bends: [bend("B1"), bend("B2")], workshop, machine, partFamily: "bracket" });
    expect(invalid.errors.some((error) => error.includes("violates"))).toBe(true);
    const missingEvidence = validateMachineProposal({ proposal: proposal(["B1", "B2"], []), bends: [bend("B1"), bend("B2")], workshop, machine, partFamily: "bracket" });
    expect(missingEvidence.errors.some((error) => error.includes("missing evidence"))).toBe(true);
  });

  it("surfaces unknown family applicability instead of assuming it applies", () => {
    const result = validateMachineProposal({ proposal: proposal(["B2", "B1"]), bends: [bend("B1"), bend("B2")], workshop, machine, partFamily: null });
    expect(result.valid).toBe(true);
    expect(result.unresolvedApplicability).toEqual(["note-1"]);
  });

  it("acceptance reorders existing steps and invalidates approvals", () => {
    const draft = reviewDraft(makeDraft());
    const content = { ...draft.content, machineProposals: [proposal(["B2", "B1"])] };
    const unconstrainedMachine = { ...machine, approvedOrderConstraints: [] };
    const result = decideMachineProposal({
      draft: { ...draft, content }, expectedVersion: draft.version, proposalId: "proposal-1", decision: "accept", actor: fabricator, workshop: { ...workshop, machines: [unconstrainedMachine] }, machine: unconstrainedMachine, partFamily: "bracket",
    });
    expect(result.content.steps.map((step) => step.id)).toEqual(["step-B2", "step-B1"]);
    expect(result.content.machineProposals[0].decidedBy).toBe(fabricator.id);
    expect(result.version).toBe(5);
    expect(result.reviews).toEqual([]);
  });

  it("rejection records a decision without changing order or review version", () => {
    const draft = reviewDraft(makeDraft());
    const content = { ...draft.content, machineProposals: [proposal(["B2", "B1"])] };
    const result = decideMachineProposal({ draft: { ...draft, content }, expectedVersion: 4, proposalId: "proposal-1", decision: "reject", actor: fabricator, workshop, machine, partFamily: "bracket" });
    expect(result.content.steps.map((step) => step.bendId)).toEqual(["B1", "B2"]);
    expect(result.version).toBe(4);
    expect(result.reviews).toHaveLength(2);
  });
});

describe("publication gate and transaction semantics", () => {
  it("blocks a publish after source fingerprint drift", () => {
    expectCode(() => assertPublishable({ ...publishAggregate(), currentInputFingerprint: "new-inputs" }, 4), "VERSION_CONFLICT");
  });

  it("blocks publication until both current reviews exist", () => {
    const oneReview = recordDraftReview(makeDraft(), 4, "design", designer, "now");
    expectCode(() => assertPublishable(publishAggregate(oneReview), 4), "REVIEW_REQUIRED");
  });

  it("publishes once under retries and returns the same immutable release", async () => {
    const memory = new MemoryPublicationStore(publishAggregate());
    const command = {
      jobId: job.id,
      expectedDraftVersion: 4,
      supersedesReleaseId: null,
      allowPredecessorVisitors: false,
      actorId: designer.id,
      idempotencyKey: "publish-1",
      publishedAt: "2026-09-26T11:00:00.000Z",
    };
    const [first, retry] = await Promise.all([
      publishRelease(memory, command, () => "release-new"),
      publishRelease(memory, command, () => "should-not-be-used"),
    ]);
    expect(first.id).toBe("release-new");
    expect(retry.id).toBe(first.id);
    expect(memory.commits).toBe(1);
    expect(Object.isFrozen(first.snapshot)).toBe(true);
  });

  it("rejects idempotency-key payload changes and stale predecessor publication", async () => {
    const memory = new MemoryPublicationStore(publishAggregate());
    const command = {
      jobId: job.id, expectedDraftVersion: 4, supersedesReleaseId: null, allowPredecessorVisitors: false,
      actorId: designer.id, idempotencyKey: "same-key", publishedAt: "2026-09-26T11:00:00.000Z",
    };
    await publishRelease(memory, command, () => "release-new");
    await expect(publishRelease(memory, { ...command, allowPredecessorVisitors: true }, () => "other")).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    await expect(publishRelease(memory, { ...command, idempotencyKey: "new-key" }, () => "other")).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  });
});

describe("release successor access", () => {
  const predecessor = release();
  const successor = release({ id: "release-2", revisionNumber: 2, supersedesReleaseId: predecessor.id, allowPredecessorVisitors: true });
  const accessContext = {
    sourceRelease: predecessor,
    successor,
    actor: visitor,
    visitorSession: {
      id: "session-1",
      state: "active" as const,
      expiresAt: "2026-09-27T00:00:00.000Z",
      revokedAt: null,
    },
    checkedAt: "2026-09-26T00:00:00.000Z",
    sessionReleaseId: predecessor.id,
    accessLink: { id: "link-1", releaseId: predecessor.id, revokedAt: null },
  };

  it("shows follow only for an allowed direct same-job successor", () => {
    expect(releaseViewAccess(predecessor, successor)).toEqual({ replacementReleaseId: successor.id, canFollowReplacement: true });
    expect(releaseViewAccess(predecessor, release({ id: "other", jobId: "job-2", supersedesReleaseId: predecessor.id, allowPredecessorVisitors: true }))).toEqual({ replacementReleaseId: null, canFollowReplacement: false });
  });

  it("requires explicit access policy and an unrevoked original link", () => {
    expect(() => assertCanFollowReplacement(accessContext)).not.toThrow();
    expectCode(() => assertCanFollowReplacement({ ...accessContext, successor: release({ id: "release-2", supersedesReleaseId: predecessor.id }) }), "FORBIDDEN");
    expectCode(() => assertCanFollowReplacement({ ...accessContext, accessLink: { ...accessContext.accessLink, revokedAt: "now" } }), "RELEASE_REVOKED");
  });

  it("rejects revoked and expired visitor sessions even when the adapter marks them active", () => {
    expectCode(() => assertCanFollowReplacement({
      ...accessContext,
      visitorSession: { ...accessContext.visitorSession, state: "revoked", revokedAt: "2026-09-25T23:00:00.000Z" },
    }), "RELEASE_REVOKED");
    expectCode(() => assertCanFollowReplacement({
      ...accessContext,
      visitorSession: { ...accessContext.visitorSession, expiresAt: "2026-09-26T00:00:00.000Z" },
    }), "RELEASE_REVOKED");
  });

  it("does not extend a different session than the one requested", async () => {
    let extended = false;
    await expect(followReplacement({ transaction: (work) => work({
      lockFollowContext: async () => ({
        ...accessContext,
        visitorSession: { ...accessContext.visitorSession, id: "another-session" },
      }),
      extendScopedSession: async () => { extended = true; },
    }) }, { sourceReleaseId: predecessor.id, replacementReleaseId: successor.id, visitorSessionId: "session-1" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(extended).toBe(false);
  });

  it("extends access only through the original link", async () => {
    const grants: unknown[] = [];
    const result = await followReplacement({ transaction: (work) => work({
      lockFollowContext: async () => accessContext,
      extendScopedSession: async (grant) => { grants.push(grant); },
    }) }, { sourceReleaseId: predecessor.id, replacementReleaseId: successor.id, visitorSessionId: "session-1" });
    expect(result.id).toBe(successor.id);
    expect(grants).toEqual([{ accessLinkId: "link-1", visitorSessionId: "session-1", sourceReleaseId: predecessor.id, releaseId: successor.id }]);
  });
});

describe("release-bound flags, responses and acknowledgement", () => {
  const released = release();
  const context: ContextRef = { jobId: job.id, releaseId: released.id, draftId: null, draftVersion: null, stepId: "step-B1", bendId: "B1" };

  it("keeps the canonical release and step on a flag", () => {
    const flag = createReleaseFlag({ id: "flag-1", context, release: released, question: "Which direction?", photoAssets: [], createdBy: visitor, createdAt: "now" });
    expect(flag.context).toEqual(context);
    expect(flag.status).toBe("open");
  });

  it("deduplicates flag retries and rejects an idempotency key with a changed payload", async () => {
    const store = new MemoryFlagStore(released);
    const input = {
      id: "flag-new", context, question: "Which direction?", photoAssetIds: [], createdBy: visitor,
      createdAt: "now", idempotencyKey: "flag-retry",
    };
    const [first, retry] = await Promise.all([
      createReleaseFlagIdempotently(store, input),
      createReleaseFlagIdempotently(store, { ...input, id: "discarded-id" }),
    ]);
    expect(retry.id).toBe(first.id);
    expect(store.creates).toBe(1);
    await expect(createReleaseFlagIdempotently(store, { ...input, question: "Different question" })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("requires a direct same-job successor for replacement responses", () => {
    const flag = createReleaseFlag({ id: "flag-1", context, release: released, question: "Which direction?", photoAssets: [], createdBy: visitor, createdAt: "now" });
    expectCode(() => respondToFlag({ flag, expectedVersion: 1, actor: designer, text: "Use updated", kind: "replacement_release", replacementRelease: release({ id: "foreign", jobId: "job-2" }), at: "now" }), "VALIDATION_FAILED");
    const direct = release({ id: "release-2", supersedesReleaseId: released.id });
    expect(respondToFlag({ flag, expectedVersion: 1, actor: designer, text: "See the corrected guide", kind: "replacement_release", replacementRelease: direct, at: "now" }).response?.replacementReleaseId).toBe(direct.id);
  });

  it("acknowledges only from a visitor session for that release", () => {
    const flag: Flag = respondToFlag({
      flag: createReleaseFlag({ id: "flag-1", context, release: released, question: "Which direction?", photoAssets: [], createdBy: visitor, createdAt: "now" }),
      expectedVersion: 1, actor: designer, text: "See the corrected guide", kind: "explanation", replacementRelease: null, at: "later",
    });
    expectCode(() => acknowledgeFlag({ flag, expectedVersion: 2, actor: visitor, sessionReleaseId: "other-release", at: "ack", acknowledgementId: "ack-1" }), "FORBIDDEN");
    const result = acknowledgeFlag({ flag, expectedVersion: 2, actor: visitor, sessionReleaseId: released.id, at: "ack", acknowledgementId: "ack-1" });
    expect(result.flag.status).toBe("resolved");
    expect(result.flag.version).toBe(3);
    expect(result.acknowledgement.releaseId).toBe(released.id);
  });
});

describe("generation late-result guard", () => {
  const generation: Generation = {
    id: "generation-1", jobId: job.id, inputFingerprint: "fingerprint-1", state: "running",
    startedAt: "2026-09-26T10:00:00.000Z", expiresAt: "2026-09-26T10:10:00.000Z", draftVersion: null, errorCode: null,
  };

  it("accepts only a still-current job, input and draft version", () => {
    expect(guardGenerationResult({ generation, job, currentDraft: null, expectedJobVersion: 7, baseDraftVersion: null, currentInputFingerprint: generation.inputFingerprint, now: "2026-09-26T10:05:00.000Z" })).toEqual({ apply: true, nextDraftVersion: 1 });
    expect(guardGenerationResult({ generation, job: { ...job, version: 8 }, currentDraft: null, expectedJobVersion: 7, baseDraftVersion: null, currentInputFingerprint: generation.inputFingerprint, now: "2026-09-26T10:05:00.000Z" })).toMatchObject({ apply: false, reason: "job_changed" });
    expect(guardGenerationResult({ generation, job, currentDraft: makeDraft(), expectedJobVersion: 7, baseDraftVersion: 3, currentInputFingerprint: generation.inputFingerprint, now: "2026-09-26T10:05:00.000Z" })).toMatchObject({ apply: false, reason: "draft_edited" });
    expect(guardGenerationResult({ generation, job, currentDraft: null, expectedJobVersion: 7, baseDraftVersion: null, currentInputFingerprint: "different-inputs", now: "2026-09-26T10:05:00.000Z" })).toMatchObject({ apply: false, reason: "inputs_changed" });
  });

  it("discards expired results and clears approvals when a valid result becomes a new version", () => {
    expect(guardGenerationResult({ generation, job, currentDraft: null, expectedJobVersion: 7, baseDraftVersion: null, currentInputFingerprint: generation.inputFingerprint, now: "2026-09-26T10:11:00.000Z" })).toMatchObject({ apply: false, reason: "expired" });
    const reviewed = reviewDraft(makeDraft());
    const next = applyGenerationResult({
      job, generation, currentDraft: reviewed, expectedJobVersion: job.version, baseDraftVersion: reviewed.version,
      currentInputFingerprint: generation.inputFingerprint, now: "2026-09-26T10:05:00.000Z", draftId: "new-draft", content: makeContent(["B2", "B1"]),
    });
    expect(next.version).toBe(5);
    expect(next.reviews).toEqual([]);
    expect(next.generationId).toBe(generation.id);
    expect(next.content.panelModel?.reviewed).toBe(false);
  });
});

class MemoryPublicationStore implements PublicationPersistence {
  aggregate: PublicationAggregate;
  idempotency: PublishedIdempotency[] = [];
  releases: Release[] = [];
  commits = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(aggregate: PublicationAggregate) { this.aggregate = aggregate; }

  async transaction<T>(work: (transaction: PublicationTransaction) => Promise<T>): Promise<T> {
    let unlock!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    try {
      return await work({
        lockPublication: async () => this.aggregate,
        getIdempotency: async (actorId, operation, key) => this.idempotency.find((item) => item.actorId === actorId && item.operation === operation && item.key === key) ?? null,
        getReleaseByIdempotency: async (id) => this.releases.find((item) => item.id === id) ?? null,
        commitPublication: async ({ release, idempotency }) => {
          this.releases.push(release);
          this.idempotency.push(idempotency);
          this.aggregate = { ...this.aggregate, job: { ...this.aggregate.job, latestReleaseId: release.id }, latestRelease: release };
          this.commits += 1;
        },
      });
    } finally { unlock(); }
  }
}

class MemoryFlagStore implements FlagPersistence {
  flags = new Map<string, Flag>();
  idempotency: { actorId: string; operation: "flag.create"; key: string; payloadHash: string; flagId: string }[] = [];
  creates = 0;
  private tail: Promise<void> = Promise.resolve();

  constructor(readonly release: Release) {}

  async transaction<T>(work: (transaction: FlagTransaction) => Promise<T>): Promise<T> {
    let unlock!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { unlock = resolve; });
    await previous;
    try {
      return await work({
      getIdempotency: async (actorId, operation, key) => this.idempotency.find((item) => item.actorId === actorId && item.operation === operation && item.key === key) ?? null,
      getFlag: async (id) => this.flags.get(id) ?? null,
      loadFlagContext: async ({ releaseId, photoAssetIds }) => releaseId === this.release.id && photoAssetIds.length === 0 ? { release: this.release, photoAssets: [] } : null,
      lockFlagMutation: async ({ flagId }) => {
        const flag = this.flags.get(flagId);
        return flag ? { flag, replacementRelease: null } : null;
      },
      commitFlagCreate: async ({ flag, idempotency }) => {
        this.flags.set(flag.id, flag);
        this.idempotency.push(idempotency);
        this.creates += 1;
      },
      commitFlagResponse: async (flag) => { this.flags.set(flag.id, flag); },
      commitFlagAcknowledgement: async ({ flag }) => { this.flags.set(flag.id, flag); },
      });
    } finally { unlock(); }
  }
}
