import { AskQuestionInputSchema } from "@/contracts";
import { answerReleaseQuestion } from "@/server/ai/release-question";
import { resolveReleaseFeedbackScope } from "@/server/data/feedback-access";
import { recordReleaseQuestion } from "@/server/data/feedback";
import { ApiFault, handleApiOperation, parseApiBody } from "@/server/http/api";

export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const body = await parseApiBody(request, AskQuestionInputSchema);
    if (!body.context.releaseId || body.context.draftId !== null) {
      throw new ApiFault("VALIDATION_FAILED", "Floor questions require a published release.");
    }
    if (body.question.length > 2000) {
      throw new ApiFault("VALIDATION_FAILED", "Keep the question under 2,000 characters.");
    }
    const scope = await resolveReleaseFeedbackScope(body.context.releaseId);
    const answer = await answerReleaseQuestion(scope, body.context, body.question.trim());
    return recordReleaseQuestion({
      answer, question: body.question.trim(),
      actorId: scope.actorId, sessionHash: scope.sessionHash,
    });
  }, { status: 201 });
}
