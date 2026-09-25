import { randomUUID } from "node:crypto";
import { CreateWorkshopBodySchema, IdSchema } from "@/contracts";
import { getWorkspaceApiContext } from "@/server/api/context";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";
import { stablePayloadHash } from "@/server/domain/idempotency";
import { z } from "zod";

const WorkspaceQuerySchema = z.object({ workspaceId: IdSchema }).strict();

export async function GET(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const url = new URL(request.url);
    const query = WorkspaceQuerySchema.parse({ workspaceId: url.searchParams.get("workspaceId") });
    const { repository } = await getWorkspaceApiContext(query.workspaceId);
    return repository.listWorkshopSnapshots();
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const input = await parseApiBody(request, CreateWorkshopBodySchema);
    const idempotencyKey = readIdempotencyKey(request);
    const { repository } = await getWorkspaceApiContext(input.workspaceId, ["fabricator"]);
    const claim = await repository.claimIdempotency({
      operation: "workshop.create",
      key: idempotencyKey,
      payloadHash: stablePayloadHash(input),
    });
    if (claim.state === "completed") {
      const response = claim.response as { snapshotId?: unknown } | null;
      const snapshotId = IdSchema.safeParse(response?.snapshotId);
      if (!snapshotId.success || claim.resourceId !== snapshotId.data) {
        throw new ApiFault("INTERNAL_ERROR", "The stored workshop creation is invalid.");
      }
      return repository.getWorkshopSnapshot(snapshotId.data);
    }
    if (claim.state === "running") {
      throw new ApiFault("VERSION_CONFLICT", "This workshop creation is already running; retry shortly.", { retryable: true });
    }
    if (claim.state === "failed") throw new ApiFault("INTERNAL_ERROR", "The workshop creation could not be replayed.");

    return repository.createWorkshop({
      workshopId: randomUUID(),
      snapshotId: randomUUID(),
      name: input.name,
      idempotencyRecordId: claim.recordId,
      idempotencyClaimToken: claim.claimToken,
    });
  }, { status: 201 });
}
