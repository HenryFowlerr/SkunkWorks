import { beforeEach, describe, expect, it, vi } from "vitest";
import { draft, draftContentInput, ids, release } from "../../contracts/fixtures";

const mocks = vi.hoisted(() => ({
  getJobApiContext: vi.fn(),
  claimIdempotency: vi.fn(),
  publishRelease: vi.fn(),
  getRelease: vi.fn(),
  saveDraft: vi.fn(),
  recordDraftReview: vi.fn(),
}));

vi.mock("@/server/api/context", () => ({
  getJobApiContext: mocks.getJobApiContext,
  parseRouteId: (value: string) => value,
}));

import { PUT as saveDraft } from "@/app/api/jobs/[id]/draft/route";
import { POST as reviewDraft } from "@/app/api/jobs/[id]/draft/reviews/route";
import { POST as publishDraft } from "@/app/api/jobs/[id]/publish/route";

const context = { params: Promise.resolve({ id: ids.job }) };
const baseUrl = `https://chappe.example/api/jobs/${ids.job}`;

function bodyRequest(path: string, method: "PUT" | "POST", body: unknown, idempotencyKey?: string): Request {
  return new Request(`${baseUrl}${path}`, {
    method,
    headers: {
      origin: "https://chappe.example",
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getJobApiContext.mockResolvedValue({ repository: mocks });
});

describe("engineer draft and release routes", () => {
  it("saves only a current, typed draft edit through the scoped repository", async () => {
    mocks.saveDraft.mockResolvedValue(draft);
    const response = await saveDraft(bodyRequest("/draft", "PUT", {
      expectedVersion: draft.version,
      content: draftContentInput,
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.getJobApiContext).toHaveBeenCalledWith(ids.job, ["designer"]);
    expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ jobId: ids.job, expectedVersion: draft.version }));
  });

  it("records the requested design review against the current draft version", async () => {
    mocks.recordDraftReview.mockResolvedValue(draft);
    const response = await reviewDraft(bodyRequest("/draft/reviews", "POST", {
      expectedVersion: draft.version,
      kind: "design",
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.getJobApiContext).toHaveBeenCalledWith(ids.job, ["designer"]);
    expect(mocks.recordDraftReview).toHaveBeenCalledWith({ jobId: ids.job, expectedVersion: draft.version, kind: "design" });
  });

  it("replays publication from the stored release ID without publishing again", async () => {
    mocks.claimIdempotency.mockResolvedValue({ state: "completed", response: { releaseId: release.id }, resourceId: release.id });
    mocks.getRelease.mockResolvedValue(release);
    const response = await publishDraft(bodyRequest("/publish", "POST", {
      expectedDraftVersion: draft.version,
      supersedesReleaseId: null,
      allowPredecessorVisitors: false,
    }, "publish-demo-0001"), context);
    expect(response.status).toBe(201);
    expect(mocks.getRelease).toHaveBeenCalledWith(release.id);
    expect(mocks.publishRelease).not.toHaveBeenCalled();
  });
});
