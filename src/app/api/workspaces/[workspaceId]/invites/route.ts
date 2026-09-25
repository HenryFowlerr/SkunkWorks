import { InviteWorkspaceMemberInputSchema } from "@/contracts";
import { getWorkspaceApiContext, parseRouteId } from "@/server/api/context";
import { handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";
import { z } from "zod";

const InviteBodySchema = InviteWorkspaceMemberInputSchema.omit({ workspaceId: true, idempotencyKey: true })
  .extend({ role: z.enum(["designer", "fabricator"]) })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const { workspaceId: rawWorkspaceId } = await context.params;
    const workspaceId = parseRouteId(rawWorkspaceId);
    const body = await parseApiBody(request, InviteBodySchema);
    const idempotencyKey = readIdempotencyKey(request);
    const { repository } = await getWorkspaceApiContext(workspaceId, ["admin"]);
    const invite = await repository.createInvite({ role: body.role, idempotencyKey });
    const origin = request.headers.get("origin");
    if (!origin) throw new TypeError("Same-origin invite requests require an Origin header.");
    const inviteUrl = new URL(`/invite/${encodeURIComponent(invite.token)}`, origin).toString();
    return {
      id: invite.inviteId,
      workspaceId: invite.workspaceId,
      role: invite.role,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      inviteUrl,
    };
  }, { status: 201 });
}
