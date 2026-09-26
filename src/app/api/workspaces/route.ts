import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CreateWorkspaceBodySchema, CreateWorkspaceResultSchema } from "@/contracts";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { createSupabaseServiceClient } from "@/server/auth/service-client";
import { throwDatabaseError } from "@/server/data/errors";
import { stablePayloadHash } from "@/server/domain/idempotency";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";

const ClaimSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("claimed"), recordId: z.uuid(), claimToken: z.uuid() }),
  z.object({ state: z.literal("completed"), response: CreateWorkspaceResultSchema }),
  z.object({ state: z.literal("running") }),
  z.object({ state: z.literal("failed") }),
]);

export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const input = await parseApiBody(request, CreateWorkspaceBodySchema);
    const key = readIdempotencyKey(request);
    const { user } = await getVerifiedRequestIdentity();
    const service = createSupabaseServiceClient();

    const { data: rawClaim, error: claimError } = await service.rpc("claim_idempotency_internal", {
      p_actor_kind: "member",
      p_actor_id: user.id,
      p_operation: "workspace.create",
      p_idempotency_key: key,
      p_payload_hash: stablePayloadHash(input),
    });
    throwDatabaseError(claimError, "claim workspace creation");
    const claim = ClaimSchema.parse(rawClaim);
    if (claim.state === "completed") return claim.response;
    if (claim.state === "running") {
      throw new ApiFault("VERSION_CONFLICT", "Workspace creation is already running. Retry shortly.", { retryable: true });
    }
    if (claim.state === "failed") throw new ApiFault("INTERNAL_ERROR", "The workspace creation attempt failed.");

    const { data, error } = await service.rpc("create_workspace_internal", {
      p_actor_id: user.id,
      p_workspace_id: randomUUID(),
      p_membership_id: randomUUID(),
      p_name: input.name,
      p_idempotency_record_id: claim.recordId,
      p_idempotency_claim_token: claim.claimToken,
    });
    throwDatabaseError(error, "create workspace");
    return CreateWorkspaceResultSchema.parse(data);
  }, { status: 201 });
}
