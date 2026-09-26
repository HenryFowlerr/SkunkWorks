// @vitest-environment node
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createPrivateStorageAdapter } from "@/server/data/storage";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const assetId = "00000000-0000-4000-8000-000000000003";
const actorId = "00000000-0000-4000-8000-000000000004";
const bytes = Uint8Array.from([0xcc, 0x73, 0x24, 0x50, 0, 0, 0, 4]);

function setup(options: { byteSize?: number; mimeType?: string; actorId?: string } = {}) {
  const row = {
    id: assetId, workspace_id: workspaceId, job_id: jobId, release_id: null,
    kind: "native_part", filename: "part.SLDPRT", mime_type: "application/octet-stream",
    byte_size: options.byteSize ?? bytes.length, sha256: null, version: 1, status: "pending",
    drawing_revision: null, storage_key: `workspaces/${workspaceId}/jobs/${jobId}/assets/${assetId}/blob`,
    uploaded_by_user_id: options.actorId ?? actorId, uploaded_by_visitor_session_id: null,
  };
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValueOnce({ data: row, error: null })
      .mockResolvedValueOnce({ data: { ...row, status: "ready", sha256: createHash("sha256").update(bytes).digest("hex") }, error: null }),
  };
  const storage = {
    download: vi.fn().mockResolvedValue({ data: new Blob([bytes], { type: options.mimeType ?? "application/octet-stream" }), error: null }),
    remove: vi.fn().mockResolvedValue({ error: null }),
  };
  const client = { from: vi.fn().mockReturnValue(query), storage: { from: vi.fn().mockReturnValue(storage) } };
  return { adapter: createPrivateStorageAdapter({ serviceClient: client as unknown as SupabaseClient }), query, storage, row };
}

const input = { workspaceId, jobId, assetId, actorId };

describe("private opaque native source retention", () => {
  it("hashes opaque native bytes without claiming a recognized CAD signature", async () => {
    const { adapter, query } = setup();
    const asset = await adapter.finalizeMemberAsset(input);
    expect(asset).toMatchObject({ kind: "native_part", status: "ready", byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ status: "ready", sha256: asset.sha256 }));
  });

  it.each([{ byteSize: bytes.length + 1 }, { mimeType: "text/html" }])("rejects mismatched stored bytes or content type: %j", async (options) => {
    const { adapter, query, storage } = setup(options);
    await expect(adapter.finalizeMemberAsset(input)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    expect(storage.remove).toHaveBeenCalledOnce();
  });

  it("does not download or complete another member's pending upload", async () => {
    const { adapter, storage } = setup({ actorId: "00000000-0000-4000-8000-000000000009" });
    await expect(adapter.finalizeMemberAsset(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storage.download).not.toHaveBeenCalled();
  });

  it("serves native sources as private attachments with nosniff", async () => {
    const { adapter, row } = setup();
    const asset = await adapter.finalizeMemberAsset(input);
    const response = await adapter.streamAuthorizedAsset({ bucketId: "skunkworks-private", objectKey: row.storage_key, asset });
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="part.SLDPRT"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
