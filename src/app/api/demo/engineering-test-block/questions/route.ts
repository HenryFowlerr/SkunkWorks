import { PitchMobilePreviewAnswerSchema, PitchPreviewQuestionInputSchema } from "@/contracts";
import { createPitchMobilePreviewAdapter } from "@/server/ai/pitch-mobile-preview";
import { assertPitchRequestQuotaAvailable, consumePitchRequestQuota } from "@/server/ai/pitch-guardrails";
import { AiProviderError } from "@/server/ai/types";
import { engineeringTestBlockDemo } from "@/server/demo/engineering-test-block";
import { preparedEngineeringTestBlockAnswer } from "@/server/demo/engineering-test-block-fallback";
import { handleApiOperation, parseApiBody } from "@/server/http/api";

const demoQuota = {
  actorId: "00000000-0000-4000-8000-000000000091",
  jobId: "00000000-0000-4000-8000-000000000092",
  action: "preview_question" as const,
};

/** Luna phone chat against the exact preloaded Astra knowledge base. */
export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const body = await parseApiBody(request, PitchPreviewQuestionInputSchema);
    assertPitchRequestQuotaAvailable(demoQuota);
    consumePitchRequestQuota(demoQuota);
    let answer;
    try {
      answer = await createPitchMobilePreviewAdapter().answerDraftQuestion({
        partName: engineeringTestBlockDemo.partName,
        partNumber: engineeringTestBlockDemo.partNumber,
        question: body.question,
        knowledgeBase: engineeringTestBlockDemo.knowledgeBase,
      });
    } catch (cause) {
      if (!(cause instanceof AiProviderError)) throw cause;
      answer = preparedEngineeringTestBlockAnswer(body.question);
    }
    return PitchMobilePreviewAnswerSchema.parse(answer);
  });
}
