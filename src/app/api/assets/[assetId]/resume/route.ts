import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { readVisitorSessionToken } from "@/server/access/visitor-cookie";
import { createSupabaseServiceClient, getSupabasePrivilegedConfig } from "@/server/auth/service-client";
import { resolveVisitorAssetScope } from "@/server/data/tokens";
import { createPrivateStorageAdapter } from "@/server/data/storage";
import { ApiFault, handleApiOperation, parseApiBody } from "@/server/http/api";
import { z } from "zod";

const EmptyBodySchema = z.object({}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    await parseApiBody(request, EmptyBodySchema);
    const { assetId: rawAssetId } = await context.params;
    const assetId = parseRouteId(rawAssetId);
    const visitorToken = readVisitorSessionToken(request);
    if (visitorToken) {
      const config = getSupabasePrivilegedConfig();
      const serviceClient = createSupabaseServiceClient(config);
      const scope = await resolveVisitorAssetScope({ serviceClient, sessionToken: visitorToken, assetId });
      const storage = createPrivateStorageAdapter({
        serviceClient,
        publishableKey: config.publishableKey,
        supabaseUrl: config.url,
      });
      return storage.resumeVisitorPhotoUpload({ sessionToken: visitorToken, releaseId: scope.releaseId, assetId });
    }

    const { supabase } = await getVerifiedRequestIdentity();
    const { data, error } = await supabase
      .from("assets")
      .select("job_id")
      .eq("id", assetId)
      .maybeSingle();
    if (error) throw new ApiFault("PROVIDER_UNAVAILABLE", "Asset ownership could not be checked.", { retryable: true });
    if (!data?.job_id) throw new ApiFault("NOT_FOUND", "Asset not found.");
    const { repository, sessionClient, storage } = await getJobApiContext(data.job_id, ["designer"]);
    return storage.resumeMemberSourceUpload({
      sessionClient,
      workspaceId: repository.workspaceId,
      jobId: data.job_id,
      assetId,
    });
  });
}
