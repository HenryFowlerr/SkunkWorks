import "server-only";

import { randomUUID } from "node:crypto";
import {
  PitchDemoInsightSchema,
  type PitchDemoInsight,
  type PitchIssueInput,
  type PitchIssueTriage,
} from "@/contracts";

const MAX_INSIGHTS = 12;
const MAX_AGE_MS = 2 * 60 * 60 * 1_000;

type InsightMemory = { insights: PitchDemoInsight[] };
const memoryKey = Symbol.for("skunkworks.engineering-test-block-insights");

function memory(): InsightMemory {
  const root = globalThis as typeof globalThis & { [memoryKey]?: InsightMemory };
  if (!root[memoryKey]) root[memoryKey] = { insights: [] };
  const cutoff = Date.now() - MAX_AGE_MS;
  root[memoryKey].insights = root[memoryKey].insights.filter((item) => Date.parse(item.createdAt) >= cutoff);
  return root[memoryKey];
}

/**
 * Demonstration-only handoff store. It deliberately remains small and
 * process-local because the user asked to avoid database work for this pitch.
 * A restart clears only the temporary insight inbox; the preloaded knowledge
 * base remains available.
 */
export function recordEngineeringTestBlockInsight(input: {
  issue: PitchIssueInput;
  triage: PitchIssueTriage;
}): PitchDemoInsight {
  const item = PitchDemoInsightSchema.parse({
    id: randomUUID(),
    issue: input.issue,
    triage: input.triage,
    createdAt: new Date().toISOString(),
  });
  const store = memory();
  store.insights = [item, ...store.insights].slice(0, MAX_INSIGHTS);
  return item;
}

export function listEngineeringTestBlockInsights(): PitchDemoInsight[] {
  return memory().insights;
}
