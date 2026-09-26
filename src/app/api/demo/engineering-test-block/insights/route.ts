import { PitchDemoInsightSchema, PitchIssueInputSchema } from "@/contracts";
import { createPitchAiAdapter } from "@/server/ai";
import { assertPitchRequestQuotaAvailable, consumePitchRequestQuota } from "@/server/ai/pitch-guardrails";
import { engineeringTestBlockDemo } from "@/server/demo/engineering-test-block";
import {
  listEngineeringTestBlockInsights,
  recordEngineeringTestBlockInsight,
} from "@/server/demo/engineering-test-block-insights";
import { handleApiOperation, parseApiBody } from "@/server/http/api";
import { z } from "zod";

const demoQuota = {
  actorId: "00000000-0000-4000-8000-000000000091",
  jobId: "00000000-0000-4000-8000-000000000092",
  action: "triage" as const,
};

/** The engineer page polls this small prepared-demo inbox. */
export async function GET(): Promise<Response> {
  return handleApiOperation(async () => z.array(PitchDemoInsightSchema).parse(listEngineeringTestBlockInsights()));
}

/** Luna turns a floor observation into a short hold-preserving engineer insight. */
export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const issue = await parseApiBody(request, PitchIssueInputSchema);
    assertPitchRequestQuotaAvailable(demoQuota);
    consumePitchRequestQuota(demoQuota);
    const triage = await createPitchAiAdapter().triageIssue({
      partName: engineeringTestBlockDemo.partName,
      partNumber: engineeringTestBlockDemo.partNumber,
      issue,
      sources: engineeringTestBlockDemo.sources,
      knowledgeBase: engineeringTestBlockDemo.knowledgeBase,
    });
    return PitchDemoInsightSchema.parse(recordEngineeringTestBlockInsight({ issue, triage }));
  });
}
