import { randomUUID } from "node:crypto";
import { CreateGenerationInputSchema, GenerationSchema, type Asset } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { createAiAdapter } from "@/server/ai";
import { prepareGenerationInput, proposalToDraftContent } from "@/server/ai/generation-input";
import { AiProviderError } from "@/server/ai/types";
import { createSupabaseServiceClient } from "@/server/auth/service-client";
import { stablePayloadHash } from "@/server/domain/idempotency";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const jobId = parseRouteId((await context.params).id);
    const body = await parseApiBody(request, CreateGenerationInputSchema.omit({ jobId: true, idempotencyKey: true }));
    const idempotencyKey = readIdempotencyKey(request);
    const { repository } = await getJobApiContext(jobId, ["designer"]);
    const claim = await repository.claimIdempotency({
      operation: "generation.create",
      key: idempotencyKey,
      payloadHash: stablePayloadHash({ jobId, ...body }),
      leaseSeconds: 90,
    });
    if (claim.state === "completed") {
      const original = GenerationSchema.safeParse(claim.response);
      if (!original.success || claim.resourceId !== original.data.id || original.data.jobId !== jobId) {
        throw new ApiFault("INTERNAL_ERROR", "The saved generation request is invalid.");
      }
      return (await repository.getGeneration(original.data.id)).generation;
    }
    if (claim.state === "running") {
      throw new ApiFault("GENERATION_RUNNING", "This generation request is already being prepared; check again shortly.", {
        retryable: true,
      });
    }
    if (claim.state !== "claimed") {
      throw new ApiFault("INTERNAL_ERROR", "The generation request could not be replayed.");
    }

    const { bundle, workshop, inputFingerprint } = await repository.getGenerationContext(jobId);
    if (bundle.job.version !== body.expectedJobVersion) {
      throw new ApiFault("VERSION_CONFLICT", "Job inputs changed. Reload the job before generation.");
    }
    const storage = createSupabaseServiceClient();
    const prepared = await prepareGenerationInput({
      job: bundle.job,
      assets: bundle.assets,
      workshop,
      readSource: async (asset: Asset) => {
        const authorized = await repository.authorizeMemberAsset(jobId, asset.id);
        if (authorized.asset.kind !== asset.kind || authorized.asset.sha256 !== asset.sha256) {
          throw new ApiFault("VERSION_CONFLICT", "The selected source changed while preparing generation.");
        }
        const { data, error } = await storage.storage.from(authorized.bucketId)
          .download(authorized.objectKey, {}, { cache: "no-store" });
        if (error || !data) throw new ApiFault("UNSUPPORTED_ASSET", "A selected source could not be read from private storage.");
        return new Uint8Array(await data.arrayBuffer());
      },
    });
    const generation = await repository.startGeneration({
      jobId,
      generationId: randomUUID(),
      expectedJobVersion: body.expectedJobVersion,
      inputFingerprint,
      idempotencyRecordId: claim.recordId,
      idempotencyClaimToken: claim.claimToken,
    });
    try {
      const proposal = await createAiAdapter().generateDraft(prepared.aiInput);
      const content = proposalToDraftContent({ ...prepared, proposal });
      return repository.completeGeneration({ generationId: generation.id, draftId: randomUUID(), content });
    } catch (cause) {
      const failureCode = cause instanceof AiProviderError ? cause.code : "SOURCE_PREPARATION_FAILED";
      const failed = await repository.failGeneration(generation.id, failureCode);
      if (cause instanceof AiProviderError) return failed;
      throw cause;
    }
  });
}
