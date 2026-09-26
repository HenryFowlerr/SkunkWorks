import "server-only";

import { AiProviderError } from "./types";

export type AiModelEnvironment = Record<string, string | undefined>;
const DEFAULT_INITIAL_ANALYSIS_MODEL = "gpt-6-astra";
const DEFAULT_FLOOR_MODEL = "gpt-6-luna";

/**
 * Only the high-detail pitch capability scan and pitch knowledge-base draft
 * use the initial-analysis model. The defaults preserve the required pitch
 * routing on a deployment that has only the server key configured.
 */
export function initialAnalysisModel(environment: AiModelEnvironment = process.env): string {
  return requiredModel(environment.OPENAI_INITIAL_MODEL ?? environment.OPENAI_MODEL ?? DEFAULT_INITIAL_ANALYSIS_MODEL);
}

/**
 * Generation, floor questions, engineer reply drafts, and issue triage use
 * Luna by default. OPENAI_MODEL never affects this route, so a legacy Astra
 * setting cannot silently serve floor work.
 */
export function floorAssistantModel(environment: AiModelEnvironment = process.env): string {
  return requiredModel(environment.OPENAI_FLOOR_MODEL ?? DEFAULT_FLOOR_MODEL);
}

function requiredModel(raw: string | undefined): string {
  const model = raw?.trim();
  if (!model) throw new AiProviderError("MISSING_MODEL_CONFIGURATION");
  return model;
}
