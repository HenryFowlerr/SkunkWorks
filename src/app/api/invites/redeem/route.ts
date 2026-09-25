import { RedeemInviteInputSchema } from "@/contracts";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { createSupabaseServiceClient, getSupabasePrivilegedConfig } from "@/server/auth/service-client";
import { redeemWorkspaceInvite } from "@/server/data/tokens";
import { handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";

export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const body = await parseApiBody(request, RedeemInviteInputSchema.omit({ idempotencyKey: true }));
    const idempotencyKey = readIdempotencyKey(request);
    const { supabase: sessionClient } = await getVerifiedRequestIdentity();
    const config = getSupabasePrivilegedConfig();
    return redeemWorkspaceInvite({
      sessionClient,
      serviceClient: createSupabaseServiceClient(config),
      token: body.token,
      idempotencyKey,
    });
  }, { status: 201 });
}
