import { describe, expect, it } from "vitest";
import type { WorkshopSnapshot } from "../../../src/contracts/domain";
import { prepareGenerationEvidence, prepareQuestionEvidence, validateCitations } from "../../../src/server/ai/grounding";
import { parseGenerationOutput, parseQuestionOutput } from "../../../src/server/ai/validate-output";
import type { GenerationInput, GroundingSource, PdfEvidenceFile, QuestionInput, RawCitation } from "../../../src/server/ai/types";

const ids = {
  job: "10000000-0000-4000-8000-000000000001",
  asset: "10000000-0000-4000-8000-000000000002",
  snapshot: "10000000-0000-4000-8000-000000000003",
  workshop: "10000000-0000-4000-8000-000000000004",
  workspace: "10000000-0000-4000-8000-000000000005",
  machine: "10000000-0000-4000-8000-000000000006",
  note: "10000000-0000-4000-8000-000000000007",
  confirmer: "10000000-0000-4000-8000-000000000008",
  stepB4: "10000000-0000-4000-8000-000000000009",
  stepB5: "10000000-0000-4000-8000-000000000010",
};

const pageText = "B4 internal angle 90°. Radius 2 mm and conflicting radius 3 mm. Direction up. B4 before B5.";
const noteText = "For this part family, bend B4 must precede bend B5.";

function makeSnapshot(): WorkshopSnapshot {
  return {
    id: ids.snapshot,
    workshopId: ids.workshop,
    workspaceId: ids.workspace,
    version: 1,
    name: "Prototype shop",
    machines: [{
      id: ids.machine,
      name: "Press brake",
      process: "air bending",
      model: null,
      usableBendLengthMm: { value: null, evidence: [], evidenceState: "not_found", originalText: null },
      tools: [],
      notes: [{
        id: ids.note,
        text: noteText,
        authorId: ids.confirmer,
        createdAt: "2026-09-25T00:00:00.000Z",
        source: null,
        confirmedBy: ids.confirmer,
      }],
      approvedOrderConstraints: [{
        beforeBendId: "B4", afterBendId: "B5", appliesToPartFamily: "sheet-metal", noteId: ids.note,
      }],
    }],
    confirmedBy: ids.confirmer,
    confirmedAt: "2026-09-25T00:00:00.000Z",
  };
}

function makePdf(): PdfEvidenceFile {
  return {
    assetId: ids.asset,
    filename: "drawing.pdf",
    mimeType: "application/pdf",
    bytes: new Uint8Array([37, 80, 68, 70]),
    pageCount: 1,
    pages: [{ page: 1, text: pageText }],
  };
}

function makeSources(): GroundingSource[] {
  return [
    { kind: "document", assetId: ids.asset, page: 1, text: pageText },
    { kind: "workshop_note", snapshotId: ids.snapshot, machineId: ids.machine, noteId: ids.note, text: noteText },
  ];
}

function makeInput(): GenerationInput {
  return {
    jobId: ids.job,
    partFamily: "sheet-metal",
    sourceAssetIds: [ids.asset],
    pdfs: [makePdf()],
    sources: makeSources(),
    workshopSnapshot: makeSnapshot(),
    machineId: ids.machine,
    mappedBends: [
      { bendId: "B4", hingeId: "hinge-b4", foldRotationDeg: { value: 90, evidence: [], evidenceState: "supported", originalText: "reviewed manifest" } },
      { bendId: "B5", hingeId: "hinge-b5", foldRotationDeg: { value: null, evidence: [], evidenceState: "not_found", originalText: null } },
    ],
    stepTargets: [{ id: ids.stepB4, bendId: "B4" }, { id: ids.stepB5, bendId: "B5" }],
  };
}

function makeQuestionInput(): QuestionInput {
  return {
    context: {
      jobId: ids.job,
      releaseId: "10000000-0000-4000-8000-000000000011",
      draftId: null,
      draftVersion: null,
      stepId: ids.stepB4,
      bendId: "B4",
    },
    question: "What angle is called out for B4?",
    pdfs: [makePdf()],
    sources: makeSources(),
    workshopSnapshot: makeSnapshot(),
    knownBendIds: ["B4", "B5"],
    knownStepTargets: [{ id: ids.stepB4, bendId: "B4" }, { id: ids.stepB5, bendId: "B5" }],
  };
}

function citation(sourceKey: string, excerpt: string): RawCitation {
  return { sourceKey, excerpt, region: null };
}

function fact<T>(value: T | null, evidenceState: "supported" | "conflict" | "not_found" | "unreadable", citations: RawCitation[] = []) {
  return { value, evidenceState, citations };
}

function makeOutput() {
  const pageKey = `document:${ids.asset}:1`;
  const noteKey = `workshop_note:${ids.snapshot}:${ids.machine}:${ids.note}`;
  return {
    bends: [
      {
        bendId: "B4",
        finishedAngle: fact({ degrees: 90, convention: "internal" as const }, "supported", [citation(pageKey, "B4 internal angle 90°")]),
        insideRadiusMm: fact(null, "conflict", [citation(pageKey, "Radius 2 mm"), citation(pageKey, "conflicting radius 3 mm")]),
        directionText: fact("up", "supported", [citation(pageKey, "Direction up")]),
      },
      {
        bendId: "B5",
        finishedAngle: fact({ degrees: null, convention: null }, "not_found"),
        insideRadiusMm: fact(null, "not_found"),
        directionText: fact(null, "unreadable"),
      },
    ],
    steps: [{
      id: ids.stepB4,
      bendId: "B4",
      instruction: "Set B4 to 90° in the up direction.",
      citations: [citation(pageKey, "B4 internal angle 90°"), citation(pageKey, "Direction up")],
      guidanceSuggestion: "uncertain" as const,
      guidanceRationale: "The available source does not show whether this operation is unusual.",
    }],
    machineOrder: ["B4", "B5"],
    machineRationale: "Follow the confirmed B4-before-B5 setup constraint.",
    machineCitations: [citation(noteKey, noteText)],
  };
}

