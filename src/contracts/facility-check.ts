import { z } from "zod";
import { IdSchema } from "./domain";

const text = z.string().trim().min(1);

export const FacilityRequirementSourceSchema = z.object({
  assetId: IdSchema,
  page: z.number().int().positive(),
  excerpt: text.max(1000),
}).strict();

const requirementBase = {
  id: IdSchema,
  label: text.max(160),
  source: FacilityRequirementSourceSchema,
};

export const FacilityRequirementSchema = z.discriminatedUnion("kind", [
  z.object({ ...requirementBase, kind: z.literal("bend_length"), requiredMm: z.number().finite().positive() }).strict(),
  z.object({ ...requirementBase, kind: z.literal("process"), requiredProcess: text.max(160) }).strict(),
  z.object({ ...requirementBase, kind: z.literal("tool"), requiredTool: text.max(160) }).strict(),
  z.object({ ...requirementBase, kind: z.literal("access"), operation: text.max(1000) }).strict(),
]);
export type FacilityRequirement = z.infer<typeof FacilityRequirementSchema>;

export const FacilityCheckBodySchema = z.object({
  expectedJobVersion: z.number().int().positive(),
  requirements: z.array(FacilityRequirementSchema).min(1).max(20),
}).strict().superRefine((body, ctx) => {
  const ids = body.requirements.map((requirement) => requirement.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", path: ["requirements"], message: "Requirement IDs must be unique." });
  }
});
export type FacilityCheckBody = z.infer<typeof FacilityCheckBodySchema>;

export const FacilityAssessmentSchema = z.object({
  requirement: FacilityRequirementSchema,
  status: z.enum(["supported", "conflict", "unknown"]),
  explanation: text,
  facilityBasis: z.array(text),
}).strict();
export type FacilityAssessment = z.infer<typeof FacilityAssessmentSchema>;

export const FacilityCheckResultSchema = z.object({
  jobVersion: z.number().int().positive(),
  workshopSnapshotId: IdSchema,
  workshopName: text,
  workshopVersion: z.number().int().positive(),
  machineId: IdSchema,
  machineName: text,
  assessments: z.array(FacilityAssessmentSchema),
  summary: z.object({
    supported: z.number().int().nonnegative(),
    conflict: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type FacilityCheckResult = z.infer<typeof FacilityCheckResultSchema>;
