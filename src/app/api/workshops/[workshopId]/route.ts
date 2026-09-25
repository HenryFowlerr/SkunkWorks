import { getWorkshopApiContext, parseRouteId } from "@/server/api/context";
import { handleApiOperation } from "@/server/http/api";

export async function GET(
  _request: Request,
  context: { params: Promise<{ workshopId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const { workshopId: rawWorkshopId } = await context.params;
    const workshopId = parseRouteId(rawWorkshopId);
    const { repository } = await getWorkshopApiContext(workshopId);
    return repository.getWorkshop(workshopId);
  });
}
