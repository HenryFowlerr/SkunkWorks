import { CreateFlagBodySchema, FlagSchema, IdSchema, ListFlagsInputSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { stablePayloadHash } from "@/server/domain/idempotency";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";

export async function GET(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const query = new URL(request.url).searchParams;
    const parsed = ListFlagsInputSchema.safeParse({
      ...(query.has("jobId") ? { jobId: query.get("jobId") } : {}),
      ...(query.has("releaseId") ? { releaseId: query.get("releaseId") } : {}),
    });
    if (!parsed.success) throw new ApiFault("VALIDATION_FAILED", "Provide one valid job or release ID.");
    const { supabase } = await getVerifiedRequestIdentity();
    const jobId = parsed.data.jobId ?? await (async () => {
      const releaseId = parseRouteId(parsed.data.releaseId);
      const { data, error } = await supabase.from("releases").select("job_id").eq("id", releaseId).maybeSingle();
      if (error) throw new ApiFault("PROVIDER_UNAVAILABLE", "Release access could not be checked.", { retryable: true });
      if (!data?.job_id) throw new ApiFault("NOT_FOUND", "Release not found.");
      return data.job_id as string;
    })();
    const { repository } = await getJobApiContext(jobId);
    return repository.listFlags(parsed.data);
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const input = await parseApiBody(request, CreateFlagBodySchema);
    const key = readIdempotencyKey(request);
    if (!input.context.releaseId) throw new ApiFault("VALIDATION_FAILED", "Floor flags require a published release.");
    if (input.photoAssetIds.length > 0) {
      throw new ApiFault("UNSUPPORTED_ASSET", "Release photo upload is not available yet. Remove the photo and retry.");
    }
    const { repository, actor } = await getJobApiContext(input.context.jobId);
    await repository.assertReleaseFeedbackContext(input.context);
    const claim = await repository.claimIdempotency({
      operation: "flag.create",
      key,
      payloadHash: stablePayloadHash(input),
    });
    if (claim.state === "completed") {
      const result = claim.response as { flagId?: unknown } | null;
      const parsed = IdSchema.safeParse(result?.flagId);
      if (!parsed.success || parsed.data !== claim.resourceId) {
        throw new ApiFault("INTERNAL_ERROR", "The prior flag identity is inconsistent.");
      }
      return FlagSchema.parse(await repository.getFlagForRelease(parsed.data, input.context.releaseId));
    }
    if (claim.state === "running") {
      throw new ApiFault("VERSION_CONFLICT", "This flag is already being recorded. Retry shortly.", { retryable: true });
    }
    if (claim.state === "failed") throw new ApiFault("INTERNAL_ERROR", "The earlier flag attempt failed.");
    return FlagSchema.parse(await repository.createMemberReleaseFlag({
      context: input.context,
      question: input.question,
      displayName: actor.displayName,
      idempotencyRecordId: claim.recordId,
      idempotencyClaimToken: claim.claimToken,
    }));
  }, { status: 201 });
}
