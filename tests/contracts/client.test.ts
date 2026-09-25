import { describe, expect, it } from "vitest";
import {
  api,
  createApiClient,
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
  it("keeps the default transport explicitly unavailable", async () => {
    await expect(api.releases.get({ releaseId: ids.release })).rejects.toMatchObject({
      name: "ApiClientError",
      code: "ENDPOINT_UNAVAILABLE",
      retryable: false,
    });
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
