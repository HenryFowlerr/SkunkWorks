import "server-only";

import { ActorSchema, IdSchema, type Actor, type Role } from "@/contracts";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createWorkspaceDataRepository, type WorkspaceDataRepository } from "@/server/data/repository";
import { createSupabaseServiceClient, getSupabasePrivilegedConfig } from "@/server/auth/service-client";
import { ApiFault } from "../http/api";

export async function getWorkspaceApiContext(
  workspaceId: string,
  allowedRoles?: readonly Role[],
): Promise<{
  repository: WorkspaceDataRepository;
  actor: Actor;
  sessionClient: SupabaseClient;
}> {
  const { supabase: sessionClient, user } = await getVerifiedRequestIdentity();
  return assembleWorkspaceContext(sessionClient, user, workspaceId, allowedRoles);
}

/** Resolve the workspace under the caller's RLS-bound session before using the server repository. */
export async function getJobApiContext(
  jobId: string,
  allowedRoles?: readonly Role[],
): Promise<{
  repository: WorkspaceDataRepository;
  actor: Actor;
  sessionClient: SupabaseClient;
}> {
  const { supabase: sessionClient, user } = await getVerifiedRequestIdentity();
  const { data, error } = await sessionClient
    .from("jobs")
    .select("workspace_id")
    .eq("id", jobId)
    .maybeSingle();
  if (error) {
    throw new ApiFault("PROVIDER_UNAVAILABLE", "Job access could not be checked.", { retryable: true });
  }
  if (!data?.workspace_id) throw new ApiFault("NOT_FOUND", "Job not found.");
  return assembleWorkspaceContext(sessionClient, user, data.workspace_id, allowedRoles);
}

export async function getWorkshopApiContext(
  workshopId: string,
  allowedRoles?: readonly Role[],
): Promise<{ repository: WorkspaceDataRepository; actor: Actor; sessionClient: SupabaseClient }> {
  const { supabase: sessionClient, user } = await getVerifiedRequestIdentity();
  const { data, error } = await sessionClient
    .from("workshops")
    .select("workspace_id")
    .eq("id", workshopId)
    .maybeSingle();
  if (error) throw new ApiFault("PROVIDER_UNAVAILABLE", "Workshop access could not be checked.", { retryable: true });
  if (!data?.workspace_id) throw new ApiFault("NOT_FOUND", "Workshop not found.");
  return assembleWorkspaceContext(sessionClient, user, data.workspace_id, allowedRoles);
}

async function assembleWorkspaceContext(
  sessionClient: SupabaseClient,
  user: User,
  workspaceId: string,
  allowedRoles?: readonly Role[],
): Promise<{ repository: WorkspaceDataRepository; actor: Actor; sessionClient: SupabaseClient }> {
  const config = getSupabasePrivilegedConfig();
  const repository = await createWorkspaceDataRepository({
    sessionClient,
    serviceClient: createSupabaseServiceClient(config),
    workspaceId,
    ...(allowedRoles ? { requiredRoles: [...allowedRoles] } : {}),
  });
  const metadataName = user.user_metadata?.display_name;
  const displayName =
    typeof metadataName === "string" && metadataName.trim()
      ? metadataName.trim().slice(0, 120)
      : user.email?.split("@", 1)[0] || "Workshop member";

  return {
    repository,
    actor: ActorSchema.parse({
      id: repository.actorId,
      displayName,
      kind: "member",
      roles: [repository.role],
    }),
    sessionClient,
  };
}

export function parseRouteId(value: string | undefined): string {
  const parsed = IdSchema.safeParse(value);
  if (!parsed.success) throw new ApiFault("NOT_FOUND", "The requested resource was not found.");
  return parsed.data;
}
