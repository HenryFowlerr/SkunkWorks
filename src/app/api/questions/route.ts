import { AnswerSchema, AskQuestionInputSchema } from "@/contracts";
import { getJobApiContext } from "@/server/api/context";
import { loadQuestionInput } from "@/server/api/load-question-input";
import { createAiAdapter } from "@/server/ai";
import { assertFloorRequestQuotaAvailable, consumeFloorRequestQuota } from "@/server/ai/floor-guardrails";
import { ApiFault, handleApiOperation, parseApiBody } from "@/server/http/api";

/** Member-only until a separately scoped QR visitor exchange is implemented. */
export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const input = await parseApiBody(request, AskQuestionInputSchema);
    if (input.question.length > 2_000) {
      throw new ApiFault("VALIDATION_FAILED", "Keep the question under 2,000 characters.");
    }
    if (input.context.releaseId === null) {
      throw new ApiFault("REVIEW_REQUIRED", "Questions require a published release, not a draft.");
    }
    const { repository, actor } = await getJobApiContext(input.context.jobId);
    const quotaKey = { actorId: actor.id, jobId: input.context.jobId, action: "question" as const };
    assertFloorRequestQuotaAvailable(quotaKey);
    const aiInput = await loadQuestionInput(repository, input);
    consumeFloorRequestQuota(quotaKey);
    const { model: _model, ...answer } = await createAiAdapter().answerQuestion(aiInput);
    void _model;
    return AnswerSchema.parse(answer);
  });
}
