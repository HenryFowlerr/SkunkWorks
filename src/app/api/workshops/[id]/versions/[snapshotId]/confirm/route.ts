import { getWorkshopApiContext, parseRouteId } from "@/server/api/context";
import { handleApiOperation } from "@/server/http/api";
import { assertSameOrigin } from "@/server/http/request-security";

type RouteContext = { params: Promise<{ id: string; snapshotId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    assertSameOrigin(request);
    const params = await context.params;
    const workshopId = parseRouteId(params.id);
    const snapshotId = parseRouteId(params.snapshotId);
    const { repository } = await getWorkshopApiContext(workshopId, ["fabricator"]);
    return repository.confirmWorkshopSnapshot(workshopId, snapshotId);
  });
}
