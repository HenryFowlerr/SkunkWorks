import {
  ActorSchema,
  WorkspaceMembershipSchema,
  type Actor,
  type Role,
} from "@/contracts";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { ApiFault } from "../http/api";

export function actorForMembership(
  user: Pick<User, "id" | "user_metadata" | "email">,
  membershipValue: unknown,
  workspaceId: string,
  allowedRoles?: readonly Role[],
): Actor {
  const membership = WorkspaceMembershipSchema.parse(membershipValue);
  if (membership.workspaceId !== workspaceId || membership.userId !== user.id) {
    throw new ApiFault("FORBIDDEN", "This account is not an active member of the requested workspace.");
  }
  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    throw new ApiFault("FORBIDDEN", "Your workspace role cannot perform this action.");
  }

  const metadataName = user.user_metadata?.display_name;
  const displayName =
    typeof metadataName === "string" && metadataName.trim()
      ? metadataName.trim().slice(0, 120)
      : user.email?.split("@", 1)[0] || "Workshop member";

  return ActorSchema.parse({
    id: user.id,
    displayName,
    kind: "member",
    // Domain services must receive the role for this workspace only.
    roles: [membership.role],
  });
}

export async function getWorkspaceActor(
  workspaceId: string,
  allowedRoles?: readonly Role[],
): Promise<{ supabase: SupabaseClient; user: User; actor: Actor }> {
  const { supabase, user } = await getVerifiedRequestIdentity();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("id, workspace_id, user_id, role, created_at")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new ApiFault("PROVIDER_UNAVAILABLE", "Workspace permissions could not be checked.", {
      retryable: true,
    });
  }
  if (!data) throw new ApiFault("FORBIDDEN", "This account is not an active member of the requested workspace.");

  return {
    supabase,
    user,
    actor: actorForMembership(
      user,
      {
        id: data.id,
        workspaceId: data.workspace_id,
        userId: data.user_id,
        role: data.role,
        createdAt: data.created_at,
      },
      workspaceId,
      allowedRoles,
    ),
  };
}
