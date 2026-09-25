import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  CreateWorkspaceResultSchema,
  WorkspaceMembershipSchema,
  type CreateWorkspaceResult,
  type Id,
  type Role,
  type WorkspaceMembership,
} from "@/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stablePayloadHash } from "@/server/domain/idempotency";
import { DataAdapterError, throwDatabaseError } from "./errors";

export const VISITOR_SESSION_COOKIE_NAME = "skw_visitor_session" as const;
export const DEFAULT_VISITOR_SESSION_TTL_SECONDS = 8 * 60 * 60;

export type VisitorReleaseScope = {
  sessionId: Id;
  releaseId: Id;
  accessLinkId: Id;
  displayName: string;
  workspaceId: Id;
  jobId: Id;
  expiresAt: string;
};

export type VisitorFlagScope = VisitorReleaseScope & { flagId: Id };
export type VisitorAssetScope = VisitorReleaseScope & { assetId: Id; assetKind: "source" | "issue_photo" };

export function deriveIdempotentBearerToken(
  pepper: string,
  purpose: "workspace-invite" | "release-access-link",
  scope: string,
  idempotencyKey: string,
): string {
  if (pepper.length < 32) {
    throw new DataAdapterError("INTERNAL_ERROR", "Bearer token derivation is not configured.");
  }
  const message = ["skunkworks-v1", purpose, scope, idempotencyKey].join("\0");
  return `skw1_${createHmac("sha256", pepper).update(message, "utf8").digest("base64url")}`;
}

