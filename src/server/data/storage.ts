import "server-only";

import { createHash } from "node:crypto";
import {
  AssetSchema,
  UploadPreparationSchema,
  type Asset,
  type Id,
  type UploadPreparation,
} from "@/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DataAdapterError, throwDatabaseError } from "./errors";
import type { AuthorizedPrivateAsset } from "./repository";

export const PRIVATE_ASSET_BUCKET = "skunkworks-private" as const;
const SIGNED_UPLOAD_TTL_SECONDS = 2 * 60 * 60;

type StoredAssetRow = {
  id: Id;
  workspace_id: Id;
  job_id: Id;
  release_id: Id | null;
  kind: Asset["kind"];
  filename: string;
  mime_type: string;
  byte_size: number;
  sha256: string | null;
  version: number;
  status: Asset["status"];
  drawing_revision: string | null;
  storage_key: string;
  uploaded_by_user_id: Id | null;
  uploaded_by_visitor_session_id: Id | null;
};

type VisitorSessionRow = {
  id: Id;
  access_link_id: Id;
  expires_at: string;
  revoked_at: string | null;
};
type AccessLinkRow = {
  id: Id;
  release_id: Id;
  job_id: Id;
  revoked_at: string | null;
};

export type PrivateStorageAdapter = {
  prepareMemberSourceUpload(input: {
    sessionClient: SupabaseClient;
    workspaceId: Id;
    jobId: Id;
    assetId: Id;
  }): Promise<UploadPreparation>;
  prepareVisitorPhotoUpload(input: {
    sessionToken: string;
    releaseId: Id;
    assetId: Id;
  }): Promise<UploadPreparation>;
  finalizeMemberAsset(input: {
    workspaceId: Id;
    jobId: Id;
    assetId: Id;
    actorId: Id;
  }): Promise<Asset>;
  finalizeVisitorPhoto(input: {
    sessionToken: string;
    releaseId: Id;
    assetId: Id;
  }): Promise<Asset>;
  authorizeMemberAsset(input: {
    workspaceId: Id;
    jobId: Id;
    assetId: Id;
  }): Promise<AuthorizedPrivateAsset>;
  authorizeVisitorAsset(input: {
    sessionToken: string;
    releaseId: Id;
    assetId: Id;
  }): Promise<AuthorizedPrivateAsset>;
  streamAuthorizedAsset(asset: AuthorizedPrivateAsset): Promise<Response>;
};

