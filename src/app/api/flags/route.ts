import { CreateFlagInputSchema, IdSchema, ListFlagsInputSchema } from "@/contracts";
import { z } from "zod";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { getJobApiContext, getWorkspaceApiContext } from "@/server/api/context";
import { createSupabaseServiceClient, getSupabasePrivilegedConfig } from "@/server/auth/service-client";
import { readVisitorSessionToken } from "@/server/access/visitor-cookie";
import { resolveVisitorReleaseScope } from "@/server/data/tokens";
import { createVisitorReleaseRepository } from "@/server/data/visitor";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";
import { validateContext } from "@/server/domain/contexts";

const CreateFlagBodySchema = z.object({
  context: CreateFlagInputSchema.shape.context,
  question: CreateFlagInputSchema.shape.question,
  photoAssetIds: z.array(IdSchema),
}).strict();

export async function GET(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const url = new URL(request.url);
    const queryEntries = ["jobId", "releaseId"] as const;
    if (queryEntries.some((name) => url.searchParams.getAll(name).length > 1)) {
      throw new ApiFault("VALIDATION_FAILED", "Provide each flag filter at most once.");
    }

    const input = ListFlagsInputSchema.parse({
      jobId: url.searchParams.get("jobId") ?? undefined,
      releaseId: url.searchParams.get("releaseId") ?? undefined,
    });

    if (input.jobId) {
      const { repository } = await getJobApiContext(input.jobId);
      return repository.listFlags({ jobId: input.jobId });
    }

    const visitorToken = readVisitorSessionToken(request);
    if (visitorToken) {
      const config = getSupabasePrivilegedConfig();
      const serviceClient = createSupabaseServiceClient(config);
      const scope = await resolveVisitorReleaseScope({
        serviceClient,
        sessionToken: visitorToken,
        releaseId: input.releaseId!,
      });
      const repository = createVisitorReleaseRepository({
        serviceClient,
        sessionId: scope.sessionId,
        releaseId: scope.releaseId,
      });
      return repository.listFlags();
    }

    const { supabase } = await getVerifiedRequestIdentity();
    const { data, error } = await supabase
      .from("releases")
      .select("workspace_id")
      .eq("id", input.releaseId!)
      .maybeSingle();
    if (error) {
      throw new ApiFault("PROVIDER_UNAVAILABLE", "Release access could not be checked.", { retryable: true });
    }
    if (!data?.workspace_id) throw new ApiFault("NOT_FOUND", "Release not found.");

    const { repository } = await getWorkspaceApiContext(data.workspace_id);
    return repository.listFlags({ releaseId: input.releaseId! });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const body = await parseApiBody(request, CreateFlagBodySchema);
    const idempotencyKey = readIdempotencyKey(request);
    const input = CreateFlagInputSchema.parse({ ...body, idempotencyKey });
    const releaseId = input.context.releaseId;
    if (!releaseId) throw new ApiFault("VALIDATION_FAILED", "Flags must be attached to a published release.");

    const visitorToken = readVisitorSessionToken(request);
    if (visitorToken) {
      const config = getSupabasePrivilegedConfig();
      const serviceClient = createSupabaseServiceClient(config);
      const scope = await resolveVisitorReleaseScope({ serviceClient, sessionToken: visitorToken, releaseId });
      if (scope.jobId !== input.context.jobId) throw new ApiFault("NOT_FOUND", "Release access is unavailable.");
      const repository = createVisitorReleaseRepository({
        serviceClient,
        sessionId: scope.sessionId,
        releaseId: scope.releaseId,
      });
      const release = await repository.getRelease();
      const context = validateContext(input.context, { kind: "release", release }, "floor");
      return repository.createFlag({
        context,
        question: input.question,
        photoAssetIds: input.photoAssetIds,
        idempotencyKey,
      });
    }

    const { repository } = await getJobApiContext(input.context.jobId);
    const release = await repository.getRelease(releaseId);
    const context = validateContext(input.context, { kind: "release", release }, "floor");
    return repository.createFlag({
      context,
      question: input.question,
      photoAssetIds: input.photoAssetIds,
      idempotencyKey,
    });
  });
}
