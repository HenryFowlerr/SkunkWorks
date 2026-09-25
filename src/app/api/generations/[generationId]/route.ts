import { GenerationResultSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { ApiFault, handleApiOperation } from "@/server/http/api";

export async function GET(
  _request: Request,
  context: { params: Promise<{ generationId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const { generationId: rawGenerationId } = await context.params;
    const generationId = parseRouteId(rawGenerationId);
    const { supabase } = await getVerifiedRequestIdentity();
    const { data, error } = await supabase
      .from("generations")
      .select("job_id")
      .eq("id", generationId)
      .maybeSingle();
    if (error) {
      throw new ApiFault("PROVIDER_UNAVAILABLE", "Generation access could not be checked.", { retryable: true });
    }
    const jobId = data?.job_id;
    if (typeof jobId !== "string") throw new ApiFault("NOT_FOUND", "Generation not found.");

    const { repository } = await getJobApiContext(jobId);
    const result = await repository.getGenerationResult(generationId);
    if (!result || result.generation.jobId !== jobId) throw new ApiFault("NOT_FOUND", "Generation not found.");
    return GenerationResultSchema.parse(result);
  });
}
