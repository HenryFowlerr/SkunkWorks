import { JobSchema, UpdateJobInputsSchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { handleApiOperation, parseApiBody } from "@/server/http/api";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const jobId = parseRouteId((await context.params).id);
    const { repository } = await getJobApiContext(jobId);
    return repository.getJobBundle(jobId);
  });
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const jobId = parseRouteId((await context.params).id);
    const input = await parseApiBody(request, UpdateJobInputsSchema.omit({ jobId: true }));
    const { repository } = await getJobApiContext(jobId, ["designer"]);
    const updated = await repository.updateJobInputs({ jobId, ...input });
    return JobSchema.parse(updated.job);
  });
}
