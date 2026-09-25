import { ResolveFindingInputSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { handleApiOperation, parseApiBody } from "@/server/http/api";

const ResolveFindingBodySchema = ResolveFindingInputSchema.omit({ jobId: true, findingId: true });

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string; findingId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const { jobId: rawJobId, findingId: rawFindingId } = await context.params;
    const jobId = parseRouteId(rawJobId);
    const findingId = parseRouteId(rawFindingId);
    const body = await parseApiBody(request, ResolveFindingBodySchema);
    const { repository } = await getJobApiContext(jobId, ["designer"]);
    return repository.resolveFinding({ jobId, findingId, ...body });
  });
}
