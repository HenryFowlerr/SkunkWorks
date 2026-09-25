import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { RevokeShareLinkResultSchema } from "@/contracts";
import { ApiFault, handleApiOperation } from "@/server/http/api";
import { assertSameOrigin } from "@/server/http/request-security";

export async function DELETE(
  request: Request,
  route: { params: Promise<{ releaseId: string; linkId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    assertSameOrigin(request);
    const { releaseId: rawReleaseId, linkId: rawLinkId } = await route.params;
    const releaseId = parseRouteId(rawReleaseId);
    const linkId = parseRouteId(rawLinkId);

    const { supabase } = await getVerifiedRequestIdentity();
    const { data, error } = await supabase
      .from("releases")
      .select("job_id")
      .eq("id", releaseId)
      .maybeSingle();
    if (error) {
      throw new ApiFault("PROVIDER_UNAVAILABLE", "Release access could not be checked.", { retryable: true });
    }
    if (!data?.job_id) throw new ApiFault("NOT_FOUND", "Release not found.");

    const { repository } = await getJobApiContext(data.job_id, ["designer"]);
    return RevokeShareLinkResultSchema.parse(await repository.revokeShareLink({ releaseId, linkId }));
  });
}
