import { describe, expect, it } from "vitest";
import type { GenerationInput, QuestionInput } from "../../../src/server/ai/types";
import { GENERATION_INSTRUCTIONS, generationUserPrompt, questionUserPrompt } from "../../../src/server/ai/prompts";
import { ids, workshopSnapshot } from "../../contracts/fixtures";

const missingRotation = {
  value: null,
  evidence: [],
  evidenceState: "not_found" as const,
  originalText: null,
};

describe("generation prompt manifest boundary", () => {
  it("treats authored topology as mapping only and keeps unknown fold rotation missing", () => {
    const input: GenerationInput = {
      jobId: ids.job,
      partFamily: "bracket",
      sourceAssetIds: [ids.asset],
      pdfs: [{
        assetId: ids.asset,
        filename: "drawing.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array([1]),
        pageCount: 2,
        pages: [{ page: 1, text: "Bend B1" }, { page: 2, text: "" }],
      }],
      sources: [],
      workshopSnapshot,
      machineId: ids.machine,
      mappedBends: [{ bendId: "B1", hingeId: "H1", foldRotationDeg: missingRotation }],
      stepTargets: [{ id: ids.step, bendId: "B1" }],
    };

    const prompt = JSON.parse(generationUserPrompt(input, [])) as {
      allowedBends: Array<{ bendId: string; hingeId: string | null }>;
      requiredRules: string[];
      unreadablePages: Array<{ assetId: string; page: number }>;
    };
    expect(prompt.allowedBends).toEqual([{ bendId: "B1", hingeId: "H1" }]);
    expect(prompt.unreadablePages).toEqual([{ assetId: ids.asset, page: 2 }]);
    expect(prompt.requiredRules.join(" ")).toContain("not review approval or evidence for a signed fold rotation");
    expect(GENERATION_INSTRUCTIONS).toContain("Never infer a signed rotation");
    expect(GENERATION_INSTRUCTIONS).toContain("treat an authored mapping as human-reviewed");
    expect(prompt.requiredRules.join(" ")).toContain("Do not use the GLB/model mesh");
    expect(GENERATION_INSTRUCTIONS).toContain("do not use its visual appearance as evidence");
  });

  it("tells contextual Q&A not to rely on PDF pages without extracted text", () => {
    const input: QuestionInput = {
      context: { jobId: ids.job, releaseId: ids.release, draftId: null, draftVersion: null, stepId: null, bendId: null },
      question: "What angle is called out?",
      pdfs: [{
        assetId: ids.asset,
        filename: "drawing.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array([1]),
        pageCount: 2,
        pages: [{ page: 1, text: "Bend B1" }, { page: 2, text: "" }],
      }],
      sources: [],
      workshopSnapshot: null,
      knownBendIds: ["B1"],
      knownStepTargets: [],
    };
    const prompt = JSON.parse(questionUserPrompt(input, [])) as {
      unreadablePages: Array<{ assetId: string; page: number }>;
      rules: string[];
    };
    expect(prompt.unreadablePages).toEqual([{ assetId: ids.asset, page: 2 }]);
    expect(prompt.rules.join(" ")).toContain("do not use its visual appearance as evidence");
  });
});