describe("AI grounding validation", () => {
  it("maps grounded proposals while preserving reviewed fold rotations and reporting missing facts", () => {
    const input = makeInput();
    const prepared = prepareGenerationEvidence(input);
    const result = parseGenerationOutput(makeOutput(), input, prepared, "environment-selected-model");

    expect(result.bends[0].foldRotationDeg).toEqual(input.mappedBends[0].foldRotationDeg);
    expect(result.bends[0].finishedAngle.value).toEqual({ degrees: 90, convention: "internal" });
    expect(result.bends[0].insideRadiusMm).toMatchObject({ value: null, evidenceState: "conflict" });
    expect(result.bends[0].finishedAngle.evidence[0]).toMatchObject({ kind: "document", assetId: ids.asset, page: 1 });
    expect(result.steps).toHaveLength(1);
    expect(result.machineProposal?.proposedBendOrder).toEqual(["B4", "B5"]);
    expect(result.findings.some((finding) => finding.kind === "missing_data" && finding.bendId === "B5")).toBe(true);
    expect(result.findings.some((finding) => finding.kind === "source_conflict" && finding.bendId === "B4")).toBe(true);
  });

  it("rejects an unknown evidence source or a quotation absent from the cited page", () => {
    const input = makeInput();
    const prepared = prepareGenerationEvidence(input);
    expect(() => validateCitations([citation("document:unknown:99", "90°")], prepared)).toThrow(/unsupported claim/i);
    expect(() => validateCitations([citation(`document:${ids.asset}:1`, "72°")], prepared)).toThrow(/unsupported claim/i);
  });

  it("rejects a model invented bend or step pointer", () => {
    const input = makeInput();
    const prepared = prepareGenerationEvidence(input);
    const unknownBend = makeOutput();
    unknownBend.bends[1].bendId = "B99";
    expect(() => parseGenerationOutput(unknownBend, input, prepared, "model")).toThrow(/unsupported claim/i);

    const unknownStep = makeOutput();
    unknownStep.steps[0].id = "10000000-0000-4000-8000-000000000099";
    expect(() => parseGenerationOutput(unknownStep, input, prepared, "model")).toThrow(/unsupported claim/i);
  });

  it("rejects a cited step that introduces a numeric value absent from its quotes", () => {
    const input = makeInput();
    const prepared = prepareGenerationEvidence(input);
    const output = makeOutput();
    output.steps[0].instruction = "Set B4 to 72° in the up direction.";
    expect(() => parseGenerationOutput(output, input, prepared, "model")).toThrow(/unsupported claim/i);
  });

  it("rejects workshop evidence from another snapshot and pages outside the upload", () => {
    const input = makeInput();
    input.sources = [{ kind: "workshop_note", snapshotId: ids.job, machineId: ids.machine, noteId: ids.note, text: noteText }];
    expect(() => prepareGenerationEvidence(input)).toThrow(/selected snapshot/i);

    const badPage = makeInput();
    badPage.sources = [{ kind: "document", assetId: ids.asset, page: 2, text: pageText }];
    expect(() => prepareGenerationEvidence(badPage)).toThrow(/trusted text extraction/i);
  });

  it("answers contextual questions with citations and rejects unknown bend or step pointers", () => {
    const input = makeQuestionInput();
    const evidence = prepareQuestionEvidence(input);
    const valid = {
      evidenceState: "supported" as const,
      text: "B4 is called out at 90° internal.",
      citations: [citation(`document:${ids.asset}:1`, "B4 internal angle 90°")],
      referencedBendIds: ["B4"],
      referencedStepIds: [ids.stepB4],
      suggestedFlag: "",
    };
    const answer = parseQuestionOutput(valid, input, evidence, "model");
    expect(answer.context).toEqual(input.context);
    expect(answer.evidence).toHaveLength(1);

    expect(() => parseQuestionOutput({ ...valid, referencedBendIds: ["B99"] }, input, evidence, "model"))
      .toThrow(/unsupported claim/i);
    expect(() => parseQuestionOutput({ ...valid, referencedStepIds: ["10000000-0000-4000-8000-000000000099"] }, input, evidence, "model"))
      .toThrow(/unsupported claim/i);
  });

  it("turns absent or unreadable answers into explicit safe responses", () => {
    const input = makeQuestionInput();
    const evidence = prepareQuestionEvidence(input);
    const output = {
      evidenceState: "not_found" as const,
      text: "The missing value is probably 4 mm.",
      citations: [],
      referencedBendIds: [],
      referencedStepIds: [],
      suggestedFlag: "",
    };
    const answer = parseQuestionOutput(output, input, evidence, "model");
    expect(answer.evidenceState).toBe("not_found");
    expect(answer.text).not.toContain("4 mm");
    expect(answer.suggestedFlag).toMatch(/designer/i);

    const unreadable = parseQuestionOutput({ ...output, evidenceState: "unreadable" as const }, input, evidence, "model");
    expect(unreadable.evidenceState).toBe("unreadable");
    expect(unreadable.text).toMatch(/not readable/i);
  });
});
