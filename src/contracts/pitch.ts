import { z } from "zod";

/**
 * Browser-safe contract for the non-persistent pitch analysis endpoints.
 * Prompts and provider configuration deliberately remain server-only.
 */
const text = z.string().trim().min(1);
const citationText = z.string().trim().min(1).max(600);

export const PitchCitationSchema = z.object({
  sourceKey: text.max(200),
  excerpt: citationText,
}).strict();
export type PitchCitation = z.infer<typeof PitchCitationSchema>;

const CitationListSchema = z.array(PitchCitationSchema).max(12);
const RequiredCitationListSchema = CitationListSchema.min(1);
const CheckStatusSchema = z.enum(["supported", "conflict", "unknown", "unreadable"]);

export const PitchCapabilityCheckSchema = z.object({
  approvalState: z.literal("draft"),
  decision: z.enum(["clear_for_engineer_review", "blocked", "needs_supplier_input"]),
  code: z.enum([
    "PITCH_CHECK_CLEAR",
    "CAPABILITY_CONFLICT",
    "SUPPLIER_PROFILE_UNCONFIRMED",
    "SOURCE_EVIDENCE_MISSING",
    "SETUP_REVIEW_REQUIRED",
  ]),
  title: text.max(180),
  explanation: text.max(1_000),
  checks: z.array(z.object({
    id: text.max(160),
    label: text.max(240),
    status: CheckStatusSchema,
    reason: text.max(1_000),
    citations: CitationListSchema,
  }).strict()).min(1).max(30),
  requiredEngineerDecisions: z.array(text.max(600)).max(12),
  sourceKeysRead: z.array(text.max(200)).max(120),
}).strict();
export type PitchCapabilityCheck = z.infer<typeof PitchCapabilityCheckSchema>;

export const PitchKnowledgeBaseSchema = z.object({
  approvalState: z.literal("draft"),
  title: text.max(180),
  titleCitations: RequiredCitationListSchema,
  partSummary: text.max(1_000),
  partSummaryCitations: RequiredCitationListSchema,
  sourceSummary: text.max(1_000),
  sourceSummaryCitations: RequiredCitationListSchema,
  operatorSteps: z.array(z.object({
    id: text.max(160),
    title: text.max(180),
    instruction: text.max(1_000),
    guidanceKind: z.enum(["routine", "attention", "unknown"]),
    citations: CitationListSchema,
  }).strict()).max(12),
  attentionPoints: z.array(z.object({
    title: text.max(180),
    instruction: text.max(1_000),
    reason: text.max(1_000),
    citations: CitationListSchema,
  }).strict()).max(5),
  openQuestions: z.array(text.max(800)).max(12),
  /** Parallel citation lists preserve the simple open-question display type. */
  openQuestionCitations: z.array(RequiredCitationListSchema).max(12),
  recommendedPhoneStartStepId: z.string().trim().max(160).nullable(),
}).strict().superRefine((knowledgeBase, ctx) => {
  if (knowledgeBase.openQuestionCitations.length !== knowledgeBase.openQuestions.length) {
    ctx.addIssue({ code: "custom", path: ["openQuestionCitations"], message: "Each open question needs a parallel cited evidence list." });
  }
  const stepIds = knowledgeBase.operatorSteps.map((step) => step.id);
  if (new Set(stepIds).size !== stepIds.length) {
    ctx.addIssue({ code: "custom", path: ["operatorSteps"], message: "Knowledge-base operator step IDs must be unique." });
  }
  if (knowledgeBase.recommendedPhoneStartStepId !== null && !stepIds.includes(knowledgeBase.recommendedPhoneStartStepId)) {
    ctx.addIssue({ code: "custom", path: ["recommendedPhoneStartStepId"], message: "The recommended phone step must name an operator step." });
  }
});
export type PitchKnowledgeBase = z.infer<typeof PitchKnowledgeBaseSchema>;

export const PitchIssueTriageSchema = z.object({
  approvalState: z.literal("draft"),
  severity: z.enum(["hold", "review", "information"]),
  title: text.max(180),
  summary: text.max(1_000),
  affectedOperation: text.max(180).nullable(),
  knownEvidence: z.array(text.max(800)).max(12),
  /** Every known-evidence entry is a cited source fact; operator reports stay in summary. */
  knownEvidenceCitations: z.array(RequiredCitationListSchema).max(12),
  unknowns: z.array(text.max(800)).max(12),
  engineerDecisionNeeded: text.max(1_000),
  suggestedReply: text.max(1_000),
  citations: CitationListSchema,
}).strict().superRefine((triage, ctx) => {
  if (triage.knownEvidenceCitations.length !== triage.knownEvidence.length) {
    ctx.addIssue({ code: "custom", path: ["knownEvidenceCitations"], message: "Each known-evidence item needs a parallel citation list." });
  }
});
export type PitchIssueTriage = z.infer<typeof PitchIssueTriageSchema>;

export const PitchIssueInputSchema = z.object({
  operation: z.string().trim().max(180).nullable(),
  text: z.string().trim().min(4).max(1_000),
}).strict();
export type PitchIssueInput = z.infer<typeof PitchIssueInputSchema>;

const PitchRequestBaseSchema = z.object({
  expectedJobVersion: z.number().int().positive(),
});

