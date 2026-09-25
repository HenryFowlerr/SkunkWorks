import { parseRouteId, getWorkshopApiContext } from "@/server/api/context";
import { handleApiOperation } from "@/server/http/api";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const workshopId = parseRouteId((await context.params).id);
    const { repository } = await getWorkshopApiContext(workshopId);
    return repository.getCurrentWorkshopSnapshot(workshopId);
  });
}