export function hashBearerToken(token: string): string {
  if (token.length < 32 || token.length > 512) {
    throw new DataAdapterError("RELEASE_REVOKED", "Access is unavailable.");
  }
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function createWorkspace(
  input: {
    sessionClient: SupabaseClient;
    serviceClient: SupabaseClient;
    name: string;
    idempotencyKey: string;
  },
): Promise<CreateWorkspaceResult> {
  const { data: authData, error: authError } = await input.sessionClient.auth.getUser();
  if (authError || !authData.user) {
    throw new DataAdapterError("UNAUTHENTICATED", "A verified session is required.", {
      cause: authError ?? undefined,
    });
  }
  const name = input.name.trim();
  if (!name || input.idempotencyKey.length < 16 || input.idempotencyKey.length > 128) {
    throw new DataAdapterError("VALIDATION_FAILED", "Workspace name or idempotency key is invalid.");
  }
  const { data, error } = await input.serviceClient.rpc("create_workspace_internal", {
    p_actor_id: authData.user.id,
    p_name: name,
    p_idempotency_key: input.idempotencyKey,
    p_payload_hash: stablePayloadHash({ name }),
  });
  throwDatabaseError(error, "create workspace");
  return CreateWorkspaceResultSchema.parse(data);
}

export async function lookupWorkspaceInvite(
  serviceClient: SupabaseClient,
  token: string,
): Promise<{ workspaceId: Id; workspaceName: string; role: Exclude<Role, "admin">; expiresAt: string }> {
  const { data, error } = await serviceClient.rpc("lookup_workspace_invite_internal", {
    p_token_hash: hashBearerToken(token),
  });
  throwDatabaseError(error, "look up invite");
  if (!data) throw new DataAdapterError("NOT_FOUND", "Invite is unavailable.");
  const row = data as Record<string, unknown>;
  return {
    workspaceId: row.workspaceId as Id,
    workspaceName: String(row.workspaceName),
    role: row.role as Exclude<Role, "admin">,
    expiresAt: String(row.expiresAt),
  };
}

export async function redeemWorkspaceInvite(
  input: {
    sessionClient: SupabaseClient;
    serviceClient: SupabaseClient;
    token: string;
    idempotencyKey: string;
  },
): Promise<WorkspaceMembership> {
  const { data: authData, error: authError } = await input.sessionClient.auth.getUser();
  if (authError || !authData.user) {
    throw new DataAdapterError("UNAUTHENTICATED", "A verified session is required.", {
      cause: authError ?? undefined,
    });
  }
  const { data, error } = await input.serviceClient.rpc("redeem_workspace_invite_internal", {
    p_actor_id: authData.user.id,
    p_token_hash: hashBearerToken(input.token),
    p_idempotency_key: input.idempotencyKey,
    p_payload_hash: stablePayloadHash({ tokenHash: hashBearerToken(input.token) }),
  });
  throwDatabaseError(error, "redeem invite");
  return WorkspaceMembershipSchema.parse(data);
}

export async function exchangeReleaseAccessLink(
  input: {
    serviceClient: SupabaseClient;
    linkToken: string;
    displayName?: string;
    ttlSeconds?: number;
  },
): Promise<{ sessionToken: string; scope: VisitorReleaseScope }> {
  const sessionToken = randomBytes(32).toString("base64url");
  const displayName = input.displayName?.trim().slice(0, 120) || "Shop floor visitor";
  const { data, error } = await input.serviceClient.rpc("exchange_release_access_link_internal", {
    p_link_token_hash: hashBearerToken(input.linkToken),
    p_session_token_hash: hashBearerToken(sessionToken),
    p_display_name: displayName,
    p_session_ttl_seconds: input.ttlSeconds ?? DEFAULT_VISITOR_SESSION_TTL_SECONDS,
  });
  throwDatabaseError(error, "exchange release link");
  if (!data) throw new DataAdapterError("RELEASE_REVOKED", "Release access is unavailable.");
  return { sessionToken, scope: parseVisitorScope(data as Record<string, unknown>) };
}

export async function resolveVisitorReleaseScope(
  input: { serviceClient: SupabaseClient; sessionToken: string; releaseId: Id },
): Promise<VisitorReleaseScope> {
  const { data, error } = await input.serviceClient.rpc("resolve_release_visitor_session_internal", {
    p_session_token_hash: hashBearerToken(input.sessionToken),
    p_release_id: input.releaseId,
  });
  throwDatabaseError(error, "resolve visitor session");
  if (!data) throw new DataAdapterError("RELEASE_REVOKED", "Release access is unavailable.");
  return parseVisitorScope(data as Record<string, unknown>);
}

export async function resolveVisitorFlagScope(
  input: { serviceClient: SupabaseClient; sessionToken: string; flagId: Id },
): Promise<VisitorFlagScope> {
  const { data, error } = await input.serviceClient.rpc("resolve_visitor_flag_scope_internal", {
    p_session_token_hash: hashBearerToken(input.sessionToken),
    p_flag_id: input.flagId,
  });
  throwDatabaseError(error, "resolve visitor flag scope");
  if (!data) throw new DataAdapterError("NOT_FOUND", "Flag is unavailable.");
  const row = data as Record<string, unknown>;
  return { ...parseVisitorScope(row), flagId: row.flagId as Id };
}

export async function resolveVisitorAssetScope(
  input: { serviceClient: SupabaseClient; sessionToken: string; assetId: Id },
): Promise<VisitorAssetScope> {
  const { data, error } = await input.serviceClient.rpc("resolve_visitor_asset_scope_internal", {
    p_session_token_hash: hashBearerToken(input.sessionToken),
    p_asset_id: input.assetId,
  });
  throwDatabaseError(error, "resolve visitor asset scope");
  if (!data || typeof data !== "object") throw new DataAdapterError("NOT_FOUND", "Asset is unavailable.");
  const row = data as Record<string, unknown>;
  const assetKind = row.assetKind;
  if (assetKind !== "source" && assetKind !== "issue_photo") {
    throw new DataAdapterError("NOT_FOUND", "Asset is unavailable.");
  }
  return { ...parseVisitorScope(row), assetId: row.assetId as Id, assetKind };
}

function parseVisitorScope(row: Record<string, unknown>): VisitorReleaseScope {
  return {
    sessionId: row.sessionId as Id,
    releaseId: row.releaseId as Id,
    accessLinkId: row.accessLinkId as Id,
    displayName: String(row.displayName),
    workspaceId: row.workspaceId as Id,
    jobId: row.jobId as Id,
    expiresAt: String(row.expiresAt),
  };
}
