import {
  ActorSchema,
  AuthSessionViewSchema,
  WorkspaceMembershipSchema,
  type AuthSessionView,
} from "@/contracts";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { ApiFault } from "../http/api";

export async function loadAuthSessionView(
  supabase: SupabaseClient,
  user: User,
): Promise<AuthSessionView> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("id, workspace_id, user_id, role, created_at")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) {
    throw new ApiFault("PROVIDER_UNAVAILABLE", "Workspace membership could not be loaded.", {
      retryable: true,
    });
  }

  const memberships = (data ?? []).map((row) =>
    WorkspaceMembershipSchema.parse({
      id: row.id,
      workspaceId: row.workspace_id,
      userId: row.user_id,
      role: row.role,
      createdAt: row.created_at,
    }),
  );
  const roles = [...new Set(memberships.map((membership) => membership.role))];
  const metadataName = user.user_metadata?.display_name;
  const displayName =
    typeof metadataName === "string" && metadataName.trim()
      ? metadataName.trim().slice(0, 120)
      : user.email?.split("@", 1)[0] || "Workshop member";

  const actor = ActorSchema.parse({
    id: user.id,
    displayName,
    kind: "member",
    roles,
  });

  return AuthSessionViewSchema.parse({ actor, memberships });
}
