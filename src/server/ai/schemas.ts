import { z } from "zod";

const nullableNumber = z.number().finite().nullable();
const citationSchema = z.object({
  sourceKey: z.string(),
  excerpt: z.string(),
  // Region boxes are intentionally omitted: no deterministic page-region
  // detector exists in this lane, so a model must not invent one.
  region: z.null(),
}).strict();

const sourcedValue = <T extends z.ZodType>(value: T) => z.object({
  value: value.nullable(),
  evidenceState: z.enum(["supported", "conflict", "not_found", "unreadable"]),
  citations: z.array(citationSchema),
}).strict();

export const GenerationOutputSchema = z.object({
  bends: z.array(z.object({
    bendId: z.string(),
    finishedAngle: sourcedValue(z.object({
      degrees: nullableNumber,
      convention: z.enum(["internal", "external", "from_flat"]).nullable(),
    }).strict()),
    insideRadiusMm: sourcedValue(z.number().finite().nonnegative()),
    directionText: sourcedValue(z.string()),
  }).strict()),
  steps: z.array(z.object({
    id: z.string(),
    bendId: z.string(),
    instruction: z.string(),
    citations: z.array(citationSchema),
  }).strict()),
  machineOrder: z.array(z.string()),
  machineRationale: z.string(),
  machineCitations: z.array(citationSchema),
}).strict();
export type GenerationOutput = z.infer<typeof GenerationOutputSchema>;

export const QuestionOutputSchema = z.object({
  evidenceState: z.enum(["supported", "conflict", "not_found", "unreadable"]),
  text: z.string(),
  citations: z.array(citationSchema),
  referencedBendIds: z.array(z.string()),
  referencedStepIds: z.array(z.string()),
  suggestedFlag: z.string(),
}).strict();
export type QuestionOutput = z.infer<typeof QuestionOutputSchema>;

// OpenAI Structured Outputs require all properties to be required and objects
// to disallow additional properties. Nullable is used instead of optional.
const rawCitationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sourceKey", "excerpt", "region"],
  properties: {
    sourceKey: { type: "string" },
    excerpt: { type: "string" },
    region: { type: "null" },
  },
};

const citationList = { type: "array", items: rawCitationJsonSchema };

const sourcedJsonSchema = (valueSchema: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: ["value", "evidenceState", "citations"],
  properties: {
    value: { anyOf: [valueSchema, { type: "null" }] },
    evidenceState: { type: "string", enum: ["supported", "conflict", "not_found", "unreadable"] },
    citations: citationList,
  },
});

export const GenerationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["bends", "steps", "machineOrder", "machineRationale", "machineCitations"],
  properties: {
    bends: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["bendId", "finishedAngle", "insideRadiusMm", "directionText"],
        properties: {
          bendId: { type: "string" },
          finishedAngle: sourcedJsonSchema({
            type: "object",
            additionalProperties: false,
            required: ["degrees", "convention"],
            properties: {
              degrees: { type: ["number", "null"] },
              convention: { type: ["string", "null"], enum: ["internal", "external", "from_flat", null] },
            },
          }),
          insideRadiusMm: sourcedJsonSchema({ type: "number" }),
          directionText: sourcedJsonSchema({ type: "string" }),
        },
      },
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "bendId", "instruction", "citations"],
        properties: {
          id: { type: "string" },
          bendId: { type: "string" },
          instruction: { type: "string" },
          citations: citationList,
        },
      },
    },
    machineOrder: { type: "array", items: { type: "string" } },
    machineRationale: { type: "string" },
    machineCitations: citationList,
  },
} as const;

export const QuestionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["evidenceState", "text", "citations", "referencedBendIds", "referencedStepIds", "suggestedFlag"],
  properties: {
    evidenceState: { type: "string", enum: ["supported", "conflict", "not_found", "unreadable"] },
    text: { type: "string" },
    citations: citationList,
    referencedBendIds: { type: "array", items: { type: "string" } },
    referencedStepIds: { type: "array", items: { type: "string" } },
    suggestedFlag: { type: "string" },
  },
} as const;
