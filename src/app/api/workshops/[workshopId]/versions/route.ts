import { SaveWorkshopVersionInputSchema } from "@/contracts";
import { getWorkshopApiContext, parseRouteId } from "@/server/api/context";
import { handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";

const SaveVersionBodySchema = SaveWorkshopVersionInputSchema.omit({ workshopId: true, idempotencyKey: true });

export async function POST(
  request: Request,
  context: { params: Promise<{ workshopId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const { workshopId: rawWorkshopId } = await context.params;
    const workshopId = parseRouteId(rawWorkshopId);
    const body = await parseApiBody(request, SaveVersionBodySchema);
    const idempotencyKey = readIdempotencyKey(request);
    const { repository } = await getWorkshopApiContext(workshopId, ["fabricator"]);
    return repository.saveWorkshopVersion({ workshopId, ...body, idempotencyKey });
  }, { status: 201 });
}
