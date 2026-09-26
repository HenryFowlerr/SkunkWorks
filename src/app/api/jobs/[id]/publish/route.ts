import { PublishReleaseInputSchema, ReleaseSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { stablePayloadHash } from "@/server/domain/idempotency";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const jobId = parseRouteId((await context.params).id);
    const input = await parseApiBody(request, PublishReleaseInputSchema.omit({ jobId: true, idempotencyKey: true }));
    const key = readIdempotencyKey(request);
    const { repository } = await getJobApiContext(jobId, ["designer"]);
    const claim = await repository.claimIdempotency({
      operation: "release.publish",
      key,
      payloadHash: stablePayloadHash({ jobId, ...input }),
    });
    if (claim.state === "completed") {
      if (!claim.resourceId) throw new ApiFault("INTERNAL_ERROR", "Publication retry record has no release.");
      return ReleaseSchema.parse(await repository.getRelease(claim.resourceId));
    }
    if (claim.state === "running") {
      throw new ApiFault("VERSION_CONFLICT", "Publication is already running. Retry shortly.", { retryable: true });
    }
    if (claim.state === "failed") throw new ApiFault("INTERNAL_ERROR", "The previous publication attempt failed.");
    return ReleaseSchema.parse(await repository.publishRelease({
      jobId,
      ...input,
      idempotencyRecordId: claim.recordId,
      idempotencyClaimToken: claim.claimToken,
    }));
  }, { status: 201 });
}
