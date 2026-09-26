import { describe, expect, it } from "vitest";
import { OpenAiResponsesAdapter } from "../../../src/server/ai/openai";
import { QUESTION_INSTRUCTIONS, questionUserPrompt } from "../../../src/server/ai/prompts";
import type { QuestionInput } from "../../../src/server/ai/types";

const jobId = "10000000-0000-4000-8000-000000000001";
const releaseId = "10000000-0000-4000-8000-000000000002";
const stepId = "10000000-0000-4000-8000-000000000003";
const assetId = "10000000-0000-4000-8000-000000000004";

function input(): QuestionInput {
  return {
    context: { jobId, releaseId, draftId: null, draftVersion: null, stepId, bendId: "B2" },
    question: "Can I continue with B2?",
    pdfs: [{ assetId, filename: "drawing.pdf", mimeType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]), pageCount: 1, pages: [{ page: 1, text: "" }] }],
    sources: [],
    workshopSnapshot: null,
    knownBendIds: ["B2"],
    knownStepTargets: [{ id: stepId, bendId: "B2" }],
    approvedContext: {
      releaseId,
      revisionNumber: 1,
      machineId: null,
      selectedStep: { id: stepId, bendId: "B2", instruction: "Confirm the return orientation.", guidanceDecision: "include" },
    },
  };
}

describe("release-bound question prompt", () => {
  it("passes only the selected approved guide and retrieved source scope to the model", () => {
    const prompt = JSON.parse(questionUserPrompt(input(), {
      evidence: [{
        sourceKey: `document:${assetId}:1`, label: "drawing.pdf, page 1", text: "B2 internal angle 90°",
        target: { kind: "document", assetId, page: 1, text: "B2 internal angle 90°" },
        reference: { kind: "document", assetId, page: 1, region: null, excerpt: "" },
      }],
      catalogChunks: 2,
      selection: "retrieved_excerpts",
    }));
    expect(prompt.context.releaseId).toBe(releaseId);
    expect(prompt.approvedRelease.selectedStep.instruction).toBe("Confirm the return orientation.");
    expect(prompt.knowledgeScope.selection).toBe("retrieved_excerpts");
    expect(prompt.sources).toHaveLength(1);
    expect(QUESTION_INSTRUCTIONS).toMatch(/cannot clear a hold/i);

    const excluded = input();
    excluded.approvedContext!.selectedStep!.guidanceDecision = "exclude";
    expect(JSON.parse(questionUserPrompt(excluded, { evidence: [], catalogChunks: 0, selection: "no_match" }))
      .approvedRelease.selectedStep).toBeNull();
  });

  it("abstains without an API key when no source-backed text exists", async () => {
    const answer = await new OpenAiResponsesAdapter({ environment: {} }).answerQuestion(input());
    expect(answer.evidenceState).toBe("not_found");
    expect(answer.evidence).toEqual([]);
    expect(answer.text).toMatch(/hold the affected operation/i);
    expect(answer.model).toBe("retrieval-only");
  });
});
