import { FollowReplacementInputSchema } from "@/contracts";
import { readVisitorSessionToken } from "@/server/access/visitor-cookie";
import { parseRouteId } from "@/server/api/context";
import { createSupabaseServiceClient, getSupabasePrivilegedConfig } from "@/server/auth/service-client";
import { createVisitorReleaseRepository } from "@/server/data/visitor";
import { resolveVisitorReleaseScope } from "@/server/data/tokens";
import { ApiFault, handleApiOperation, parseApiBody } from "@/server/http/api";

const FollowBodySchema = FollowReplacementInputSchema.omit({ releaseId: true });

export async function POST(
  request: Request,
  route: { params: Promise<{ releaseId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const releaseId = parseRouteId((await route.params).releaseId);
    const body = await parseApiBody(request, FollowBodySchema);
    const input = FollowReplacementInputSchema.parse({ ...body, releaseId });
    const sessionToken = readVisitorSessionToken(request);
    if (!sessionToken) throw new ApiFault("RELEASE_REVOKED", "Release access is unavailable.");

    const config = getSupabasePrivilegedConfig();
    const serviceClient = createSupabaseServiceClient(config);
    const scope = await resolveVisitorReleaseScope({ serviceClient, sessionToken, releaseId: input.releaseId });
    const repository = createVisitorReleaseRepository({
      serviceClient,
      sessionId: scope.sessionId,
      releaseId: scope.releaseId,
    });
    // The RPC checks the original link, current grant, direct same-job
    // successor and allowPredecessorVisitors while extending this session.
    return repository.followReplacement({ replacementReleaseId: input.replacementReleaseId });
  });
}
