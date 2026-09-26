import { randomUUID } from "node:crypto";
import { RedeemInviteInputSchema, WorkspaceMembershipSchema } from "@/contracts";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { createSupabaseServiceClient } from "@/server/auth/service-client";
import { hashInviteToken } from "@/server/auth/invite-token";
import { throwDatabaseError } from "@/server/data/errors";
import { handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";

export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const { token } = await parseApiBody(request, RedeemInviteInputSchema.omit({ idempotencyKey: true }));
    readIdempotencyKey(request);
    const { user } = await getVerifiedRequestIdentity();
    const service = createSupabaseServiceClient();
    const { data, error } = await service.rpc("redeem_workspace_invite_internal", {
      p_actor_id: user.id,
      p_membership_id: randomUUID(),
      p_token_hash: hashInviteToken(token),
    });
    throwDatabaseError(error, "redeem workspace invitation");
    return WorkspaceMembershipSchema.parse(data);
  }, { status: 201 });
}
