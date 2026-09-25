import { CreateShareLinkResultSchema } from "@/contracts";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { getJobApiContext } from "@/server/api/context";
import { parseRouteId } from "@/server/api/context";
import { ApiFault, handleApiOperation, readIdempotencyKey } from "@/server/http/api";
import { assertSameOrigin } from "@/server/http/request-security";

export async function POST(
  request: Request,
  route: { params: Promise<{ releaseId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    assertSameOrigin(request);
    const releaseId = parseRouteId((await route.params).releaseId);
    const idempotencyKey = readIdempotencyKey(request);

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
    const result = await repository.createShareLink({ releaseId, idempotencyKey });
    const accessUrl = new URL(`/r/${encodeURIComponent(result.token)}`, request.url).toString();
    return CreateShareLinkResultSchema.parse({ linkId: result.linkId, accessUrl });
  });
}
