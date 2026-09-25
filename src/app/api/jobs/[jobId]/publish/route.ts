import { IdSchema, PublishReleaseInputSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { stablePayloadHash } from "@/server/domain/idempotency";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";
import { z } from "zod";

const PublishBodySchema = PublishReleaseInputSchema.omit({ jobId: true, idempotencyKey: true });
const ClaimResultSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("claimed"), recordId: IdSchema, claimToken: IdSchema }).passthrough(),
  z.object({ state: z.literal("running"), retryAfterSeconds: z.number().int().positive() }).passthrough(),
  z.object({ state: z.literal("completed"), resourceId: IdSchema }).passthrough(),
  z.object({ state: z.literal("failed") }).passthrough(),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const { jobId: rawJobId } = await context.params;
    const jobId = parseRouteId(rawJobId);
    const body = await parseApiBody(request, PublishBodySchema);
    const idempotencyKey = readIdempotencyKey(request);
    const { repository } = await getJobApiContext(jobId, ["designer"]);
    const claim = ClaimResultSchema.parse(await repository.claimIdempotency({
      operation: "release.publish",
      key: idempotencyKey,
      payloadHash: stablePayloadHash({ jobId, ...body }),
      leaseSeconds: 120,
    }));

    if (claim.state === "completed") return repository.getRelease(claim.resourceId);
    if (claim.state === "running") {
      throw new ApiFault("GENERATION_RUNNING", "A matching publication request is still in progress.", { retryable: true });
    }
    if (claim.state === "failed") {
      throw new ApiFault("PROVIDER_UNAVAILABLE", "The previous publication attempt failed; submit a new request key.", { retryable: false });
    }

    return repository.publishRelease({
      jobId,
      ...body,
      idempotencyRecordId: claim.recordId,
      idempotencyClaimToken: claim.claimToken,
    });
  });
}
