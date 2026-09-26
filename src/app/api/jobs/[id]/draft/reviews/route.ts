import { DraftSchema, ReviewDraftInputSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { handleApiOperation, parseApiBody } from "@/server/http/api";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const jobId = parseRouteId((await context.params).id);
    const input = await parseApiBody(request, ReviewDraftInputSchema.omit({ jobId: true }));
    const { repository } = await getJobApiContext(jobId, [input.kind === "design" ? "designer" : "fabricator"]);
    return DraftSchema.parse(await repository.recordDraftReview({ jobId, ...input }));
  });
}
