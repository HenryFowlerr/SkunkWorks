import { SaveDraftInputSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { ApiFault, handleApiOperation, parseApiBody } from "@/server/http/api";

const SaveDraftBodySchema = SaveDraftInputSchema.omit({ jobId: true });

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const { jobId: rawJobId } = await context.params;
    const jobId = parseRouteId(rawJobId);
    const { repository } = await getJobApiContext(jobId);
    const draft = await repository.getDraft(jobId);
    if (!draft) throw new ApiFault("NOT_FOUND", "Draft not found.");
    return draft;
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const { jobId: rawJobId } = await context.params;
    const jobId = parseRouteId(rawJobId);
    const body = await parseApiBody(request, SaveDraftBodySchema);
    const { repository } = await getJobApiContext(jobId, ["designer"]);
    return repository.saveDraft({ jobId, ...body });
  });
}
