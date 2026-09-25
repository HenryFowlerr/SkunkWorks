import { RespondToFlagInputSchema } from "@/contracts";
import { z } from "zod";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { getWorkspaceApiContext, parseRouteId } from "@/server/api/context";
import { ApiFault, handleApiOperation, parseApiBody } from "@/server/http/api";

const ResponseBodySchema = z.object({
  expectedVersion: RespondToFlagInputSchema.shape.expectedVersion,
  text: RespondToFlagInputSchema.shape.text,
  kind: RespondToFlagInputSchema.shape.kind,
  replacementReleaseId: RespondToFlagInputSchema.shape.replacementReleaseId,
}).strict();

export async function POST(
  request: Request,
  route: { params: Promise<{ flagId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const flagId = parseRouteId((await route.params).flagId);
    const body = await parseApiBody(request, ResponseBodySchema);

    // Resolve the flag through the verified user's RLS session before creating
    // a privileged, designer-scoped repository.
    const { supabase } = await getVerifiedRequestIdentity();
    const { data, error } = await supabase
      .from("flags")
      .select("workspace_id")
      .eq("id", flagId)
      .maybeSingle();
    if (error) {
      throw new ApiFault("PROVIDER_UNAVAILABLE", "Flag access could not be checked.", { retryable: true });
    }
    if (!data?.workspace_id) throw new ApiFault("NOT_FOUND", "Flag not found.");

    const { repository } = await getWorkspaceApiContext(data.workspace_id, ["designer"]);
    return repository.respondToFlag({ flagId, ...body });
  });
}
