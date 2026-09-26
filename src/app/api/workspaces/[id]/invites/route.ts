import { randomUUID } from "node:crypto";
import { z } from "zod";
import { IdSchema, WorkspaceInviteSchema } from "@/contracts";
import { getWorkspaceActor } from "@/server/auth/authorization";
import { createSupabaseServiceClient, getSupabasePrivilegedConfig } from "@/server/auth/service-client";
import { deriveInviteToken, hashInviteToken } from "@/server/auth/invite-token";
import { throwDatabaseError } from "@/server/data/errors";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";

const IssueInviteBodySchema = z.object({
  role: z.enum(["designer", "fabricator"]),
  invitedEmail: z.email(),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleApiOperation(async () => {
    const { id } = await context.params;
    const workspaceId = IdSchema.safeParse(id);
    if (!workspaceId.success) throw new ApiFault("NOT_FOUND", "Workspace not found.");
    const body = await parseApiBody(request, IssueInviteBodySchema);
    const key = readIdempotencyKey(request);
    const { user } = await getWorkspaceActor(workspaceId.data, ["admin"]);
    const origin = new URL(request.url).origin;
    if (!origin.startsWith("https://") && !origin.startsWith("http://localhost:")) {
      throw new ApiFault("PROVIDER_UNAVAILABLE", "A secure public URL is needed for invitation links.");
    }
    const config = getSupabasePrivilegedConfig();
    const token = deriveInviteToken({
      secret: config.serviceRoleKey,
      actorId: user.id,
      workspaceId: workspaceId.data,
      idempotencyKey: key,
    });
    const service = createSupabaseServiceClient(config);
    const { data, error } = await service.rpc("issue_workspace_invite_internal", {
      p_workspace_id: workspaceId.data,
      p_actor_id: user.id,
      p_invite_id: randomUUID(),
      p_token_hash: hashInviteToken(token),
      p_invited_email: body.invitedEmail.trim().toLowerCase(),
      p_role: body.role,
    });
    throwDatabaseError(error, "issue workspace invitation");
    return WorkspaceInviteSchema.parse({
      ...data,
      inviteUrl: new URL(`/invite/${token}`, origin).toString(),
    });
  }, { status: 201 });
}
