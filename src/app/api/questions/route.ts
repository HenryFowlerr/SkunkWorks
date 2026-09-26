import { AnswerSchema, AskQuestionInputSchema } from "@/contracts";
import { getJobApiContext } from "@/server/api/context";
import { stablePayloadHash } from "@/server/domain/idempotency";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";

export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const input = await parseApiBody(request, AskQuestionInputSchema.omit({ idempotencyKey: true }));
    const key = readIdempotencyKey(request);
    if (!input.context.releaseId) throw new ApiFault("VALIDATION_FAILED", "Floor questions require a published release.");
    const { repository } = await getJobApiContext(input.context.jobId);
    await repository.assertReleaseFeedbackContext(input.context);
    const claim = await repository.claimIdempotency({
      operation: "question.ask",
      key,
      payloadHash: stablePayloadHash(input),
    });
    if (claim.state === "completed") return AnswerSchema.parse(claim.response);
    if (claim.state === "running") {
      throw new ApiFault("VERSION_CONFLICT", "This question is already being recorded. Retry shortly.", { retryable: true });
    }
    if (claim.state === "failed") throw new ApiFault("INTERNAL_ERROR", "The earlier question attempt failed.");
    return repository.recordReleaseQuestion({
      ...input,
      idempotencyRecordId: claim.recordId,
      idempotencyClaimToken: claim.claimToken,
    });
  }, { status: 201 });
}
