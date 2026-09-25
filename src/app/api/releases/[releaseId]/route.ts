import { getJobApiContext } from "@/server/api/context";
import { readVisitorSessionToken } from "@/server/access/visitor-cookie";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { createSupabaseServiceClient, getSupabasePrivilegedConfig } from "@/server/auth/service-client";
import { createVisitorReleaseRepository } from "@/server/data/visitor";
import { resolveVisitorReleaseScope } from "@/server/data/tokens";
import { ApiFault, handleApiOperation } from "@/server/http/api";
import { parseRouteId } from "@/server/api/context";

export async function GET(
  request: Request,
  route: { params: Promise<{ releaseId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const releaseId = parseRouteId((await route.params).releaseId);
    const visitorToken = readVisitorSessionToken(request);
    if (visitorToken) {
      const config = getSupabasePrivilegedConfig();
      const serviceClient = createSupabaseServiceClient(config);
      const scope = await resolveVisitorReleaseScope({ serviceClient, sessionToken: visitorToken, releaseId });
      const repository = createVisitorReleaseRepository({
        serviceClient,
        sessionId: scope.sessionId,
        releaseId: scope.releaseId,
      });
      return repository.getReleaseView();
    }

    // Resolve the release through the caller's RLS session before constructing
    // the workspace-scoped repository used for its immutable source allow-list.
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
    const { repository } = await getJobApiContext(data.job_id);
    return repository.getReleaseView(releaseId);
  });
}
