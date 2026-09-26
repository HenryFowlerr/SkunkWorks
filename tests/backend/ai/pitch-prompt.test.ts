import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import {
  PITCH_PROMPT_VERSIONS,
  PITCH_CAPABILITY_INSTRUCTIONS,
  assertPitchCitations,
  capabilityPrompt,
  issueTriagePrompt,
  type PitchCapabilityCheck,
  type PitchCapabilityInput,
  type PitchIssueTriageInput,
  type PitchKnowledgeBase,
  type PitchKnowledgeBaseInput,
} from "@/server/ai/pitch";
import { OpenAiPitchAdapter } from "@/server/ai/pitch-openai";
import type { StlVisualEvidence } from "@/server/ai/stl-visual-evidence";

const sources = [{ sourceKey: "drawing:1", label: "Prepared drawing, page 1", text: "Material thickness 2.0 mm. Return orientation must be confirmed." }];
const supplier = {
  supplierName: "Ridgeway Fabrication",
  profileVersion: "v3",
  confirmed: true,
  machines: [{ id: "brake-02", name: "Brake 02", process: "press brake", capabilities: ["Sheet capacity 3.0 mm"] }],
  sources: [{ sourceKey: "supplier:brake-02", label: "Confirmed supplier profile", text: "Brake 02 sheet capacity 3.0 mm." }],
  capabilitySourceKeys: ["supplier:brake-02"],
};

const capabilityInput: PitchCapabilityInput = { partName: "Prepared Sensor Mount", partNumber: "SKW-SM-104", pdfs: [], stlVisual: null, sources, supplier };

function adapter(output: object) {
  const create = vi.fn().mockResolvedValue({ status: "completed", output: [], output_text: JSON.stringify(output) });
  return {
    create,
    ai: new OpenAiPitchAdapter({
      client: { responses: { create } } as unknown as OpenAI,
      environment: {
        OPENAI_API_KEY: "test-key",
        OPENAI_INITIAL_MODEL: "configured-astra-model",
        OPENAI_FLOOR_MODEL: "configured-luna-model",
      },
    }),
  };
}

const capabilityOutput: PitchCapabilityCheck = {
  approvalState: "draft",
  decision: "clear_for_engineer_review",
  code: "SETUP_REVIEW_REQUIRED",
  title: "Supplier evidence supports review",
  explanation: "The supplied thickness requirement is within the supplied profile capacity; orientation still needs engineering review.",
  checks: [{ id: "material-thickness", label: "Material thickness", status: "supported", reason: "2.0 mm is within the recorded 3.0 mm capacity.", citations: [
    { sourceKey: "drawing:1", excerpt: "Material thickness 2.0 mm." },
    { sourceKey: "supplier:brake-02", excerpt: "Brake 02 sheet capacity 3.0 mm." },
  ] }],
  requiredEngineerDecisions: ["Confirm return orientation before release."],
  sourceKeysRead: ["drawing:1", "supplier:brake-02"],
};

