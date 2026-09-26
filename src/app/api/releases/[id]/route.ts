import { ReleaseViewSchema } from "@/contracts";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { releaseViewAccess } from "@/server/access/release-access";
import { ApiFault, handleApiOperation } from "@/server/http/api";

type RouteContext = { params: Promise<{ id: string }> };

/** Signed-in workspace view. QR visitor access needs its own scoped exchange. */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const releaseId = parseRouteId((await context.params).id);
    const { supabase } = await getVerifiedRequestIdentity();
    const { data, error } = await supabase.from("releases").select("job_id").eq("id", releaseId).maybeSingle();
    if (error) throw new ApiFault("PROVIDER_UNAVAILABLE", "Release access could not be checked.", { retryable: true });
    if (!data?.job_id) throw new ApiFault("NOT_FOUND", "Release not found.");

    const { repository, actor } = await getJobApiContext(data.job_id);
    const bundle = await repository.getJobBundle(data.job_id);
    const release = bundle.releases.find((item) => item.id === releaseId);
    if (!release) throw new ApiFault("NOT_FOUND", "Release not found.");
    const sourceAssets = release.snapshot.sourceAssetIds.map((assetId) => bundle.assets.find((asset) => asset.id === assetId));
    if (sourceAssets.some((asset) => !asset)) throw new ApiFault("INTERNAL_ERROR", "A release source asset is unavailable.");
    const successor = bundle.releases.find((item) => item.supersedesReleaseId === release.id) ?? null;
    const replacement = releaseViewAccess(release, successor);

    return ReleaseViewSchema.parse({
      job: bundle.job,
      release,
      sourceAssets,
      replacementReleaseId: replacement.replacementReleaseId,
      canFollowReplacement: false,
      actor,
      // Feedback mutations and visitor QR exchange are not yet live.
      permissions: { canAsk: false, canFlag: false, canRespond: false },
    });
  });
}
