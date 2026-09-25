import { randomUUID } from "node:crypto";
import {
  IdSchema,
  UploadAssetPreparationBodySchema,
  type UploadPreparation,
} from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { createSupabaseServiceClient } from "@/server/auth/service-client";
import { createPrivateStorageAdapter } from "@/server/data/storage";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";
import { stablePayloadHash } from "@/server/domain/idempotency";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const jobId = parseRouteId((await context.params).id);
    const input = await parseApiBody(request, UploadAssetPreparationBodySchema);
    const idempotencyKey = readIdempotencyKey(request);
    const { repository, sessionClient } = await getJobApiContext(jobId, ["designer"]);
    const payloadHash = stablePayloadHash({ jobId, ...input });
    const claim = await repository.claimIdempotency({
      operation: "asset.prepare",
      key: idempotencyKey,
      payloadHash,
    });

    let assetId: string;
    if (claim.state === "completed") {
      const response = claim.response as { assetId?: unknown } | null;
      const parsed = IdSchema.safeParse(response?.assetId);
      if (!parsed.success || claim.resourceId !== parsed.data) {
        throw new ApiFault("INTERNAL_ERROR", "The stored upload preparation is invalid.");
      }
      assetId = parsed.data;
    } else if (claim.state === "claimed") {
      assetId = randomUUID();
      await repository.prepareSourceAsset({
        assetId,
        jobId,
        kind: input.kind,
        filename: input.filename,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        idempotencyRecordId: claim.recordId,
        idempotencyClaimToken: claim.claimToken,
      });
    } else if (claim.state === "running") {
      throw new ApiFault("VERSION_CONFLICT", "This upload preparation is already running; retry shortly.", {
        retryable: true,
      });
    } else {
      throw new ApiFault("INTERNAL_ERROR", "The upload preparation could not be replayed.");
    }

    const storage = createPrivateStorageAdapter({ serviceClient: createSupabaseServiceClient() });
    const prepared: UploadPreparation = await storage.prepareMemberSourceUpload({
      sessionClient,
      workspaceId: repository.workspaceId,
      jobId,
      assetId,
    });
    return prepared;
  });
}
