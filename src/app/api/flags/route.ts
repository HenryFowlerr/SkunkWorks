import { randomUUID } from "node:crypto";
import { CreateFlagInputSchema, ListFlagsInputSchema } from "@/contracts";
import { getJobApiContext } from "@/server/api/context";
import { createReleaseFlag, listVisitorReleaseFlags } from "@/server/data/feedback";
import { resolveReleaseFeedbackScope } from "@/server/data/feedback-access";
import { validateContext } from "@/server/domain/contexts";
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
    if (parsed.data.jobId) {
      const { repository } = await getJobApiContext(parsed.data.jobId);
      return repository.listFlags(parsed.data);
    }
    const releaseId = parsed.data.releaseId!;
    const scope = await resolveReleaseFeedbackScope(releaseId);
    if (scope.sessionHash) return listVisitorReleaseFlags({ releaseId, sessionHash: scope.sessionHash });
    const { repository } = await getJobApiContext(scope.job.id);
    return repository.listFlags({ releaseId });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const body = await parseApiBody(request, CreateFlagInputSchema.omit({ idempotencyKey: true }));
    const key = readIdempotencyKey(request);
    if (!body.context.releaseId || body.context.draftId !== null) {
      throw new ApiFault("VALIDATION_FAILED", "Floor flags require a published release.");
    }
    if (body.question.length > 2000 || body.photoAssetIds.length > 3 ||
      new Set(body.photoAssetIds).size !== body.photoAssetIds.length) {
      throw new ApiFault("VALIDATION_FAILED", "Limit the flag to 2,000 characters and three distinct photos.");
    }
    const scope = await resolveReleaseFeedbackScope(body.context.releaseId);
    validateContext(body.context, { kind: "release", release: scope.release }, "floor");
    return createReleaseFlag({
      flagId: randomUUID(), releaseId: scope.release.id,
      actorId: scope.actorId, sessionHash: scope.sessionHash,
      stepId: body.context.stepId, bendId: body.context.bendId,
      question: body.question.trim(), photoAssetIds: body.photoAssetIds,
      idempotencyKey: key,
      payloadHash: stablePayloadHash({
        releaseId: scope.release.id, context: body.context,
        question: body.question.trim(), photoAssetIds: body.photoAssetIds,
      }),
    });
  }, { status: 201 });
}
