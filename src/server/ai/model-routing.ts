import "server-only";

import { AiProviderError } from "./types";

export type AiModelEnvironment = Record<string, string | undefined>;

/**
 * Only the high-detail pitch capability scan and pitch knowledge-base draft
 * use the initial-analysis model. OPENAI_MODEL is accepted only as a legacy
 * alias for this role so an older deployment cannot silently route floor work
 * to Astra.
 */
export function initialAnalysisModel(environment: AiModelEnvironment = process.env): string {
  return requiredModel(environment.OPENAI_INITIAL_MODEL ?? environment.OPENAI_MODEL);
}

/**
 * Generation, floor questions, engineer reply drafts, and issue triage have
 * their own explicit model setting. There is intentionally no OPENAI_MODEL
 * fallback: a legacy Astra-only setting must fail closed rather than serve
 * the floor.
 */
export function floorAssistantModel(environment: AiModelEnvironment = process.env): string {
  return requiredModel(environment.OPENAI_FLOOR_MODEL);
}

function requiredModel(raw: string | undefined): string {
  const model = raw?.trim();
  if (!model) throw new AiProviderError("MISSING_MODEL_CONFIGURATION");
  return model;
}
