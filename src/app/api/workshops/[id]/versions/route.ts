import { randomUUID } from "node:crypto";
import { IdSchema, SaveWorkshopVersionBodySchema } from "@/contracts";
import { getWorkshopApiContext, parseRouteId } from "@/server/api/context";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";
import { stablePayloadHash } from "@/server/domain/idempotency";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const workshopId = parseRouteId((await context.params).id);
    const input = await parseApiBody(request, SaveWorkshopVersionBodySchema);
    const idempotencyKey = readIdempotencyKey(request);
    const { repository } = await getWorkshopApiContext(workshopId, ["fabricator"]);
    const claim = await repository.claimIdempotency({
      operation: "workshop.save",
      key: idempotencyKey,
      payloadHash: stablePayloadHash({ workshopId, ...input }),
    });
    if (claim.state === "completed") {
      const response = claim.response as { snapshotId?: unknown } | null;
      const snapshotId = IdSchema.safeParse(response?.snapshotId);
      if (!snapshotId.success || claim.resourceId !== snapshotId.data) {
        throw new ApiFault("INTERNAL_ERROR", "The stored workshop version is invalid.");
      }
      return repository.getWorkshopSnapshot(snapshotId.data);
    }
    if (claim.state === "running") {
      throw new ApiFault("VERSION_CONFLICT", "This workshop version is already being saved; retry shortly.", { retryable: true });
    }
    if (claim.state === "failed") throw new ApiFault("INTERNAL_ERROR", "The workshop version could not be replayed.");

    return repository.saveWorkshopVersion({
      workshopId,
      expectedVersion: input.expectedVersion,
      machines: input.machines,
      name: input.name,
      snapshotId: randomUUID(),
      idempotencyRecordId: claim.recordId,
      idempotencyClaimToken: claim.claimToken,
    });
  });
}
