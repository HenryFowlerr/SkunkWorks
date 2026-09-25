import { AcknowledgeFlagInputSchema } from "@/contracts";
import { readVisitorSessionToken } from "@/server/access/visitor-cookie";
import { createSupabaseServiceClient, getSupabasePrivilegedConfig } from "@/server/auth/service-client";
import { createVisitorReleaseRepository } from "@/server/data/visitor";
import { resolveVisitorFlagScope } from "@/server/data/tokens";
import { ApiFault, handleApiOperation, parseApiBody } from "@/server/http/api";
import { parseRouteId } from "@/server/api/context";

const AcknowledgeBodySchema = AcknowledgeFlagInputSchema.omit({ flagId: true });

export async function POST(
  request: Request,
  route: { params: Promise<{ flagId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const flagId = parseRouteId((await route.params).flagId);
    const body = await parseApiBody(request, AcknowledgeBodySchema);
    const sessionToken = readVisitorSessionToken(request);
    if (!sessionToken) throw new ApiFault("RELEASE_REVOKED", "Release access is unavailable.");

    const config = getSupabasePrivilegedConfig();
    const serviceClient = createSupabaseServiceClient(config);
    const scope = await resolveVisitorFlagScope({ serviceClient, sessionToken, flagId });
    const repository = createVisitorReleaseRepository({
      serviceClient,
      sessionId: scope.sessionId,
      releaseId: scope.releaseId,
    });
    return repository.acknowledgeFlag({ flagId, expectedVersion: body.expectedVersion });
  });
}
