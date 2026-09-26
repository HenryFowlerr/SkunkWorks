import { ListFlagsInputSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { ApiFault, handleApiOperation } from "@/server/http/api";

export async function GET(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const query = new URL(request.url).searchParams;
    const parsed = ListFlagsInputSchema.safeParse({
      ...(query.has("jobId") ? { jobId: query.get("jobId") } : {}),
      ...(query.has("releaseId") ? { releaseId: query.get("releaseId") } : {}),
    });
    if (!parsed.success) throw new ApiFault("VALIDATION_FAILED", "Provide one valid job or release ID.");
    const { supabase } = await getVerifiedRequestIdentity();
    const jobId = parsed.data.jobId ?? await (async () => {
      const releaseId = parseRouteId(parsed.data.releaseId);
      const { data, error } = await supabase.from("releases").select("job_id").eq("id", releaseId).maybeSingle();
      if (error) throw new ApiFault("PROVIDER_UNAVAILABLE", "Release access could not be checked.", { retryable: true });
      if (!data?.job_id) throw new ApiFault("NOT_FOUND", "Release not found.");
      return data.job_id as string;
    })();
    const { repository } = await getJobApiContext(jobId);
    return repository.listFlags(parsed.data);
  });
}
