import { RespondToFlagInputSchema } from "@/contracts";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { parseRouteId } from "@/server/api/context";
import { respondToReleaseFlag } from "@/server/data/feedback";
import { handleApiOperation, parseApiBody } from "@/server/http/api";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleApiOperation(async () => {
    const flagId = parseRouteId((await context.params).id);
    const body = await parseApiBody(request, RespondToFlagInputSchema.omit({ flagId: true }));
    const { user } = await getVerifiedRequestIdentity();
    return respondToReleaseFlag({
      flagId, actorId: user.id,
      expectedVersion: body.expectedVersion,
      text: body.text.trim(), kind: body.kind,
      replacementReleaseId: body.replacementReleaseId,
    });
  });
}
