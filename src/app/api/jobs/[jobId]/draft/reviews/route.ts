import { ReviewDraftInputSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { handleApiOperation, parseApiBody } from "@/server/http/api";

const ReviewBodySchema = ReviewDraftInputSchema.omit({ jobId: true });

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const { jobId: rawJobId } = await context.params;
    const jobId = parseRouteId(rawJobId);
    const body = await parseApiBody(request, ReviewBodySchema);
    const { repository } = await getJobApiContext(jobId);
    return repository.recordDraftReview({ jobId, ...body });
  });
}
