import { UpdateJobInputsSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { handleApiOperation, parseApiBody } from "@/server/http/api";

const UpdateJobBodySchema = UpdateJobInputsSchema.omit({ jobId: true });

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const { jobId: rawJobId } = await context.params;
    const jobId = parseRouteId(rawJobId);
    const { repository } = await getJobApiContext(jobId);
    return repository.getJobBundle(jobId);
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const { jobId: rawJobId } = await context.params;
    const jobId = parseRouteId(rawJobId);
    const body = await parseApiBody(request, UpdateJobBodySchema);
    const { repository } = await getJobApiContext(jobId, ["designer"]);
    const result = await repository.updateJobInputs({ jobId, ...body });
    return result.job;
  });
}