export function createPrivateStorageAdapter(
  options: { serviceClient: SupabaseClient },
): PrivateStorageAdapter {
  const { serviceClient } = options;
  return {
    async prepareMemberSourceUpload({ sessionClient, workspaceId, jobId, assetId }) {
      const { data: authData, error: authError } = await sessionClient.auth.getUser();
      if (authError || !authData.user) {
        throw new DataAdapterError("UNAUTHENTICATED", "A verified session is required.", {
          cause: authError ?? undefined,
        });
      }

      const { data, error } = await sessionClient
        .from("assets")
        .select("*")
        .eq("id", assetId)
        .eq("workspace_id", workspaceId)
        .eq("job_id", jobId)
        .eq("status", "pending")
        .maybeSingle();
      throwDatabaseError(error, "read prepared asset");
      const row = data as StoredAssetRow | null;
      if (
        !row ||
        row.kind === "issue_photo" ||
        row.uploaded_by_user_id !== authData.user.id ||
        row.uploaded_by_visitor_session_id !== null
      ) {
        throw new DataAdapterError("FORBIDDEN", "The prepared upload is not available to this actor.");
      }

      return createSignedUploadInstruction(sessionClient, row);
    },

    async prepareVisitorPhotoUpload({ sessionToken, releaseId, assetId }) {
      const session = await findLiveVisitorSession(serviceClient, sessionToken, releaseId);
      const { data, error } = await serviceClient
        .from("assets")
        .select("*")
        .eq("id", assetId)
        .eq("release_id", releaseId)
        .eq("status", "pending")
        .maybeSingle();
      throwDatabaseError(error, "read prepared visitor photo");
      const row = data as StoredAssetRow | null;
      if (
        !row ||
        row.kind !== "issue_photo" ||
        row.uploaded_by_visitor_session_id !== session.id ||
        row.uploaded_by_user_id !== null
      ) {
        throw new DataAdapterError("FORBIDDEN", "The prepared photo is not bound to this release session.");
      }

      return createSignedUploadInstruction(serviceClient, row);
    },

    async finalizeMemberAsset({ workspaceId, jobId, assetId, actorId }) {
      const { data, error } = await serviceClient
        .from("assets")
        .select("*")
        .eq("id", assetId)
        .eq("workspace_id", workspaceId)
        .eq("job_id", jobId)
        .maybeSingle();
      throwDatabaseError(error, "read asset for finalization");
      const row = data as StoredAssetRow | null;
      if (!row) throw new DataAdapterError("NOT_FOUND", "Asset not found.");
      if (row.uploaded_by_user_id !== actorId || row.kind === "issue_photo") {
        throw new DataAdapterError("FORBIDDEN", "Only the initiating member can finalize this source upload.");
      }
      return finalizePendingAsset(serviceClient, row);
    },

    async finalizeVisitorPhoto({ sessionToken, releaseId, assetId }) {
      const session = await findLiveVisitorSession(serviceClient, sessionToken, releaseId);
      const { data, error } = await serviceClient
        .from("assets")
        .select("*")
        .eq("id", assetId)
        .eq("release_id", releaseId)
        .maybeSingle();
      throwDatabaseError(error, "read visitor photo for finalization");
      const row = data as StoredAssetRow | null;
      if (
        !row ||
        row.kind !== "issue_photo" ||
        row.uploaded_by_visitor_session_id !== session.id ||
        row.uploaded_by_user_id !== null
      ) {
        throw new DataAdapterError("FORBIDDEN", "Only the initiating release session can finalize this photo.");
      }
      return finalizePendingAsset(serviceClient, row);
    },

    async authorizeMemberAsset({ workspaceId, jobId, assetId }) {
      const { data, error } = await serviceClient
        .from("assets")
        .select("*")
        .eq("id", assetId)
        .eq("workspace_id", workspaceId)
        .eq("job_id", jobId)
        .eq("status", "ready")
        .maybeSingle();
      throwDatabaseError(error, "authorize workspace asset");
      const row = data as StoredAssetRow | null;
      if (!row) throw new DataAdapterError("NOT_FOUND", "Asset not found.");
      return authorizedAsset(row);
    },

    async authorizeVisitorAsset({ sessionToken, releaseId, assetId }) {
      const session = await findLiveVisitorSession(serviceClient, sessionToken, releaseId);
      const { data: grantData, error: grantError } = await serviceClient
        .from("release_visitor_session_grants")
        .select("workspace_id,job_id,release_id")
        .eq("session_id", session.id)
        .eq("release_id", releaseId)
        .maybeSingle();
      throwDatabaseError(grantError, "authorize visitor release");
      const grant = grantData as { workspace_id: Id; job_id: Id; release_id: Id } | null;
      if (!grant) throw new DataAdapterError("RELEASE_REVOKED", "This release is not granted to the session.");

      const { data: releaseAsset, error: releaseAssetError } = await serviceClient
        .from("release_assets")
        .select("asset_id")
        .eq("release_id", releaseId)
        .eq("asset_id", assetId)
        .maybeSingle();
      throwDatabaseError(releaseAssetError, "check release source asset");

      let allowed = Boolean(releaseAsset);
      if (!allowed) {
        const { data: photo, error: photoError } = await serviceClient
          .from("flag_photo_assets")
          .select("asset_id")
          .eq("release_id", releaseId)
          .eq("asset_id", assetId)
          .maybeSingle();
        throwDatabaseError(photoError, "check attached release photo");
        allowed = Boolean(photo);
      }
      if (!allowed) throw new DataAdapterError("NOT_FOUND", "Asset not found.");

      const { data, error } = await serviceClient
        .from("assets")
        .select("*")
        .eq("id", assetId)
        .eq("workspace_id", grant.workspace_id)
        .eq("job_id", grant.job_id)
        .eq("status", "ready")
        .maybeSingle();
      throwDatabaseError(error, "load authorized release asset");
      const row = data as StoredAssetRow | null;
      if (!row) throw new DataAdapterError("NOT_FOUND", "Asset not found.");
      if (row.kind === "issue_photo" && row.release_id !== releaseId) {
        throw new DataAdapterError("NOT_FOUND", "Asset not found.");
      }
      if (row.kind !== "issue_photo" && row.release_id !== null) {
        throw new DataAdapterError("NOT_FOUND", "Asset not found.");
      }
      return authorizedAsset(row);
    },

    async streamAuthorizedAsset(asset) {
      assertSafeAssetPath(asset);
      const { data: blob, error } = await serviceClient.storage
        .from(PRIVATE_ASSET_BUCKET)
        .download(asset.objectKey, {}, { cache: "no-store" });
      if (error || !blob) {
        throw new DataAdapterError("NOT_FOUND", "Private asset is unavailable.");
      }

      const headers = new Headers();
      headers.set("Content-Type", asset.asset.mimeType);
      headers.set("Content-Length", String(asset.asset.byteSize));
      headers.set("Content-Disposition", `${isNativeSource(asset.asset.kind) ? "attachment" : "inline"}; filename="${safeFilename(asset.asset.filename)}"`);
      headers.set("Cache-Control", "private, no-store");
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(blob.stream(), { status: 200, headers });
    },
  };
}

