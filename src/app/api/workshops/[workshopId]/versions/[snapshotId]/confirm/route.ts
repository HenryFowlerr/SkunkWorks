import { getWorkshopApiContext, parseRouteId } from "@/server/api/context";
import { handleApiOperation } from "@/server/http/api";
import { assertSameOrigin } from "@/server/http/request-security";

export async function POST(
  request: Request,
  context: { params: Promise<{ workshopId: string; snapshotId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    assertSameOrigin(request);
    const { workshopId: rawWorkshopId, snapshotId: rawSnapshotId } = await context.params;
    const workshopId = parseRouteId(rawWorkshopId);
    const snapshotId = parseRouteId(rawSnapshotId);
    const { repository } = await getWorkshopApiContext(workshopId, ["fabricator"]);
    return repository.confirmWorkshop({ workshopId, snapshotId });
  });
}
