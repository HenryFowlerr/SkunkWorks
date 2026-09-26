import { describe, expect, it } from "vitest";
import { retrieveQuestionKnowledge } from "../../../src/server/ai/knowledge-base";
import { validateCitations } from "../../../src/server/ai/grounding";
import type { PreparedEvidence, QuestionInput } from "../../../src/server/ai/types";

const jobId = "10000000-0000-4000-8000-000000000001";
const releaseId = "10000000-0000-4000-8000-000000000002";
const assetId = "10000000-0000-4000-8000-000000000003";

function question(text: string): QuestionInput {
  return {
    context: { jobId, releaseId, draftId: null, draftVersion: null, stepId: null, bendId: "B2" },
    question: text,
    pdfs: [],
    sources: [],
    workshopSnapshot: null,
    knownBendIds: ["B2"],
    knownStepTargets: [],
  };
}

function page(pageNumber: number, text: string): PreparedEvidence {
  const target = { kind: "document" as const, assetId, page: pageNumber, text };
  return {
    sourceKey: `document:${assetId}:${pageNumber}`,
    label: `Drawing A, page ${pageNumber}`,
    text,
    target,
    reference: { kind: "document", assetId, page: pageNumber, region: null, excerpt: "" },
  };
}

describe("request-local question knowledge", () => {
  it("keeps every verified page in a small packet, including conflicting statements", () => {
    const evidence = [page(1, "B2 return flange angle 90 degrees."), page(2, "B2 return flange angle 95 degrees.")];
    const knowledge = retrieveQuestionKnowledge(question("What is the B2 angle?"), evidence);
    expect(knowledge.selection).toBe("complete_packet");
    expect(knowledge.evidence.map((item) => item.sourceKey)).toEqual(evidence.map((item) => item.sourceKey));
  });

  it("retrieves bounded, citable chunks from a large authorised packet", () => {
    const irrelevant = Array.from({ length: 9 }, (_, index) => page(index + 1, `Inventory ${index} ` + "ordinary packing details ".repeat(90)));
    const relevant = page(10, "unrelated text ".repeat(85) + "B2 fixture clearance is not recorded in the selected profile. " + "unrelated text ".repeat(85));
    const knowledge = retrieveQuestionKnowledge(question("Is B2 fixture clearance recorded?"), [...irrelevant, relevant]);
    expect(knowledge.selection).toBe("retrieved_excerpts");
    expect(knowledge.catalogChunks).toBeGreaterThan(10);
    expect(knowledge.evidence.some((item) => item.text.includes("B2 fixture clearance is not recorded"))).toBe(true);
    expect(knowledge.evidence.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(12_000);
    const cited = knowledge.evidence.find((item) => item.text.includes("B2 fixture clearance is not recorded"))!;
    expect(validateCitations([{ sourceKey: cited.sourceKey, excerpt: "B2 fixture clearance is not recorded", region: null }], knowledge.evidence))
      .toEqual([{ kind: "document", assetId, page: 10, region: null, excerpt: "B2 fixture clearance is not recorded" }]);
  });

  it("returns no match rather than arbitrary unrelated excerpts when a large packet has no relevant terms", () => {
    const evidence = Array.from({ length: 12 }, (_, index) => page(index + 1, "packaging inventory notes ".repeat(80)));
    const knowledge = retrieveQuestionKnowledge(question("What is the B2 fixture clearance?"), evidence);
    expect(knowledge.selection).toBe("no_match");
    expect(knowledge.evidence).toEqual([]);
  });
});