async function createSignedUploadInstruction(
  sessionClient: SupabaseClient,
  row: StoredAssetRow,
): Promise<UploadPreparation> {
  assertSafeStorageKey(row.storage_key);
  if (row.status !== "pending" || row.sha256 !== null) {
    throw new DataAdapterError("VERSION_CONFLICT", "Asset is no longer awaiting upload.");
  }

  const { data, error } = await sessionClient.storage
    .from(PRIVATE_ASSET_BUCKET)
    .createSignedUploadUrl(row.storage_key, { upsert: false });
  throwDatabaseError(error, "create signed upload instruction");
  if (!data?.signedUrl) throw new DataAdapterError("INTERNAL_ERROR", "Storage returned no upload URL.");
  const expiresAt = new Date(Date.now() + SIGNED_UPLOAD_TTL_SECONDS * 1000).toISOString();

  return UploadPreparationSchema.parse({
    assetId: row.id,
    upload: {
      url: data.signedUrl,
      method: "PUT",
      headers: {
        "Content-Type": row.mime_type,
        "x-upsert": "false",
      },
      expiresAt,
    },
  });
}

async function finalizePendingAsset(
  serviceClient: SupabaseClient,
  row: StoredAssetRow,
): Promise<Asset> {
  if (row.status === "ready" && row.sha256) return mapAsset(row);
  if (row.status !== "pending") {
    throw new DataAdapterError("VERSION_CONFLICT", "Asset is not pending verification.");
  }
  assertSafeStorageKey(row.storage_key);

  const { data: blob, error: downloadError } = await serviceClient.storage
    .from(PRIVATE_ASSET_BUCKET)
    .download(row.storage_key, {}, { cache: "no-store" });
  if (downloadError || !blob) {
    throw new DataAdapterError("INTERNAL_ERROR", "Uploaded object could not be verified.");
  }

  const digest = createHash("sha256");
  const prefix: number[] = [];
  let byteSize = 0;
  try {
    const reader = blob.stream().getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      byteSize += value.byteLength;
      digest.update(value);
      for (let index = 0; index < value.length && prefix.length < 32; index += 1) {
        prefix.push(value[index]);
      }
    }
  } catch (cause) {
    throw new DataAdapterError("INTERNAL_ERROR", "Uploaded object could not be read for verification.", {
      cause,
    });
  }

  const sha256 = digest.digest("hex");
  const contentType = blob.type.split(";")[0]?.trim().toLowerCase();
  // Native sources are opaque retention only: size and hash verification does
  // not certify a valid SolidWorks document or make its bytes AI evidence.
  const signatureType = isNativeSource(row.kind)
    ? "application/octet-stream"
    : inspectAssetSignature(row.kind, prefix);
  const typeMatches =
    signatureType !== null &&
    (row.kind === "model_glb"
      ? contentType === "model/gltf-binary" || contentType === "application/octet-stream"
      : contentType === signatureType);
  if (byteSize !== row.byte_size || !typeMatches) {
    await failAsset(serviceClient, row, byteSize !== row.byte_size ? "BYTE_SIZE_MISMATCH" : "CONTENT_MISMATCH");
    throw new DataAdapterError("VALIDATION_FAILED", "Uploaded bytes do not match the prepared asset.");
  }

  const { data, error } = await serviceClient
    .from("assets")
    .update({
      status: "ready",
      sha256,
      completed_at: new Date().toISOString(),
      failure_code: null,
    })
    .eq("id", row.id)
    .eq("workspace_id", row.workspace_id)
    .eq("job_id", row.job_id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  throwDatabaseError(error, "finalize verified asset");

  if (data) return mapAsset(data as StoredAssetRow);

  // A competing finalizer may have committed the same bytes. Return that
  // winner only if its verified digest matches; never last-write-wins.
  const { data: refreshed, error: refreshError } = await serviceClient
    .from("assets")
    .select("*")
    .eq("id", row.id)
    .eq("workspace_id", row.workspace_id)
    .eq("job_id", row.job_id)
    .maybeSingle();
  throwDatabaseError(refreshError, "reload finalized asset");
  const finalRow = refreshed as StoredAssetRow | null;
  if (finalRow?.status === "ready" && finalRow.sha256 === sha256) return mapAsset(finalRow);

  throw new DataAdapterError("VERSION_CONFLICT", "Asset finalization raced with another update.");
}

