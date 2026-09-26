import { describe, expect, it, vi } from "vitest";
import {
  api,
  createFetchApiTransport,
  createApiClient,
  unavailableApiTransport,
  type ApiTransport,
  type ApiTransportRequest,
} from "@/lib/api/client";
import { ids, openFlag, releaseView, sourceAsset } from "./fixtures";
import { SOURCE_UPLOAD_LIMIT_BYTES, UploadAssetPreparationBodySchema } from "@/contracts";

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
  it("enforces provisional source upload limits at the shared request schema", () => {
    const cases = [
      { kind: "drawing_pdf" as const, filename: "part.pdf", mimeType: "application/pdf" },
      { kind: "model_glb" as const, filename: "part.glb", mimeType: "model/gltf-binary" },
      { kind: "bend_manifest" as const, filename: "part.json", mimeType: "application/json" },
    ];

    for (const item of cases) {
      const limit = SOURCE_UPLOAD_LIMIT_BYTES[item.kind];
      expect(UploadAssetPreparationBodySchema.safeParse({ ...item, byteSize: limit }).success).toBe(true);
      expect(UploadAssetPreparationBodySchema.safeParse({ ...item, byteSize: limit + 1 }).success).toBe(false);
    }
    expect(UploadAssetPreparationBodySchema.safeParse({
      kind: "drawing_pdf",
      filename: "empty.pdf",
      mimeType: "application/pdf",
      byteSize: 0,
    }).success).toBe(false);
    expect(SOURCE_UPLOAD_LIMIT_BYTES).toEqual({
      drawing_pdf: 25 * 1024 * 1024,
      model_glb: 50 * 1024 * 1024,
      bend_manifest: 2 * 1024 * 1024,
      native_part: 50 * 1024 * 1024,
      native_drawing: 50 * 1024 * 1024,
    });
  });

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
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const transport = createFetchApiTransport({ fetchImpl });
    const file = new File(["private bytes"], "part.pdf", { type: "application/pdf" });
    const onProgress = vi.fn();

    await transport.upload({
      url: "https://storage.example/signed-upload",
      method: "PUT",
      headers: { "Content-Type": "application/pdf", "x-upsert": "false" },
      file,
      onProgress,
    });

    expect(fetchImpl).toHaveBeenCalledWith("https://storage.example/signed-upload", expect.objectContaining({
      method: "PUT",
      body: expect.any(FormData),
      headers: { "x-upsert": "false" },
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
    await client.questions.ask({ context: openFlag.context, question: "What does B1 mean?" });
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
});
