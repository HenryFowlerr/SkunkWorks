import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import {
  OpenAiPitchMobilePreviewAdapter,
  PITCH_MOBILE_PREVIEW_INSTRUCTIONS,
  previewQuestionPrompt,
} from "@/server/ai/pitch-mobile-preview";
import type { PitchKnowledgeBase } from "@/contracts/pitch";

const citation = { sourceKey: "drawing:1", excerpt: "Material thickness 2.0 mm." };
const knowledgeBase: PitchKnowledgeBase = {
  approvalState: "draft",
  title: "Test block knowledge base",
  titleCitations: [citation],
  partSummary: "The drawing records a 2.0 mm material thickness.",
  partSummaryCitations: [citation],
  sourceSummary: "This draft comes from the selected drawing.",
  sourceSummaryCitations: [citation],
  operatorSteps: [{
    id: "inspect",
    title: "Inspect drawing",
    instruction: "Read the supplied drawing before setup.",
    guidanceKind: "attention",
    citations: [citation],
  }],
  attentionPoints: [],
  openQuestions: [],
  openQuestionCitations: [],
  recommendedPhoneStartStepId: "inspect",
};

function adapter(output: object) {
  const create = vi.fn().mockResolvedValue({ status: "completed", output: [], output_text: JSON.stringify(output) });
  return {
    create,
    ai: new OpenAiPitchMobilePreviewAdapter({
      client: { responses: { create } } as unknown as OpenAI,
      environment: { OPENAI_API_KEY: "test-key", OPENAI_FLOOR_MODEL: "configured-luna-model" },
    }),
  };
}

const input = {
  partName: "Engineering Test Block",
  partNumber: "SKW-ETB-01",
  question: "What thickness does the draft record?",
  knowledgeBase,
};

describe("draft mobile knowledge-base preview", () => {
  it("uses Luna with only the server-held draft knowledge base and no release authority", async () => {
    const { ai, create } = adapter({
      approvalState: "draft",
      evidenceState: "supported",
      text: "The draft records a material thickness of 2.0 mm.",
      citations: [citation],
      suggestedEngineerReview: null,
    });

    await expect(ai.answerDraftQuestion(input)).resolves.toMatchObject({ approvalState: "draft", evidenceState: "supported" });
    const request = create.mock.calls[0][0];
    expect(request.model).toBe("configured-luna-model");
    expect(request.store).toBe(false);
    expect(request.max_output_tokens).toBe(750);
    expect(request.reasoning).toEqual({ effort: "none" });
    expect(request.instructions).toBe(PITCH_MOBILE_PREVIEW_INSTRUCTIONS);
    expect(request.input[0].content).toHaveLength(1);
    const prompt = JSON.parse(request.input[0].content[0].text);
    expect(prompt.knowledgeBaseDraft).toEqual(knowledgeBase);
    expect(prompt.rules.join(" ")).toMatch(/cannot become a QR/i);
    expect(PITCH_MOBILE_PREVIEW_INSTRUCTIONS).toMatch(/not released floor guidance/i);
  });

  it("rejects an answer that uses a citation pair outside the draft", async () => {
    const { ai } = adapter({
      approvalState: "draft",
      evidenceState: "supported",
      text: "The drawing identifies a different material thickness.",
      citations: [{ sourceKey: "drawing:1", excerpt: "Material thickness 3.0 mm." }],
      suggestedEngineerReview: null,
    });
    await expect(ai.answerDraftQuestion(input)).rejects.toMatchObject({ code: "UNSUPPORTED_CLAIM" });
  });

  it("rejects a numeric claim that its cited draft text does not establish", async () => {
    const { ai } = adapter({
      approvalState: "draft",
      evidenceState: "supported",
      text: "The draft records a material thickness of 9.0 mm.",
      citations: [citation],
      suggestedEngineerReview: null,
    });
    await expect(ai.answerDraftQuestion(input)).rejects.toMatchObject({ code: "UNSUPPORTED_CLAIM" });
  });

  it("requires an engineer-review prompt when the draft cannot answer", async () => {
    const { ai } = adapter({
      approvalState: "draft",
      evidenceState: "not_found",
      text: "The draft does not establish that point.",
      citations: [],
      suggestedEngineerReview: null,
    });
    await expect(ai.answerDraftQuestion(input)).rejects.toMatchObject({ code: "MALFORMED_OUTPUT" });
  });

  it("builds a source-limited preview prompt without a release ID", () => {
    const prompt = JSON.parse(previewQuestionPrompt(input));
    expect(prompt.question).toBe(input.question);
    expect(prompt).not.toHaveProperty("releaseId");
    expect(prompt.knowledgeBaseDraft).toEqual(knowledgeBase);
  });
});