async function failAsset(
  serviceClient: SupabaseClient,
  row: StoredAssetRow,
  reason: string,
) {
  const { error } = await serviceClient
    .from("assets")
    .update({ status: "failed", failure_code: reason })
    .eq("id", row.id)
    .eq("workspace_id", row.workspace_id)
    .eq("job_id", row.job_id)
    .eq("status", "pending");
  throwDatabaseError(error, "mark failed asset");

  // Failed objects remain unreadable under RLS even if cleanup fails. A
  // replacement uses a fresh asset ID and path rather than overwriting.
  const { error: storageError } = await serviceClient.storage
    .from(PRIVATE_ASSET_BUCKET)
    .remove([row.storage_key]);
  if (storageError) {
    // Avoid logging storage/provider output; an orphan is inaccessible because
    // the only member SELECT policy requires status = 'ready'.
    void storageError;
  }
}

async function findLiveVisitorSession(
  serviceClient: SupabaseClient,
  sessionToken: string,
  releaseId: Id,
): Promise<VisitorSessionRow> {
  if (!sessionToken || sessionToken.length < 32) {
    throw new DataAdapterError("RELEASE_REVOKED", "Release access is unavailable.");
  }
  const tokenHash = createHash("sha256").update(sessionToken, "utf8").digest("hex");
  const { data, error } = await serviceClient
    .from("release_visitor_sessions")
    .select("*")
    .eq("session_token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  throwDatabaseError(error, "validate visitor session");
  const session = data as VisitorSessionRow | null;
  if (!session) throw new DataAdapterError("RELEASE_REVOKED", "Release access is unavailable.");

  const { data: linkData, error: linkError } = await serviceClient
    .from("release_access_links")
    .select("*")
    .eq("id", session.access_link_id)
    .is("revoked_at", null)
    .maybeSingle();
  throwDatabaseError(linkError, "validate visitor link");
  const link = linkData as AccessLinkRow | null;
  if (!link) throw new DataAdapterError("RELEASE_REVOKED", "Release access is unavailable.");

  const { data: grantData, error: grantError } = await serviceClient
    .from("release_visitor_session_grants")
    .select("workspace_id,job_id,origin_release_id,origin_access_link_id,release_id,grant_kind")
    .eq("session_id", session.id)
    .eq("release_id", releaseId)
    .maybeSingle();
  throwDatabaseError(grantError, "validate visitor release grant");
  const grant = grantData as {
    workspace_id: Id;
    job_id: Id;
    origin_release_id: Id;
    origin_access_link_id: Id;
    release_id: Id;
    grant_kind: "original_link" | "explicit_replacement_follow";
  } | null;
  if (
    !grant ||
    grant.release_id !== releaseId ||
    grant.job_id !== link.job_id ||
    grant.origin_access_link_id !== link.id ||
    grant.origin_release_id !== link.release_id ||
    (grant.grant_kind === "original_link" && releaseId !== link.release_id) ||
    (grant.grant_kind === "explicit_replacement_follow" && releaseId === link.release_id)
  ) {
    throw new DataAdapterError("RELEASE_REVOKED", "Release access is unavailable.");
  }
  return session;
}

function mapAsset(row: StoredAssetRow): Asset {
  return AssetSchema.parse({
    id: row.id,
    jobId: row.job_id,
    releaseId: row.release_id,
    kind: row.kind,
    filename: row.filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    version: row.version,
    status: row.status,
    drawingRevision: row.drawing_revision,
  });
}

function authorizedAsset(row: StoredAssetRow): AuthorizedPrivateAsset {
  return { bucketId: PRIVATE_ASSET_BUCKET, objectKey: row.storage_key, asset: mapAsset(row) };
}

function isNativeSource(kind: Asset["kind"]) {
  return kind === "native_part" || kind === "native_drawing";
}

function inspectAssetSignature(kind: Asset["kind"], bytes: number[]): string | null {
  const startsWith = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  if (kind === "drawing_pdf") {
    return startsWith(0x25, 0x50, 0x44, 0x46, 0x2d) ? "application/pdf" : null;
  }
  if (kind === "model_glb") {
    return startsWith(0x67, 0x6c, 0x54, 0x46) ? "model/gltf-binary" : null;
  }
  if (kind === "bend_manifest") {
    const first = bytes.find((byte) => ![0x09, 0x0a, 0x0d, 0x20].includes(byte));
    return first === 0x7b || first === 0x5b ? "application/json" : null;
  }
  if (kind === "issue_photo") {
    if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
    if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
    if (
      startsWith(0x52, 0x49, 0x46, 0x46) &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) return "image/webp";
  }
  return null;
}

function assertSafeAssetPath(asset: AuthorizedPrivateAsset) {
  if (asset.bucketId !== PRIVATE_ASSET_BUCKET || asset.asset.status !== "ready") {
    throw new DataAdapterError("FORBIDDEN", "Asset is not authorized for private storage access.");
  }
  assertSafeStorageKey(asset.objectKey);
}

function assertSafeStorageKey(key: string) {
  const pattern =
    /^workspaces\/[0-9a-f-]{36}\/jobs\/[0-9a-f-]{36}\/assets\/[0-9a-f-]{36}\/blob$/i;
  if (!pattern.test(key)) throw new DataAdapterError("VALIDATION_FAILED", "Invalid private storage key.");
}

function safeFilename(filename: string) {
  return filename.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "asset";
}
