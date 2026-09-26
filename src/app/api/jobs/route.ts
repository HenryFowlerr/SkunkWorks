import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CreateJobBodySchema, IdSchema, JobSchema } from "@/contracts";
import { getWorkspaceApiContext } from "@/server/api/context";
import { stablePayloadHash } from "@/server/domain/idempotency";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";

const WorkspaceQuerySchema = z.object({ workspaceId: IdSchema }).strict();

export async function GET(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const url = new URL(request.url);
    const { workspaceId } = WorkspaceQuerySchema.parse({ workspaceId: url.searchParams.get("workspaceId") });
    const { repository } = await getWorkspaceApiContext(workspaceId);
    return repository.listJobs();
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const input = await parseApiBody(request, CreateJobBodySchema);
    const key = readIdempotencyKey(request);
    const { repository } = await getWorkspaceApiContext(input.workspaceId, ["designer"]);
    const claim = await repository.claimIdempotency({
      operation: "job.create",
      key,
      payloadHash: stablePayloadHash(input),
    });
    if (claim.state === "completed") return JobSchema.parse(claim.response);
    if (claim.state === "running") {
      throw new ApiFault("VERSION_CONFLICT", "This job creation is already running. Retry shortly.", { retryable: true });
    }
    if (claim.state === "failed") throw new ApiFault("INTERNAL_ERROR", "The job creation attempt failed.");
    return repository.createJob({
      jobId: randomUUID(),
      title: input.title,
      partNumber: input.partNumber,
      partFamily: input.partFamily,
      workshopSnapshotId: input.workshopSnapshotId,
      machineId: input.machineId,
      idempotencyRecordId: claim.recordId,
      idempotencyClaimToken: claim.claimToken,
    });
  }, { status: 201 });
}
