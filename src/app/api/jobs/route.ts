import { CreateJobInputSchema, IdSchema } from "@/contracts";
import { getWorkspaceApiContext } from "@/server/api/context";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";
import { z } from "zod";

const CreateJobBodySchema = CreateJobInputSchema.omit({ idempotencyKey: true });
const ListJobsQuerySchema = z.object({ workspaceId: IdSchema }).strict();

export async function GET(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const url = new URL(request.url);
    if (url.searchParams.getAll("workspaceId").length !== 1 || [...url.searchParams.keys()].some((key) => key !== "workspaceId")) {
      throw new ApiFault("VALIDATION_FAILED", "Provide one workspaceId filter.");
    }
    const { workspaceId } = ListJobsQuerySchema.parse({ workspaceId: url.searchParams.get("workspaceId") });
    const { repository } = await getWorkspaceApiContext(workspaceId);
    return repository.listJobs();
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const body = await parseApiBody(request, CreateJobBodySchema);
    const idempotencyKey = readIdempotencyKey(request);
    const { repository } = await getWorkspaceApiContext(body.workspaceId, ["designer"]);
    return repository.createJob({ ...body, idempotencyKey });
  }, { status: 201 });
}