describe("pitch prompt contracts", () => {
  it("builds a versioned, source-bounded supplier capability request", () => {
    const prompt = JSON.parse(capabilityPrompt(capabilityInput));
    expect(prompt.promptVersion).toBe(PITCH_PROMPT_VERSIONS.capability);
    expect(prompt.partSources).toEqual(sources);
    expect(prompt.supplier.evidenceSources).toEqual(supplier.sources);
    expect(prompt.supplier.capabilityEvidenceSourceKeys).toEqual(supplier.capabilitySourceKeys);
    expect(prompt.rules.join(" ")).toMatch(/error code/i);
    expect(prompt.rules.join(" ")).toMatch(/both partSources and supplier\.capabilityEvidenceSourceKeys/i);
    expect(prompt.rules.join(" ")).toMatch(/requiredEngineerDecisions instead of adding an unknown/i);
  });

  it("uses strict structured output and accepts only exact source citations", async () => {
    const { ai, create } = adapter(capabilityOutput);
    await expect(ai.assessCapability(capabilityInput)).resolves.toMatchObject({ code: "SETUP_REVIEW_REQUIRED", approvalState: "draft" });
    const request = create.mock.calls[0][0];
    expect(request.store).toBe(false);
    expect(request.model).toBe("configured-astra-model");
    expect(request.text.format.strict).toBe(true);
    expect(request.max_output_tokens).toBe(1_200);
    expect(request.instructions).toMatch(/not production authorization/i);
    expect(JSON.parse(request.input[0].content[0].text).promptVersion).toBe(PITCH_PROMPT_VERSIONS.capability);
  });

  it("attaches only the server-authorized drawing PDF at high detail for the initial capability call", async () => {
    const drawingBytes = new TextEncoder().encode("%PDF-1.4");
    const { ai, create } = adapter(capabilityOutput);
    await expect(ai.assessCapability({
      ...capabilityInput,
      pdfs: [{
        assetId: "drawing-asset",
        filename: "engineering-test-block.pdf",
        mimeType: "application/pdf",
        bytes: drawingBytes,
        pageCount: 1,
        pages: [{ page: 1, text: "60.0 mm" }],
      }],
    })).resolves.toMatchObject({ approvalState: "draft" });

    const content = create.mock.calls[0][0].input[0].content;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({
      type: "input_file",
      filename: "engineering-test-block.pdf",
      file_data: "data:application/pdf;base64,JVBERi0xLjQ=",
      detail: "high",
    });
    expect(content[1]).toMatchObject({ type: "input_text" });
  });

  it("attaches a derived STL raster only as visual orientation context, never as citable prompt data", async () => {
    const visual: StlVisualEvidence = {
      mimeType: "image/png",
      imageDataUrl: "data:image/png;base64,cGl0Y2gtdmlzdWFs",
      detail: "low",
      label: "Deterministic visual reference derived from the supplied STL. It has no declared units, scale, dimensions, tolerances, material, process, or approval state.",
    };
    const { ai, create } = adapter(capabilityOutput);
    await expect(ai.assessCapability({ ...capabilityInput, stlVisual: visual })).resolves.toMatchObject({ approvalState: "draft" });

    const request = create.mock.calls[0][0];
    const content = request.input[0].content;
    expect(content).toEqual([
      { type: "input_image", image_url: visual.imageDataUrl, detail: "low" },
      expect.objectContaining({ type: "input_text" }),
    ]);
    const prompt = JSON.parse(content[1].text);
    expect(prompt.visualReference).toEqual({ kind: "STL-derived raster", label: visual.label });
    expect(JSON.stringify(prompt)).not.toContain(visual.imageDataUrl);
    expect(PITCH_CAPABILITY_INSTRUCTIONS).toMatch(/visual-only orientation context/i);
    expect(PITCH_CAPABILITY_INSTRUCTIONS).toMatch(/never cite it or derive a numeric dimension.*material.*capability/i);
  });

  it.each([
    ["failed", true],
    ["cancelled", true],
    ["incomplete", false],
  ] as const)("maps a %s provider response to a provider failure instead of client validation", async (status, retryable) => {
    const create = vi.fn().mockResolvedValue({ status, output: [], output_text: "" });
    const ai = new OpenAiPitchAdapter({
      client: { responses: { create } } as unknown as OpenAI,
      environment: {
        OPENAI_API_KEY: "test-key",
        OPENAI_INITIAL_MODEL: "configured-astra-model",
        OPENAI_FLOOR_MODEL: "configured-luna-model",
      },
    });

    await expect(ai.assessCapability(capabilityInput)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      retryable,
    });
  });

  it("rejects a capability result that cites a made-up excerpt", async () => {
    const invalid = structuredClone(capabilityOutput);
    invalid.checks[0].citations[0].excerpt = "Material thickness 9.0 mm.";
    const { ai } = adapter(invalid);
    await expect(ai.assessCapability(capabilityInput)).rejects.toMatchObject({ code: "UNSUPPORTED_CLAIM" });
  });

  it("rejects a claimed capability conflict without two independent sources", async () => {
    const invalid = structuredClone(capabilityOutput);
    invalid.decision = "blocked";
    invalid.code = "CAPABILITY_CONFLICT";
    invalid.checks[0].status = "conflict";
    invalid.checks[0].citations = [{ sourceKey: "drawing:1", excerpt: "Material thickness 2.0 mm." }];
    const { ai } = adapter(invalid);
    await expect(ai.assessCapability(capabilityInput)).rejects.toMatchObject({ code: "UNSUPPORTED_CLAIM" });
  });

  it("rejects a clear result for an unconfirmed supplier profile", async () => {
    const { ai } = adapter(capabilityOutput);
    await expect(ai.assessCapability({ ...capabilityInput, supplier: { ...supplier, confirmed: false } })).rejects.toMatchObject({ code: "UNSUPPORTED_CLAIM" });
  });

  it("rejects a clear result without a confirmed machine-limit or tooling source", async () => {
    const { ai } = adapter(capabilityOutput);
    await expect(ai.assessCapability({
      ...capabilityInput,
      supplier: { ...supplier, capabilitySourceKeys: [] },
    })).rejects.toMatchObject({ code: "UNSUPPORTED_CLAIM" });
  });

  it.each([
    { name: "drawing-only", citations: [{ sourceKey: "drawing:1", excerpt: "Material thickness 2.0 mm." }] },
    { name: "supplier-only", citations: [{ sourceKey: "supplier:brake-02", excerpt: "Brake 02 sheet capacity 3.0 mm." }] },
  ])("rejects a clear $name result without a drawing-to-supplier comparison", async ({ citations }) => {
    const invalid = structuredClone(capabilityOutput);
    invalid.checks[0].citations = citations;
    invalid.sourceKeysRead = citations.map((citation) => citation.sourceKey);
    const { ai } = adapter(invalid);
    await expect(ai.assessCapability(capabilityInput)).rejects.toMatchObject({ code: "UNSUPPORTED_CLAIM" });
  });

  it("keeps non-clear results available when a supported check lacks a supplier comparison", async () => {
    const incomplete = structuredClone(capabilityOutput);
    incomplete.decision = "needs_supplier_input";
    incomplete.code = "SETUP_REVIEW_REQUIRED";
    incomplete.checks[0].citations = [{ sourceKey: "drawing:1", excerpt: "Material thickness 2.0 mm." }];
    incomplete.sourceKeysRead = ["drawing:1"];
    const { ai } = adapter(incomplete);
    await expect(ai.assessCapability(capabilityInput)).resolves.toMatchObject({ decision: "needs_supplier_input" });
  });

  it.each(["unknown", "unreadable"] as const)("rejects a clear result with a %s capability check", async (status) => {
    const invalid = structuredClone(capabilityOutput);
    invalid.checks.push({
      id: `${status}-profile-fact`,
      label: "Supplier setup evidence",
      status,
      reason: "The supplied packet does not establish this setup fact.",
      citations: [],
    });
    const { ai } = adapter(invalid);
    await expect(ai.assessCapability(capabilityInput)).rejects.toMatchObject({ code: "UNSUPPORTED_CLAIM" });
  });

  it("allows an isolated numeric drawing callout while rejecting a bare unit fragment", () => {
    const drawing = [{ sourceKey: "drawing:dimension", label: "Test block drawing", text: "30.0\n60.0\nØ10.0\nmm" }];
    expect(() => assertPitchCitations([{ sourceKey: "drawing:dimension", excerpt: "60.0" }], drawing)).not.toThrow();
    expect(() => assertPitchCitations([{ sourceKey: "drawing:dimension", excerpt: "Ø10.0" }], drawing)).not.toThrow();
    expect(() => assertPitchCitations([{ sourceKey: "drawing:dimension", excerpt: "mm" }], drawing)).toThrow(/unsupported evidence/i);
  });

  it("allows a short exact sequence of adjacent numeric drawing callouts", () => {
    const drawing = [{ sourceKey: "drawing:section", label: "Test block section", text: "60.0\n60.0\n10.0(TYP)" }];
    expect(() => assertPitchCitations([
      { sourceKey: "drawing:section", excerpt: "60.0\n60.0" },
    ], drawing)).not.toThrow();
    expect(() => assertPitchCitations([
      { sourceKey: "drawing:section", excerpt: "60.0 60.0 10.0 15.0" },
    ], drawing)).toThrow(/unsupported evidence/i);
  });

  it("accepts a source citation when PDF extraction changes only presentation casing", () => {
    const drawing = [{
      sourceKey: "drawing:notes",
      label: "Test block drawing notes",
      text: "ALL DIMENSIONS IN MILLIMETERS.",
    }];
    expect(() => assertPitchCitations([
      { sourceKey: "drawing:notes", excerpt: "All dimensions in millimeters." },
    ], drawing)).not.toThrow();
    expect(() => assertPitchCitations([
      { sourceKey: "drawing:notes", excerpt: "All dimensions in inches." },
    ], drawing)).toThrow(/unsupported evidence/i);
  });

  it("prepares a draft knowledge base and issue triage without letting either publish content", async () => {
    const knowledgeOutput: PitchKnowledgeBase = {
      approvalState: "draft", title: "Prepared Sensor Mount knowledge base",
      titleCitations: [{ sourceKey: "drawing:1", excerpt: "Material thickness 2.0 mm." }],
      partSummary: "The supplied drawing identifies material thickness as 2.0 mm.",
      partSummaryCitations: [{ sourceKey: "drawing:1", excerpt: "Material thickness 2.0 mm." }],
      sourceSummary: "The supplied drawing requires return-orientation confirmation.",
      sourceSummaryCitations: [{ sourceKey: "drawing:1", excerpt: "Return orientation must be confirmed." }],
      operatorSteps: [{ id: "orient", title: "Confirm orientation", instruction: "Confirm the return orientation with engineering before proceeding.", guidanceKind: "attention", citations: [{ sourceKey: "drawing:1", excerpt: "Return orientation must be confirmed." }] }],
      attentionPoints: [{ title: "Return orientation", instruction: "Keep this item for engineer review.", reason: "The drawing asks for confirmation.", citations: [{ sourceKey: "drawing:1", excerpt: "Return orientation must be confirmed." }] }],
      openQuestions: ["How should the return orientation be confirmed before setup?"],
      openQuestionCitations: [[{ sourceKey: "drawing:1", excerpt: "Return orientation must be confirmed." }]],
      recommendedPhoneStartStepId: "orient",
    };
    const knowledgeInput: PitchKnowledgeBaseInput = { ...capabilityInput, capability: capabilityOutput };
    const knowledge = adapter(knowledgeOutput);
    await expect(knowledge.ai.createKnowledgeBase(knowledgeInput)).resolves.toMatchObject({ approvalState: "draft", recommendedPhoneStartStepId: "orient" });
    expect(knowledge.create.mock.calls[0][0].instructions).toMatch(/must edit and explicitly approve/i);
    expect(knowledge.create.mock.calls[0][0].instructions).toMatch(/no more than three compact operator step candidates/i);
    expect(knowledge.create.mock.calls[0][0].instructions).toMatch(/useful to create an "attention" step/i);
    expect(knowledge.create.mock.calls[0][0].model).toBe("configured-astra-model");
    expect(knowledge.create.mock.calls[0][0].max_output_tokens).toBe(1_800);
    expect(knowledge.create.mock.calls[0][0].input[0].content).toHaveLength(1);
    expect(JSON.parse(knowledge.create.mock.calls[0][0].input[0].content[0].text).promptVersion).toBe(PITCH_PROMPT_VERSIONS.knowledgeBase);

    const uncitedKnowledge = structuredClone(knowledgeOutput);
    uncitedKnowledge.operatorSteps[0].citations = [];
    const uncited = adapter(uncitedKnowledge);
    await expect(uncited.ai.createKnowledgeBase(knowledgeInput)).rejects.toMatchObject({ code: "UNSUPPORTED_CLAIM" });

    const unsupportedSummary = structuredClone(knowledgeOutput);
    unsupportedSummary.partSummaryCitations = [{ sourceKey: "drawing:1", excerpt: "Material thickness 9.0 mm." }];
    await expect(adapter(unsupportedSummary).ai.createKnowledgeBase(knowledgeInput)).rejects.toMatchObject({ code: "UNSUPPORTED_CLAIM" });

    const invalidStartStep = structuredClone(knowledgeOutput);
    invalidStartStep.recommendedPhoneStartStepId = "missing-step";
    await expect(adapter(invalidStartStep).ai.createKnowledgeBase(knowledgeInput)).rejects.toMatchObject({ code: "MALFORMED_OUTPUT" });

    const blockedCapability: PitchCapabilityCheck = {
      ...capabilityOutput,
      decision: "blocked",
      code: "CAPABILITY_CONFLICT",
      checks: [{ ...capabilityOutput.checks[0], status: "conflict", citations: capabilityOutput.checks[0].citations }],
    };
    await expect(knowledge.ai.createKnowledgeBase({ ...knowledgeInput, capability: blockedCapability })).rejects.toMatchObject({ code: "UNSUPPORTED_CLAIM" });

    const triageOutput = {
      approvalState: "draft", severity: "hold", title: "Confirm return orientation", summary: "The operator reported an orientation concern.", affectedOperation: "B2",
      knownEvidence: ["The drawing requires orientation confirmation."], unknowns: ["Fixture clearance is not recorded."],
      knownEvidenceCitations: [[{ sourceKey: "drawing:1", excerpt: "Return orientation must be confirmed." }]],
      engineerDecisionNeeded: "Confirm the intended orientation and whether work may resume.",
      suggestedReply: "Keep this operation on hold while engineering confirms the orientation.",
      citations: [{ sourceKey: "drawing:1", excerpt: "Return orientation must be confirmed." }],
    };
    const triageInput: PitchIssueTriageInput = {
      partName: capabilityInput.partName, partNumber: capabilityInput.partNumber,
      issue: { operation: "B2", text: "The return flange orientation is unclear." }, sources,
      knowledgeBase: knowledgeOutput,
    };
    const triage = adapter(triageOutput);
    await expect(triage.ai.triageIssue(triageInput)).resolves.toMatchObject({ approvalState: "draft", severity: "hold" });
    expect(triage.create.mock.calls[0][0].instructions).toMatch(/Never resolve the issue/i);
    expect(triage.create.mock.calls[0][0].model).toBe("configured-luna-model");
    expect(triage.create.mock.calls[0][0].max_output_tokens).toBe(900);
    expect(triage.create.mock.calls[0][0].reasoning).toEqual({ effort: "none" });
    expect(triage.create.mock.calls[0][0].input[0].content).toHaveLength(1);
    expect(JSON.parse(triage.create.mock.calls[0][0].input[0].content[0].text).promptVersion).toBe(PITCH_PROMPT_VERSIONS.issueTriage);
    expect(triage.create.mock.calls[0][0].text.format.schema.properties.severity.enum).toEqual(["hold"]);
    expect(JSON.parse(issueTriagePrompt(triageInput)).rules.join(" ")).toMatch(/severity must be hold/i);
    expect(JSON.parse(issueTriagePrompt(triageInput)).rules.join(" ")).toMatch(/no more than two short knownEvidence/i);
    expect(JSON.parse(issueTriagePrompt(triageInput)).rules.join(" ")).not.toMatch(/review or information/i);

    const uncitedKnownEvidence = structuredClone(triageOutput);
    uncitedKnownEvidence.knownEvidenceCitations = [[]];
    await expect(adapter(uncitedKnownEvidence).ai.triageIssue(triageInput)).rejects.toMatchObject({ code: "MALFORMED_OUTPUT" });

    const mismatchedOperation = structuredClone(triageOutput);
    mismatchedOperation.affectedOperation = "B1";
    await expect(adapter(mismatchedOperation).ai.triageIssue(triageInput)).rejects.toMatchObject({ code: "UNSUPPORTED_CLAIM" });

    const nonHoldTriage = structuredClone(triageOutput);
    nonHoldTriage.severity = "information";
    await expect(adapter(nonHoldTriage).ai.triageIssue(triageInput)).rejects.toMatchObject({ code: "UNSUPPORTED_CLAIM" });
  });
});
