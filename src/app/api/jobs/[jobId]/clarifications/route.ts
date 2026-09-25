import { RecordClarificationInputSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";

const ClarificationBodySchema = RecordClarificationInputSchema.omit({ jobId: true, idempotencyKey: true });

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const { jobId: rawJobId } = await context.params;
    const jobId = parseRouteId(rawJobId);
    const body = await parseApiBody(request, ClarificationBodySchema);
    const idempotencyKey = readIdempotencyKey(request);
    const { repository } = await getJobApiContext(jobId, ["designer"]);
    const result = await repository.recordClarification({ jobId, ...body, idempotencyKey });
    return result.evidence;
  }, { status: 201 });
}
