import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  parseRouteId,
  readVisitorSessionToken,
  getSupabasePrivilegedConfig,
  createSupabaseServiceClient,
  resolveVisitorReleaseScope,
  createVisitorReleaseRepository,
  createPrivateStorageAdapter,
} = vi.hoisted(() => ({
  parseRouteId: vi.fn((value: string) => value),
  readVisitorSessionToken: vi.fn().mockReturnValue(null),
  getSupabasePrivilegedConfig: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  resolveVisitorReleaseScope: vi.fn(),
  createVisitorReleaseRepository: vi.fn(),
  createPrivateStorageAdapter: vi.fn(),
}));

vi.mock("@/server/api/context", () => ({ parseRouteId }));
vi.mock("@/server/access/visitor-cookie", () => ({ readVisitorSessionToken }));
vi.mock("@/server/auth/service-client", () => ({ getSupabasePrivilegedConfig, createSupabaseServiceClient }));
vi.mock("@/server/data/tokens", () => ({ resolveVisitorReleaseScope }));
vi.mock("@/server/data/visitor", () => ({ createVisitorReleaseRepository }));
vi.mock("@/server/data/storage", () => ({ createPrivateStorageAdapter }));

import { POST } from "@/app/api/releases/[releaseId]/photos/route";

const releaseId = "10000000-0000-4000-8000-000000000001";
const sessionId = "10000000-0000-4000-8000-000000000002";
const assetId = "10000000-0000-4000-8000-000000000003";
const idempotencyKey = "visitor-photo-upload-key-01";

function request(body: unknown, options: { cookie?: string; idempotencyKey?: string } = {}) {
  return new Request(`https://skunkworks.example/api/releases/${releaseId}/photos`, {
    method: "POST",
    headers: {
      origin: "https://skunkworks.example",
      "content-type": "application/json",
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

const body = { filename: "bend-detail.webp", mimeType: "image/webp", byteSize: 512 };
const asset = {
  id: assetId,
  jobId: "10000000-0000-4000-8000-000000000004",
  releaseId,
  kind: "issue_photo",
  filename: body.filename,
  mimeType: body.mimeType,
  byteSize: body.byteSize,
  sha256: null,
  version: 1,
  status: "pending",
  drawingRevision: null,
};
const preparation = {
  assetId,
  upload: {
    url: "https://storage.example/upload/signed-token",
    method: "PUT",
    headers: { "content-type": body.mimeType },
    expiresAt: "2026-09-26T12:00:00.000Z",
  },
};
const uploadRequired = { state: "upload_required", preparation } as const;

describe("visitor release photo preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readVisitorSessionToken.mockReturnValue(null);
    getSupabasePrivilegedConfig.mockReturnValue({ url: "https://supabase.example", publishableKey: "publishable" });
    createSupabaseServiceClient.mockReturnValue({});
  });

  it("requires a visitor session and idempotency key before persistence", async () => {
    const response = await POST(request(body, { idempotencyKey }), {
      params: Promise.resolve({ releaseId }),
    });
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "RELEASE_REVOKED" } });
    expect(resolveVisitorReleaseScope).not.toHaveBeenCalled();

    readVisitorSessionToken.mockReturnValue("opaque-visitor-session-token");
    const missingKeyResponse = await POST(request(body), { params: Promise.resolve({ releaseId }) });
    expect(missingKeyResponse.status).toBe(400);
    expect(resolveVisitorReleaseScope).not.toHaveBeenCalled();
  });

  it("prepares a photo only for the exact live release with the header key", async () => {
    const sessionToken = "opaque-visitor-session-token";
    readVisitorSessionToken.mockReturnValue(sessionToken);
    resolveVisitorReleaseScope.mockResolvedValue({ sessionId, releaseId });
    const repository = { preparePhoto: vi.fn().mockResolvedValue(asset) };
    createVisitorReleaseRepository.mockReturnValue(repository);
    const storage = { resumeVisitorPhotoUpload: vi.fn().mockResolvedValue(uploadRequired) };
    createPrivateStorageAdapter.mockReturnValue(storage);

    const response = await POST(request(body, { cookie: `skw_visitor_session=${sessionToken}`, idempotencyKey }), {
      params: Promise.resolve({ releaseId }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: uploadRequired, meta: { contractVersion: "1.0" } });
    expect(resolveVisitorReleaseScope).toHaveBeenCalledWith({
      serviceClient: expect.any(Object),
      sessionToken,
      releaseId,
    });
    expect(createVisitorReleaseRepository).toHaveBeenCalledWith({
      serviceClient: expect.any(Object),
      sessionId,
      releaseId,
    });
    expect(repository.preparePhoto).toHaveBeenCalledWith({ ...body, idempotencyKey });
    expect(storage.resumeVisitorPhotoUpload).toHaveBeenCalledWith({ sessionToken, releaseId, assetId });
  });

  it("rejects an asset or signed preparation outside the requested release flow", async () => {
    readVisitorSessionToken.mockReturnValue("opaque-visitor-session-token");
    resolveVisitorReleaseScope.mockResolvedValue({ sessionId, releaseId });
    createVisitorReleaseRepository.mockReturnValue({
      preparePhoto: vi.fn().mockResolvedValue({ ...asset, releaseId: "10000000-0000-4000-8000-000000000099" }),
    });
    const storage = { resumeVisitorPhotoUpload: vi.fn() };
    createPrivateStorageAdapter.mockReturnValue(storage);

    const response = await POST(request(body, { idempotencyKey }), { params: Promise.resolve({ releaseId }) });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INTERNAL_ERROR" } });
    expect(storage.resumeVisitorPhotoUpload).not.toHaveBeenCalled();
  });

  it("returns the ready asset on an idempotent replay after upload completion", async () => {
    readVisitorSessionToken.mockReturnValue("opaque-visitor-session-token");
    resolveVisitorReleaseScope.mockResolvedValue({ sessionId, releaseId });
    const readyAsset = { ...asset, sha256: "a".repeat(64), status: "ready" };
    createVisitorReleaseRepository.mockReturnValue({ preparePhoto: vi.fn().mockResolvedValue(readyAsset) });
    const storage = { resumeVisitorPhotoUpload: vi.fn().mockResolvedValue({ state: "ready", asset: readyAsset }) };
    createPrivateStorageAdapter.mockReturnValue(storage);

    const response = await POST(request(body, { idempotencyKey }), { params: Promise.resolve({ releaseId }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { state: "ready", asset: readyAsset } });
    expect(storage.resumeVisitorPhotoUpload).toHaveBeenCalledWith({
      sessionToken: "opaque-visitor-session-token",
      releaseId,
      assetId,
    });
  });
});
