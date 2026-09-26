import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { ApiFault, handleApiOperation } from "@/server/http/api";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const generationId = parseRouteId((await context.params).id);
    // Resolve the owning job under the caller's RLS-bound session first, then
    // construct the workspace-scoped server repository. No generation UUID alone
    // grants access to a different workspace or to a non-member.
    const { getVerifiedRequestIdentity } = await import("@/lib/auth/request-identity");
    const { supabase } = await getVerifiedRequestIdentity();
    const { data, error } = await supabase.from("generations")
      .select("job_id")
      .eq("id", generationId)
      .maybeSingle();
    if (error) throw new ApiFault("PROVIDER_UNAVAILABLE", "Generation access could not be checked.", { retryable: true });
    if (!data?.job_id) throw new ApiFault("NOT_FOUND", "Generation not found.");
    const { repository } = await getJobApiContext(parseRouteId(data.job_id));
    return repository.getGeneration(generationId);
  });
}
