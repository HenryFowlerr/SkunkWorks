import { EvidenceRefSchema, RecordClarificationInputSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { stablePayloadHash } from "@/server/domain/idempotency";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const jobId = parseRouteId((await context.params).id);
    const body = await parseApiBody(request, RecordClarificationInputSchema.omit({ jobId: true, idempotencyKey: true }));
    const text = body.text.trim();
    const key = readIdempotencyKey(request);
    const { repository } = await getJobApiContext(jobId, ["designer"]);
    const claim = await repository.claimIdempotency({
      operation: "draft.clarification",
      key,
      payloadHash: stablePayloadHash({ jobId, text }),
    });
    if (claim.state === "completed") return EvidenceRefSchema.parse(claim.response);
    if (claim.state === "running") throw new ApiFault("VERSION_CONFLICT", "Clarification is already being recorded. Retry shortly.", { retryable: true });
    if (claim.state === "failed") throw new ApiFault("INTERNAL_ERROR", "The previous clarification attempt failed.");
    return EvidenceRefSchema.parse(await repository.recordClarification({
      jobId,
      text,
      idempotencyRecordId: claim.recordId,
      idempotencyClaimToken: claim.claimToken,
    }));
  }, { status: 201 });
}
