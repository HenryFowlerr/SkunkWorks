import { AssetLinkSchema } from "@/contracts";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { createSupabaseServiceClient } from "@/server/auth/service-client";
import { createPrivateStorageAdapter } from "@/server/data/storage";
import { ApiFault, handleApiOperation } from "@/server/http/api";

type RouteContext = { params: Promise<{ id: string }> };
const LINK_TTL_SECONDS = 300;

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const assetId = parseRouteId((await context.params).id);
    const { supabase } = await getVerifiedRequestIdentity();
    const { data: scope, error } = await supabase
      .from("assets")
      .select("workspace_id,job_id")
      .eq("id", assetId)
      .maybeSingle();
    if (error) throw new ApiFault("PROVIDER_UNAVAILABLE", "Asset access could not be checked.", { retryable: true });
    if (!scope?.job_id || !scope.workspace_id) throw new ApiFault("NOT_FOUND", "Asset not found.");

    const { repository } = await getJobApiContext(scope.job_id);
    if (repository.workspaceId !== scope.workspace_id) throw new ApiFault("NOT_FOUND", "Asset not found.");
    const service = createSupabaseServiceClient();
    const storage = createPrivateStorageAdapter({ serviceClient: service });
    const asset = await storage.authorizeMemberAsset({
      workspaceId: repository.workspaceId,
      jobId: scope.job_id,
      assetId,
    });
    const { data: signed, error: signError } = await service.storage
      .from(asset.bucketId)
      .createSignedUrl(asset.objectKey, LINK_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      throw new ApiFault("PROVIDER_UNAVAILABLE", "The asset link could not be created.", { retryable: true });
    }
    return AssetLinkSchema.parse({
      url: signed.signedUrl,
      expiresAt: new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString(),
    });
  });
}
