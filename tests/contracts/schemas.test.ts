import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ApiErrorEnvelopeSchema,
  ApiSuccessEnvelopeSchema,
  AssetSchema,
  ContextRefSchema,
  DraftContentInputSchema,
  DraftContentSchema,
  DraftSchema,
  EvidenceRefSchema,
  FlagSchema,
  GenerationSchema,
  JobSchema as zJobSchema,
  MachineInputSchema,
  MachineSchema,
  PanelModelSchema,
  ReleaseViewSchema,
  WorkshopSnapshotSchema,
} from "@/contracts";
import {
  draft,
  draftContent,
  draftContentInput,
  ids,
  job,
  openFlag,
  pendingAsset,
  failedAsset,
  panelModel,
  releaseView,
  sourceAsset,
  workshopSnapshot,
} from "./fixtures";

const requestId = "00000000-0000-4000-8000-000000000099";

describe("contract DTO schemas", () => {
  it("accepts the representative workshop, asset, geometry, draft and release fixtures", () => {
    expect(WorkshopSnapshotSchema.parse(workshopSnapshot)).toEqual(workshopSnapshot);
    expect(AssetSchema.parse(sourceAsset)).toEqual(sourceAsset);
    expect(PanelModelSchema.parse(panelModel)).toEqual(panelModel);
    expect(DraftContentSchema.parse(draftContent)).toEqual(draftContent);
    expect(DraftSchema.parse(draft)).toEqual(draft);
    expect(ReleaseViewSchema.parse(releaseView)).toEqual(releaseView);
    expect(FlagSchema.parse(openFlag)).toEqual(openFlag);
  });

  it("reads legacy workshop notes as unknown provenance and keeps note authority out of save inputs", () => {
    const legacyMachine = {
      ...workshopSnapshot.machines[0],
      notes: [{ id: ids.machineNote, text: "Legacy note", confirmedBy: null }],
    };
    const parsed = MachineSchema.parse(legacyMachine);
    expect(parsed.notes[0]).toMatchObject({ authorId: null, createdAt: null, source: null, confirmedBy: null });

    const input = {
      ...legacyMachine,
      notes: [{ id: ids.machineNote, text: "New note", source: null }],
    };
    expect(MachineInputSchema.parse(input).notes[0]).toEqual(input.notes[0]);
    expect(MachineInputSchema.safeParse({
      ...input,
      notes: [{ ...input.notes[0], authorId: ids.member, createdAt: "2026-09-25T10:00:00.000Z" }],
    }).success).toBe(false);
  });

  it("requires an asset for workshop note source page references", () => {
    expect(MachineSchema.safeParse({
      ...workshopSnapshot.machines[0],
      notes: [{
        id: ids.machineNote,
        text: "Manual setup restriction",
        authorId: ids.member,
        createdAt: "2026-09-25T10:00:00.000Z",
        source: { label: "Machine manual", assetId: null, page: 7 },
        confirmedBy: null,
      }],
    }).success).toBe(false);
  });

  it("preserves the difference between a known zero and a missing value", () => {
    const zeroAngle = structuredClone(draftContent);
    zeroAngle.bends[0].foldRotationDeg.value = 0;
    zeroAngle.bends[0].foldRotationDeg.originalText = "0° from flat";
    expect(DraftContentSchema.parse(zeroAngle).bends[0].foldRotationDeg.value).toBe(0);

    const unknownAngle = structuredClone(draftContent);
    unknownAngle.bends[0].foldRotationDeg = {
      value: null,
      evidence: [],
      evidenceState: "not_found",
      originalText: null,
    };
    expect(DraftContentSchema.parse(unknownAngle).bends[0].foldRotationDeg.value).toBeNull();
  });

  it("checks source citation pages and normalized regions", () => {
    expect(EvidenceRefSchema.safeParse({
      kind: "document",
      assetId: ids.asset,
      page: 0,
      region: null,
      excerpt: "",
    }).success).toBe(false);
    expect(EvidenceRefSchema.safeParse({
      kind: "document",
      assetId: ids.asset,
      page: 1,
      region: [0.8, 0.2, 0.3, 0.2],
      excerpt: "outside page bounds",
    }).success).toBe(false);
    expect(EvidenceRefSchema.safeParse({
      kind: "document",
      assetId: ids.asset,
      page: 1,
      region: null,
      excerpt: "page-level citation is valid",
    }).success).toBe(true);
  });

  it("requires a connected, acyclic panel tree with hinge axes on both panel edges", () => {
    const disconnected = { ...panelModel, hinges: [] };
    expect(PanelModelSchema.safeParse(disconnected).success).toBe(false);

    const badAxis = structuredClone(panelModel);
    badAxis.hinges[0].axisStartMm = [110, 0];
    badAxis.hinges[0].axisEndMm = [110, 50];
    expect(PanelModelSchema.safeParse(badAxis).success).toBe(false);

    const cycle = structuredClone(panelModel);
    cycle.hinges.push({
      id: "H2",
      parentPanelId: "P2",
      childPanelId: "P1",
      axisStartMm: [100, 0],
      axisEndMm: [100, 50],
    });
    expect(PanelModelSchema.safeParse(cycle).success).toBe(false);

    const selfIntersecting = structuredClone(panelModel);
    selfIntersecting.panels[0].polygonMm = [[0, 0], [1, 1], [0, 1], [1, 0]];
    expect(PanelModelSchema.safeParse(selfIntersecting).success).toBe(false);
  });

  it("rejects authority-bearing draft fields on save while accepting the safe editable DTO", () => {
    expect(DraftContentInputSchema.parse(draftContentInput)).toEqual(draftContentInput);

    const forgedReviewed = structuredClone(draftContentInput) as unknown as { panelModel: Record<string, unknown> | null };
    forgedReviewed.panelModel = { ...(forgedReviewed.panelModel ?? {}), reviewed: true };
    expect(DraftContentInputSchema.safeParse(forgedReviewed).success).toBe(false);

    const forgedFinding = structuredClone(draftContentInput) as unknown as { findings: unknown[] };
    forgedFinding.findings = [{
      id: ids.finding,
      kind: "missing_data",
      severity: "blocking",
      bendId: "B1",
      message: "Angle missing",
      evidence: [],
      disposition: "resolved",
      resolutionRecordId: ids.member,
    }];
    expect(DraftContentInputSchema.safeParse(forgedFinding).success).toBe(false);

    const forgedProposal = structuredClone(draftContentInput) as unknown as { machineProposals: unknown[] };
    forgedProposal.machineProposals = [{
      id: ids.proposal,
      snapshotId: ids.workshopSnapshot,
      machineId: ids.machine,
      proposedBendOrder: ["B1"],
      rationale: "Use this order",
      evidence: [],
      status: "accepted",
      decidedBy: ids.member,
    }];
    expect(DraftContentInputSchema.safeParse(forgedProposal).success).toBe(false);
  });

  it("checks version-matched reviews and keeps source assets separate from release photos", () => {
    const staleReview = {
      ...draft,
      version: 2,
      reviews: [{ kind: "design", actorId: ids.member, draftVersion: 1, at: "2026-09-25T13:00:00.000Z" }],
    };
    expect(DraftSchema.safeParse(staleReview).success).toBe(false);

    expect(AssetSchema.safeParse({ ...sourceAsset, kind: "issue_photo", releaseId: ids.release }).success).toBe(true);
    expect(AssetSchema.safeParse({ ...sourceAsset, kind: "issue_photo", releaseId: null }).success).toBe(false);
    expect(AssetSchema.safeParse({ ...sourceAsset, kind: "drawing_pdf", releaseId: ids.release }).success).toBe(false);
  });

  it("requires server-verified hashes only once an asset is ready", () => {
    expect(AssetSchema.parse(pendingAsset).sha256).toBeNull();
    expect(AssetSchema.parse(failedAsset).sha256).toBeNull();
    expect(AssetSchema.parse(sourceAsset).sha256).toMatch(/^[a-f0-9]{64}$/i);
    expect(AssetSchema.safeParse({ ...sourceAsset, sha256: null }).success).toBe(false);
    expect(AssetSchema.safeParse({ ...pendingAsset, sha256: "not-a-digest" }).success).toBe(false);
  });

  it("keeps release source asset metadata within its immutable same-job snapshot", () => {
    expect(ReleaseViewSchema.parse(releaseView).sourceAssets).toEqual([sourceAsset]);
    expect(ReleaseViewSchema.safeParse({ ...releaseView, sourceAssets: [] }).success).toBe(false);
    expect(ReleaseViewSchema.safeParse({
      ...releaseView,
      sourceAssets: [{ ...sourceAsset, jobId: ids.workspace }],
    }).success).toBe(false);
    expect(ReleaseViewSchema.safeParse({
      ...releaseView,
      sourceAssets: [{ ...sourceAsset, sha256: null, status: "pending" }],
    }).success).toBe(false);
  });

  it("requires exactly one context scope and release-scoped flags", () => {
    expect(ContextRefSchema.safeParse({
      jobId: ids.job,
      releaseId: ids.release,
      draftId: ids.draft,
      draftVersion: 1,
      stepId: null,
      bendId: null,
    }).success).toBe(false);

    const draftContext = {
      jobId: ids.job,
      releaseId: null,
      draftId: ids.draft,
      draftVersion: 1,
      stepId: null,
      bendId: "B1",
    };
    expect(ContextRefSchema.safeParse(draftContext).success).toBe(true);
    expect(FlagSchema.safeParse({ ...openFlag, context: draftContext }).success).toBe(false);

    expect(FlagSchema.safeParse({
      ...openFlag,
      response: {
        text: "Use the next released version.",
        authorId: ids.member,
        at: "2026-09-25T14:00:00.000Z",
        kind: "replacement_release",
        replacementReleaseId: null,
      },
      status: "responded",
    }).success).toBe(false);
  });

  it("validates the v1.0 success and wire error envelopes", () => {
    const success = {
      data: { job },
      meta: { requestId, contractVersion: "1.0" },
    };
    expect(ApiSuccessEnvelopeSchema(z.object({ job: zJobSchema })).safeParse(success).success).toBe(true);
    expect(ApiSuccessEnvelopeSchema(z.object({ job: zJobSchema })).safeParse({
      ...success,
      meta: { requestId, contractVersion: "2.0" },
    }).success).toBe(false);

    expect(ApiErrorEnvelopeSchema.safeParse({
      error: { code: "VERSION_CONFLICT", message: "Reload the draft.", retryable: false },
      meta: { requestId, contractVersion: "1.0" },
    }).success).toBe(true);
    expect(ApiErrorEnvelopeSchema.safeParse({
      error: { code: "ENDPOINT_UNAVAILABLE", message: "No API is wired yet.", retryable: false },
      meta: { requestId, contractVersion: "1.0" },
    }).success).toBe(false);
  });

  it("enforces generation-state response consistency", () => {
    const succeeded = {
      id: ids.generation,
      jobId: ids.job,
      inputFingerprint: "b".repeat(64),
      state: "succeeded",
      startedAt: "2026-09-25T12:00:00.000Z",
      expiresAt: "2026-09-25T12:01:00.000Z",
      draftVersion: 1,
      errorCode: null,
    };
    expect(GenerationSchema.safeParse(succeeded).success).toBe(true);
    expect(GenerationSchema.safeParse({ ...succeeded, state: "failed", errorCode: null }).success).toBe(false);
  });
});
