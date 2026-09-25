import { AssetSchema, ResumeAssetUploadResultSchema, UploadReleasePhotoPreparationBodySchema } from "@/contracts";
import { readVisitorSessionToken } from "@/server/access/visitor-cookie";
import { parseRouteId } from "@/server/api/context";
import { createSupabaseServiceClient, getSupabasePrivilegedConfig } from "@/server/auth/service-client";
import { createVisitorReleaseRepository } from "@/server/data/visitor";
import { resolveVisitorReleaseScope } from "@/server/data/tokens";
import { createPrivateStorageAdapter } from "@/server/data/storage";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";

export async function POST(
  request: Request,
  route: { params: Promise<{ releaseId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const releaseId = parseRouteId((await route.params).releaseId);
    const body = await parseApiBody(request, UploadReleasePhotoPreparationBodySchema);
    const idempotencyKey = readIdempotencyKey(request);
    const sessionToken = readVisitorSessionToken(request);
    if (!sessionToken) throw new ApiFault("RELEASE_REVOKED", "Release access is unavailable.");

    const config = getSupabasePrivilegedConfig();
    const serviceClient = createSupabaseServiceClient(config);
    const scope = await resolveVisitorReleaseScope({ serviceClient, sessionToken, releaseId });
    if (scope.releaseId !== releaseId) {
      throw new ApiFault("RELEASE_REVOKED", "Release access is unavailable.");
    }

    // The repository RPC binds metadata creation and idempotency to this live
    // session and exact release. Never accept an asset ID or scope from the body.
    const repository = createVisitorReleaseRepository({
      serviceClient,
      sessionId: scope.sessionId,
      releaseId,
    });
    const asset = AssetSchema.parse(await repository.preparePhoto({ ...body, idempotencyKey }));
    if (asset.releaseId !== releaseId || asset.kind !== "issue_photo") {
      throw new ApiFault("INTERNAL_ERROR", "The photo preparation did not match this release.");
    }
    const storage = createPrivateStorageAdapter({
      serviceClient,
      publishableKey: config.publishableKey,
      supabaseUrl: config.url,
    });
    const result = await storage.resumeVisitorPhotoUpload({
      sessionToken,
      releaseId,
      assetId: asset.id,
    });
    return ResumeAssetUploadResultSchema.parse(result);
  });
}
