import { DraftSchema, SaveDraftInputSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { ApiFault, handleApiOperation, parseApiBody } from "@/server/http/api";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const jobId = parseRouteId((await context.params).id);
    const { repository } = await getJobApiContext(jobId);
    const draft = await repository.getDraft(jobId);
    if (!draft) throw new ApiFault("NOT_FOUND", "Current draft not found.");
    return DraftSchema.parse(draft);
  });
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const jobId = parseRouteId((await context.params).id);
    const input = await parseApiBody(request, SaveDraftInputSchema.omit({ jobId: true }));
    const { repository } = await getJobApiContext(jobId, ["designer"]);
    return DraftSchema.parse(await repository.saveDraft({ jobId, ...input }));
  });
}
