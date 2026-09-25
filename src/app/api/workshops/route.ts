import { CreateWorkshopInputSchema, IdSchema } from "@/contracts";
import { getWorkspaceApiContext } from "@/server/api/context";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";
import { z } from "zod";

const CreateWorkshopBodySchema = CreateWorkshopInputSchema.omit({ idempotencyKey: true });
const ListWorkshopsQuerySchema = z.object({ workspaceId: IdSchema }).strict();

export async function GET(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const url = new URL(request.url);
    if (url.searchParams.getAll("workspaceId").length !== 1 || [...url.searchParams.keys()].some((key) => key !== "workspaceId")) {
      throw new ApiFault("VALIDATION_FAILED", "Provide one workspaceId filter.");
    }
    const { workspaceId } = ListWorkshopsQuerySchema.parse({ workspaceId: url.searchParams.get("workspaceId") });
    const { repository } = await getWorkspaceApiContext(workspaceId);
    return repository.listWorkshops();
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const body = await parseApiBody(request, CreateWorkshopBodySchema);
    const idempotencyKey = readIdempotencyKey(request);
    const { repository } = await getWorkspaceApiContext(body.workspaceId, ["fabricator"]);
    return repository.createWorkshop({ name: body.name, idempotencyKey });
  }, { status: 201 });
}
