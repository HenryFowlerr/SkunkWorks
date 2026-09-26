import { beforeEach, describe, expect, it, vi } from "vitest";
import { ids, job, sourceAsset, workshopSnapshot } from "../../contracts/fixtures";

const mocks = vi.hoisted(() => ({
  getJobApiContext: vi.fn(),
  getJobBundle: vi.fn(),
  getWorkshopSnapshot: vi.fn(),
}));

vi.mock("@/server/api/context", () => ({
  getJobApiContext: mocks.getJobApiContext,
  parseRouteId: (id: string) => id,
}));

import { POST } from "@/app/api/jobs/[id]/facility-check/route";

const requirement = {
  id: "00000000-0000-4000-8000-000000000018",
  kind: "bend_length",
  label: "B3",
  requiredMm: 1200,
  source: { assetId: ids.asset, page: 2, excerpt: "B3 bend length 1200 mm" },
};

function request(overrides: Record<string, unknown> = {}, origin = "https://chappe.example") {
  return new Request("https://chappe.example/api/jobs/" + ids.job + "/facility-check", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ expectedJobVersion: job.version, requirements: [requirement], ...overrides }),
  });
}

const context = { params: Promise.resolve({ id: ids.job }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getJobApiContext.mockResolvedValue({ repository: {
    getJobBundle: mocks.getJobBundle,
    getWorkshopSnapshot: mocks.getWorkshopSnapshot,
  } });
  mocks.getJobBundle.mockResolvedValue({ job, assets: [sourceAsset], draft: null, releases: [] });
  mocks.getWorkshopSnapshot.mockResolvedValue(workshopSnapshot);
});

describe("job facility check route", () => {
  it("compares an attached ready drawing requirement against the selected confirmed machine", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: {
      jobVersion: job.version,
      machineId: ids.machine,
      summary: { conflict: 1, supported: 0, unknown: 0 },
    } });
    expect(mocks.getJobApiContext).toHaveBeenCalledWith(ids.job, ["designer"]);
    expect(mocks.getWorkshopSnapshot).toHaveBeenCalledWith(ids.workshopSnapshot);
  });

  it("rejects stale job inputs before comparing", async () => {
    const response = await POST(request({ expectedJobVersion: job.version + 1 }), context);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("VERSION_CONFLICT");
    expect(mocks.getWorkshopSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a citation to a different or unready asset", async () => {
    const response = await POST(request({ requirements: [{ ...requirement, source: { ...requirement.source, assetId: ids.release } }] }), context);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_FAILED");
    expect(mocks.getWorkshopSnapshot).not.toHaveBeenCalled();

    mocks.getJobBundle.mockResolvedValue({ job, assets: [{ ...sourceAsset, status: "pending" }], draft: null, releases: [] });
    const pending = await POST(request(), context);
    expect(pending.status).toBe(400);
  });

  it("rejects duplicate requirement IDs and cross-origin writes", async () => {
    const duplicate = await POST(request({ requirements: [requirement, requirement] }), context);
    expect(duplicate.status).toBe(400);
    expect(mocks.getJobApiContext).not.toHaveBeenCalled();

    const crossOrigin = await POST(request({}, "https://other.example"), context);
    expect(crossOrigin.status).toBe(403);
    expect(mocks.getJobApiContext).not.toHaveBeenCalled();
  });
});
