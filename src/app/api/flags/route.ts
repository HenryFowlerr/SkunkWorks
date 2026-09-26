import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CreateFlagInputSchema, FlagSchema, ListFlagsInputSchema } from "@/contracts";
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

/** A submitted floor report is unapproved evidence, never an engineer answer. */
export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const key = readIdempotencyKey(request);
    const input = await parseApiBody(request, z.object({
      ...CreateFlagInputSchema.shape,
      question: CreateFlagInputSchema.shape.question.max(10000),
      idempotencyKey: CreateFlagInputSchema.shape.idempotencyKey.default(key),
    }).strict().pipe(CreateFlagInputSchema));
    readIdempotencyKey(request, input.idempotencyKey);
    if (input.photoAssetIds.length > 0) {
      throw new ApiFault("VALIDATION_FAILED", "Photo attachments are not supported yet. Submit a text flag.");
    }
    const { repository, actor } = await getJobApiContext(input.context.jobId);
    const claim = await repository.claimIdempotency({
      operation: "flag.create",
      key,
      payloadHash: stablePayloadHash({
        workspaceId: repository.workspaceId,
        context: input.context,
        question: input.question.trim(),
        photoAssetIds: input.photoAssetIds,
      }),
    });
    if (claim.state === "completed") return FlagSchema.parse(claim.response);
    if (claim.state === "running") {
      throw new ApiFault("VERSION_CONFLICT", "This flag submission is already running. Retry shortly.", { retryable: true });
    }
    if (claim.state === "failed") throw new ApiFault("INTERNAL_ERROR", "The flag submission attempt failed.");
    return repository.createFlag({
      flagId: randomUUID(),
      context: input.context,
      question: input.question,
      displayName: actor.displayName,
      idempotencyRecordId: claim.recordId,
      idempotencyClaimToken: claim.claimToken,
    });
  }, { status: 201 });
}
