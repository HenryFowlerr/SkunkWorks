import { z } from "zod";
import { AnswerSchema, IdSchema } from "./domain";

export const SuggestFlagReplyBodySchema = z.object({
  flagId: IdSchema,
  expectedVersion: z.number().int().positive(),
}).strict();

export const FlagReplySuggestionSchema = z.object({
  flagId: IdSchema,
  flagVersion: z.number().int().positive(),
  approvalState: z.literal("draft"),
  promptVersion: z.string().min(1),
  answer: AnswerSchema,
}).strict();
export type FlagReplySuggestion = z.infer<typeof FlagReplySuggestionSchema>;
