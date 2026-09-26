import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { OpenAiResponsesAdapter } from "../../../src/server/ai/openai";
import { QUESTION_INSTRUCTIONS, questionUserPrompt, ENGINEER_REPLY_INSTRUCTIONS, AI_PROMPT_VERSIONS } from "../../../src/server/ai/prompts";
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


describe("prewritten engineer reply prompt", () => {
  function groundedInput(): QuestionInput {
    const data = input();
    const text = "B2 internal angle 90 degrees. Confirm orientation with engineering.";
    data.pdfs[0].pages[0].text = text;
    data.sources = [{ kind: "document", assetId, page: 1, text }];
    return data;
  }
  function adapter(text = "B2 has an internal angle of 90 degrees.") {
    const create = vi.fn().mockResolvedValue({ status: "completed", output: [], output_text: JSON.stringify({
      evidenceState: "supported", text,
      citations: [{ sourceKey: `document:${assetId}:1`, excerpt: "B2 internal angle 90 degrees.", region: null }],
      referencedBendIds: ["B2"], referencedStepIds: [], suggestedFlag: "",
    }) });
    return { create, ai: new OpenAiResponsesAdapter({ client: { responses: { create } } as unknown as OpenAI,
      environment: { OPENAI_FLOOR_MODEL: "configured-luna-model", OPENAI_API_KEY: "test-key" } }) };
  }
  it("routes an operator question through the configured floor model", async () => {
    const { create, ai } = adapter();
    await ai.answerQuestion(groundedInput());
    expect(create.mock.calls[0][0].model).toBe("configured-luna-model");
  });
  it("fires its own instructions with authorized text only and strict output", async () => {
    const { create, ai } = adapter();
    const answer = await ai.suggestEngineerReply(groundedInput());
    expect(answer.evidenceState).toBe("supported");
    const request = create.mock.calls[0][0];
    expect(request.model).toBe("configured-luna-model");
    expect(request.instructions).toBe(ENGINEER_REPLY_INSTRUCTIONS);
    expect(request.store).toBe(false);
    expect(request.text.format.strict).toBe(true);
    expect(request.input[0].content).toHaveLength(1);
    const prompt = JSON.parse(request.input[0].content[0].text);
    expect(prompt.promptVersion).toBe(AI_PROMPT_VERSIONS.engineerReply);
    expect(prompt.task).toMatch(/do not send/i);
    expect(prompt.sources).toHaveLength(1);
  });
  it("rejects a made-up dimension in a candidate fix", async () => {
    const { ai } = adapter("Change the B2 internal angle to 95 degrees.");
    await expect(ai.suggestEngineerReply(groundedInput())).rejects.toMatchObject({ code: "UNSUPPORTED_CLAIM" });
  });
  it("does not call the model when there is no source evidence", async () => {
    const { create, ai } = adapter();
    expect((await ai.suggestEngineerReply(input())).evidenceState).toBe("not_found");
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["failed", "cancelled", "incomplete"] as const)("maps a %s Responses result to a provider error", async (status) => {
    const create = vi.fn().mockResolvedValue({ status, output: [], output_text: "" });
    const ai = new OpenAiResponsesAdapter({
      client: { responses: { create } } as unknown as OpenAI,
      environment: { OPENAI_FLOOR_MODEL: "configured-luna-model", OPENAI_API_KEY: "test-key" },
    });

    await expect(ai.answerQuestion(groundedInput())).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});