export const PitchRequestBodySchema = z.discriminatedUnion("action", [
  PitchRequestBaseSchema.extend({ action: z.literal("capability") }).strict(),
  PitchRequestBaseSchema.extend({ action: z.literal("knowledge_base") }).strict(),
  PitchRequestBaseSchema.extend({ action: z.literal("triage"), issue: PitchIssueInputSchema }).strict(),
]);
export type PitchRequestBody = z.infer<typeof PitchRequestBodySchema>;

export const PitchAnalysisResultSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("capability"), capability: PitchCapabilityCheckSchema }).strict(),
  z.object({ action: z.literal("knowledge_base"), capability: PitchCapabilityCheckSchema, knowledgeBase: PitchKnowledgeBaseSchema.nullable() }).strict(),
  z.object({ action: z.literal("triage"), triage: PitchIssueTriageSchema }).strict(),
]);
export type PitchAnalysisResult = z.infer<typeof PitchAnalysisResultSchema>;

// These strict JSON Schemas mirror the public response contracts above for the
// server-only Responses API call. Keeping them here prevents browser parsing
// and provider output validation from silently diverging.
const citationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sourceKey", "excerpt"],
  properties: { sourceKey: { type: "string" }, excerpt: { type: "string" } },
} as const;
const citationListJsonSchema = { type: "array", maxItems: 12, items: citationJsonSchema } as const;
const requiredCitationListJsonSchema = { type: "array", minItems: 1, maxItems: 12, items: citationJsonSchema } as const;

export const PitchCapabilityJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["approvalState", "decision", "code", "title", "explanation", "checks", "requiredEngineerDecisions", "sourceKeysRead"],
  properties: {
    approvalState: { type: "string", enum: ["draft"] },
    decision: { type: "string", enum: ["clear_for_engineer_review", "blocked", "needs_supplier_input"] },
    code: { type: "string", enum: ["PITCH_CHECK_CLEAR", "CAPABILITY_CONFLICT", "SUPPLIER_PROFILE_UNCONFIRMED", "SOURCE_EVIDENCE_MISSING", "SETUP_REVIEW_REQUIRED"] },
    title: { type: "string" },
    explanation: { type: "string" },
    checks: {
      type: "array", minItems: 1, maxItems: 30,
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "label", "status", "reason", "citations"],
        properties: {
          id: { type: "string" }, label: { type: "string" },
          status: { type: "string", enum: ["supported", "conflict", "unknown", "unreadable"] },
          reason: { type: "string" }, citations: citationListJsonSchema,
        },
      },
    },
    requiredEngineerDecisions: { type: "array", maxItems: 12, items: { type: "string" } },
    sourceKeysRead: { type: "array", maxItems: 120, items: { type: "string" } },
  },
} as const;

export const PitchKnowledgeBaseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "approvalState", "title", "titleCitations", "partSummary", "partSummaryCitations", "sourceSummary", "sourceSummaryCitations",
    "operatorSteps", "attentionPoints", "openQuestions", "openQuestionCitations", "recommendedPhoneStartStepId",
  ],
  properties: {
    approvalState: { type: "string", enum: ["draft"] },
    title: { type: "string" }, titleCitations: requiredCitationListJsonSchema,
    partSummary: { type: "string" }, partSummaryCitations: requiredCitationListJsonSchema,
    sourceSummary: { type: "string" }, sourceSummaryCitations: requiredCitationListJsonSchema,
    operatorSteps: {
      type: "array", maxItems: 12,
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "title", "instruction", "guidanceKind", "citations"],
        properties: {
          id: { type: "string" }, title: { type: "string" }, instruction: { type: "string" },
          guidanceKind: { type: "string", enum: ["routine", "attention", "unknown"] }, citations: citationListJsonSchema,
        },
      },
    },
    attentionPoints: {
      type: "array", maxItems: 5,
      items: {
        type: "object", additionalProperties: false,
        required: ["title", "instruction", "reason", "citations"],
        properties: { title: { type: "string" }, instruction: { type: "string" }, reason: { type: "string" }, citations: citationListJsonSchema },
      },
    },
    openQuestions: { type: "array", maxItems: 12, items: { type: "string" } },
    openQuestionCitations: { type: "array", maxItems: 12, items: requiredCitationListJsonSchema },
    recommendedPhoneStartStepId: { type: ["string", "null"] },
  },
} as const;

export const PitchIssueTriageJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["approvalState", "severity", "title", "summary", "affectedOperation", "knownEvidence", "knownEvidenceCitations", "unknowns", "engineerDecisionNeeded", "suggestedReply", "citations"],
  properties: {
    approvalState: { type: "string", enum: ["draft"] },
    // Pitch triage can only preserve the hold; a human engineer owns any
    // later continuation decision. Keep this strict provider schema aligned
    // with the runtime validator below.
    severity: { type: "string", enum: ["hold"] },
    title: { type: "string" }, summary: { type: "string" },
    affectedOperation: { type: ["string", "null"] },
    knownEvidence: { type: "array", maxItems: 12, items: { type: "string" } },
    knownEvidenceCitations: { type: "array", maxItems: 12, items: requiredCitationListJsonSchema },
    unknowns: { type: "array", maxItems: 12, items: { type: "string" } },
    engineerDecisionNeeded: { type: "string" }, suggestedReply: { type: "string" }, citations: citationListJsonSchema,
  },
} as const;
