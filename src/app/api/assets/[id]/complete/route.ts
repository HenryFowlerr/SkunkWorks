import { IdSchema, AssetSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { createSupabaseServiceClient } from "@/server/auth/service-client";
import { createPrivateStorageAdapter } from "@/server/data/storage";
import { ApiFault, handleApiOperation, parseApiBody } from "@/server/http/api";
import { z } from "zod";

type RouteContext = { params: Promise<{ id: string }> };
const EmptyBodySchema = z.object({}).strict();

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const assetId = parseRouteId((await context.params).id);
    await parseApiBody(request, EmptyBodySchema);
    const { supabase: sessionClient } = await getVerifiedRequestIdentity();
    const { data, error } = await sessionClient
      .from("assets")
      .select("workspace_id,job_id")
      .eq("id", assetId)
      .maybeSingle();
    if (error) throw new ApiFault("PROVIDER_UNAVAILABLE", "Asset access could not be checked.", { retryable: true });
    const assetScope = data as { workspace_id?: string; job_id?: string } | null;
    if (!assetScope?.job_id || !assetScope.workspace_id) throw new ApiFault("NOT_FOUND", "Asset not found.");

    const { repository, actor } = await getJobApiContext(assetScope.job_id, ["designer"]);
    if (repository.workspaceId !== assetScope.workspace_id) throw new ApiFault("NOT_FOUND", "Asset not found.");
    const storage = createPrivateStorageAdapter({ serviceClient: createSupabaseServiceClient() });
    const asset = await storage.finalizeMemberAsset({
      workspaceId: repository.workspaceId,
      jobId: assetScope.job_id,
      assetId: IdSchema.parse(assetId),
      actorId: actor.id,
    });
    return AssetSchema.parse(asset);
  });
}
