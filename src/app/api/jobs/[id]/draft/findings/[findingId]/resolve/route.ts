import { DraftSchema, ResolveFindingInputSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { handleApiOperation, parseApiBody } from "@/server/http/api";

type RouteContext = { params: Promise<{ id: string; findingId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const { id, findingId } = await context.params;
    const jobId = parseRouteId(id);
    const parsedFindingId = parseRouteId(findingId);
    const input = await parseApiBody(request, ResolveFindingInputSchema.omit({ jobId: true, findingId: true }));
    const { repository } = await getJobApiContext(jobId, ["designer"]);
    return DraftSchema.parse(await repository.resolveFinding({ jobId, findingId: parsedFindingId, ...input }));
  });
}
