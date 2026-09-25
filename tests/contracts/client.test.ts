import { describe, expect, it, vi } from "vitest";
import {
  api,
  ApiClientError,
  createFetchApiTransport,
  createApiClient,
  unavailableApiTransport,
  type ApiTransport,
  type ApiTransportRequest,
} from "@/lib/api/client";
import { ids, openFlag, releaseView, sourceAsset } from "./fixtures";

const meta = { requestId: "contract-test", contractVersion: "1.0" as const };
const success = (data: unknown) => ({ data, meta });

function recordingTransport(responses: unknown[]): {
  transport: ApiTransport;
  requests: ApiTransportRequest[];
  uploads: Array<{ url: string; file: File }>;
} {
  const requests: ApiTransportRequest[] = [];
  const uploads: Array<{ url: string; file: File }> = [];
  return {
    requests,
    uploads,
    transport: {
      async request(request) {
        requests.push(request);
        const response = responses.shift();
        if (response === undefined) throw new Error("No test response configured.");
        return response;
      },
      async upload(request) {
        uploads.push({ url: request.url, file: request.file });
      },
    },
  };
}

describe("typed browser API client", () => {
  it("keeps an explicitly selected unavailable transport honest", async () => {
    await expect(createApiClient(unavailableApiTransport).releases.get({ releaseId: ids.release })).rejects.toMatchObject({
      name: "ApiClientError",
      code: "ENDPOINT_UNAVAILABLE",
      retryable: false,
    });
  });

  it("uses the real same-origin transport by default", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(success(releaseView)), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchImpl);
    try {
      await expect(api.releases.get({ releaseId: ids.release })).resolves.toEqual(releaseView);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchImpl).toHaveBeenCalledWith(`/api/releases/${ids.release}`, expect.any(Object));
  });

  it("uses JSON v1 routes on the same origin with no-store and typed input", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(success(releaseView)), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    const client = createApiClient(createFetchApiTransport({ fetchImpl }));

    await expect(client.releases.get({ releaseId: ids.release })).resolves.toEqual(releaseView);
    expect(fetchImpl).toHaveBeenCalledWith(`/api/releases/${ids.release}`, expect.objectContaining({
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
    }));
  });

  it("reports an unimplemented Next route instead of treating its HTML 404 as data", async () => {
    const fetchImpl = vi.fn(async () => new Response("<!doctype html>", {
      status: 404,
      headers: { "content-type": "text/html" },
    }));
    const client = createApiClient(createFetchApiTransport({ fetchImpl }));

    await expect(client.releases.get({ releaseId: ids.release })).rejects.toMatchObject({
      code: "ENDPOINT_UNAVAILABLE",
      status: 404,
      retryable: false,
    });
  });

  it("uploads only to HTTPS or loopback URLs without forwarding application cookies", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(null, { status: 200 });
    });
    const transport = createFetchApiTransport({
      fetchImpl,
      supabaseUrl: "https://storage.example",
      publishableKey: "public-test-key",
    });
    const file = new File(["private bytes"], "part.pdf", { type: "application/pdf" });
    const onProgress = vi.fn();

    await transport.upload({
      url: "https://storage.example/storage/v1/object/upload/sign/skunkworks-private/a/b?token=signed-token",
      method: "PUT",
      headers: {
        apikey: "public-test-key",
        "x-upsert": "false",
        "Content-Type": "application/pdf",
      },
      file,
      onProgress,
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://storage.example/storage/v1/object/upload/sign/skunkworks-private/a/b?token=signed-token", expect.objectContaining({
      method: "PUT",
      body: expect.any(FormData),
      headers: { apikey: "public-test-key", "x-upsert": "false" },
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    }));
    const sentBody = fetchImpl.mock.calls[0]?.[1]?.body;
    expect(sentBody).toBeInstanceOf(FormData);
    expect((sentBody as FormData).get("cacheControl")).toBe("3600");
    expect((sentBody as FormData).get("")).toMatchObject({ name: "part.pdf", type: "application/pdf" });
    expect(onProgress).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith(1);
    await expect(transport.upload({
      url: "http://storage.example/signed-upload",
      method: "PUT",
      headers: {},
      file,
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(transport.upload({
      url: "https://attacker.example/storage/v1/object/upload/sign/skunkworks-private/a/b?token=signed-token",
      method: "PUT",
      headers: { apikey: "public-test-key", "x-upsert": "false" },
      file,
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(transport.upload({
      url: "https://storage.example/storage/v1/object/upload/sign/skunkworks-private/a/b?token=signed-token",
      method: "PUT",
      headers: { apikey: "public-test-key", Authorization: "Bearer secret", "x-upsert": "false" },
      file,
    })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("validates v1.0 response envelopes and surfaces typed wire errors", async () => {
    const malformed = recordingTransport([{ data: { url: "not-a-url", expiresAt: "tomorrow" }, meta }]);
    await expect(createApiClient(malformed.transport).assets.getLink({ assetId: ids.asset })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });

    const wireError = recordingTransport([{
      error: { code: "VERSION_CONFLICT", message: "Reload the draft.", retryable: false },
      meta,
    }]);
    await expect(createApiClient(wireError.transport).releases.get({ releaseId: ids.release })).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      retryable: false,
    });
  });

  it("exposes the shared floor methods with release and asset-scoped routes", async () => {
    const answer = {
      id: ids.step,
      context: {
        jobId: ids.job,
        releaseId: ids.release,
        draftId: null,
        draftVersion: null,
        stepId: ids.step,
        bendId: "B1",
      },
      evidenceState: "not_found",
      text: "The source packet does not establish that value.",
      evidence: [],
      suggestedFlag: null,
    };
    const recording = recordingTransport([
      success(releaseView),
      success({ url: "https://storage.example/asset", expiresAt: "2026-09-26T12:00:00.000Z" }),
      success(answer),
      success([openFlag]),
      success(openFlag),
      success(openFlag),
    ]);
    const client = createApiClient(recording.transport);

    await client.releases.get({ releaseId: ids.release });
    await client.assets.getLink({ assetId: ids.asset });
    await client.questions.ask({
      context: openFlag.context,
      question: "What does B1 mean?",
      idempotencyKey: "question-contract-key-0001",
    });
    await client.flags.list({ releaseId: ids.release });
    await client.flags.create({
      context: openFlag.context,
      question: "Please confirm this bend.",
      photoAssetIds: [],
      idempotencyKey: "floor-flag-test-key-0001",
    });
    await client.flags.acknowledge({ flagId: ids.flag, expectedVersion: 1 });

    expect(recording.requests.map(({ method, path }) => [method, path])).toEqual([
      ["GET", `/api/releases/${ids.release}`],
      ["GET", `/api/assets/${ids.asset}/link`],
      ["POST", "/api/questions"],
      ["GET", `/api/flags?releaseId=${ids.release}`],
      ["POST", "/api/flags"],
      ["POST", `/api/flags/${ids.flag}/acknowledge`],
    ]);
    expect(recording.requests[4].headers).toEqual({ "Idempotency-Key": "floor-flag-test-key-0001" });
    expect(recording.requests[4].body).not.toHaveProperty("idempotencyKey");
    expect(recording.requests[2].headers).toEqual({ "Idempotency-Key": "question-contract-key-0001" });
    expect(recording.requests[2].body).not.toHaveProperty("idempotencyKey");
  });

  it("uploads privately between preparation and server verification", async () => {
    const prepared = {
      assetId: ids.asset,
      upload: {
        url: "https://storage.example/private-upload",
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        expiresAt: "2026-09-26T12:00:00.000Z",
      },
    };
    const recording = recordingTransport([success(prepared), success(sourceAsset)]);
    const client = createApiClient(recording.transport);
    const file = new File(["verified drawing bytes"], "part.pdf", { type: "application/pdf" });

    await expect(client.assets.uploadAsset({
      jobId: ids.job,
      kind: "drawing_pdf",
      file,
      idempotencyKey: "upload-contract-test-key-01",
    })).resolves.toEqual(sourceAsset);

    expect(recording.requests.map(({ path }) => path)).toEqual([
      `/api/jobs/${ids.job}/assets`,
      `/api/assets/${ids.asset}/complete`,
    ]);
    expect(recording.requests[0].headers).toEqual({ "Idempotency-Key": "upload-contract-test-key-01" });
    expect(recording.uploads).toEqual([{ url: prepared.upload.url, file }]);
  });

  it("uploads a release photo from a resumable preparation", async () => {
    const prepared = {
      assetId: ids.asset,
      upload: {
        url: "https://storage.example/private-photo-upload",
        method: "PUT" as const,
        headers: { "Content-Type": "image/jpeg" },
        expiresAt: "2026-09-26T12:00:00.000Z",
      },
    };
    const photo = {
      ...sourceAsset,
      kind: "issue_photo" as const,
      filename: "bend.jpg",
      mimeType: "image/jpeg",
      releaseId: ids.release,
    };
    const recording = recordingTransport([
      success({ state: "upload_required", preparation: prepared }),
      success(photo),
    ]);
    const client = createApiClient(recording.transport);
    const file = new File(["photo bytes"], "bend.jpg", { type: "image/jpeg" });

    await expect(client.assets.uploadReleasePhoto({
      releaseId: ids.release,
      file,
      idempotencyKey: "release-photo-test-key-0001",
    })).resolves.toEqual(photo);

    expect(recording.requests.map(({ path }) => path)).toEqual([
      `/api/releases/${ids.release}/photos`,
      `/api/assets/${ids.asset}/complete`,
    ]);
    expect(recording.uploads).toEqual([{ url: prepared.upload.url, file }]);
  });

  it("returns an already completed release photo on an idempotent retry", async () => {
    const photo = {
      ...sourceAsset,
      kind: "issue_photo" as const,
      filename: "bend.jpg",
      mimeType: "image/jpeg",
      releaseId: ids.release,
    };
    const recording = recordingTransport([success({ state: "ready", asset: photo })]);
    const client = createApiClient(recording.transport);

    await expect(client.assets.uploadReleasePhoto({
      releaseId: ids.release,
      file: new File(["photo bytes"], "bend.jpg", { type: "image/jpeg" }),
      idempotencyKey: "release-photo-replay-0001",
    })).resolves.toEqual(photo);

    expect(recording.uploads).toEqual([]);
    expect(recording.requests).toHaveLength(1);
  });

  it("finalizes the prepared asset after an ambiguous upload failure", async () => {
    const prepared = {
      assetId: ids.asset,
      upload: {
        url: "https://storage.example/private-upload",
        method: "PUT" as const,
        headers: { "Content-Type": "application/pdf" },
        expiresAt: "2026-09-26T12:00:00.000Z",
      },
    };
    const requests: ApiTransportRequest[] = [];
    const client = createApiClient({
      async request(request) {
        requests.push(request);
        return requests.length === 1 ? success(prepared) : success(sourceAsset);
      },
      async upload() {
        throw new ApiClientError({
          code: "ENDPOINT_UNAVAILABLE",
          message: "The storage response was lost after the object was written.",
          retryable: true,
        });
      },
    });

    await expect(client.assets.uploadAsset({
      jobId: ids.job,
      kind: "drawing_pdf",
      file: new File(["verified drawing bytes"], "part.pdf", { type: "application/pdf" }),
      idempotencyKey: "upload-ambiguous-retry-0001",
    })).resolves.toEqual(sourceAsset);
    expect(requests.map(({ method, path }) => [method, path])).toEqual([
      ["POST", `/api/jobs/${ids.job}/assets`],
      ["POST", `/api/assets/${ids.asset}/complete`],
    ]);
  });

  it("recovers an interrupted upload by obtaining fresh signed instructions", async () => {
    const initialPreparation = {
      assetId: ids.asset,
      upload: {
        url: "https://storage.example/private-upload?token=initial",
        method: "PUT" as const,
        headers: { "Content-Type": "application/pdf" },
        expiresAt: "2026-09-26T12:00:00.000Z",
      },
    };
    const resumedPreparation = {
      assetId: ids.asset,
      upload: {
        url: "https://storage.example/private-upload?token=renewed",
        method: "PUT" as const,
        headers: { "Content-Type": "application/pdf" },
        expiresAt: "2026-09-26T12:05:00.000Z",
      },
    };
    const requests: ApiTransportRequest[] = [];
    const uploads: string[] = [];
    const responses = [
      success(initialPreparation),
      {
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: "The uploaded object is not visible yet.",
          retryable: true,
        },
        meta,
      },
      success({ state: "upload_required", preparation: resumedPreparation }),
      success(sourceAsset),
    ];
    const client = createApiClient({
      async request(request) {
        requests.push(request);
        const response = responses.shift();
        if (response === undefined) throw new Error("No test response configured.");
        return response;
      },
      async upload(request) {
        uploads.push(request.url);
        if (uploads.length === 1) {
          throw new ApiClientError({
            code: "ENDPOINT_UNAVAILABLE",
            message: "The first storage transfer was interrupted.",
            retryable: true,
          });
        }
      },
    });

    await expect(client.assets.uploadAsset({
      jobId: ids.job,
      kind: "drawing_pdf",
      file: new File(["verified drawing bytes"], "part.pdf", { type: "application/pdf" }),
      idempotencyKey: "upload-interrupted-retry-01",
    })).resolves.toEqual(sourceAsset);

    expect(requests.map(({ method, path }) => [method, path])).toEqual([
      ["POST", `/api/jobs/${ids.job}/assets`],
      ["POST", `/api/assets/${ids.asset}/complete`],
      ["POST", `/api/assets/${ids.asset}/resume`],
      ["POST", `/api/assets/${ids.asset}/complete`],
    ]);
    expect(uploads).toEqual([
      initialPreparation.upload.url,
      resumedPreparation.upload.url,
    ]);
  });
});
