import { describe, expect, it } from "vitest";
import type { FlagReplySuggestion } from "@/contracts/ai";
import { FloorReportCache } from "@/server/ai/floor-report-cache";

const report = {} as FlagReplySuggestion;
const key = {
  jobId: "f0a7e622-c0e0-4d6e-a9bb-1b86e991d0fd",
  flagId: "f0a7e622-c0e0-4d6e-a9bb-1b86e991d0fe",
  flagVersion: 1,
};

describe("floor report cache", () => {
  it("single-flights an automatic report for one exact floor flag version", async () => {
    const cache = new FloorReportCache();
    let calls = 0;
    const create = async () => {
      calls += 1;
      return report;
    };

    const first = cache.getOrCreate(key, create, 100);
    const second = cache.getOrCreate(key, create, 100);
    await expect(Promise.all([first, second])).resolves.toEqual([report, report]);
    expect(calls).toBe(1);
  });

  it("does not reuse an earlier report after the flag changes", async () => {
    const cache = new FloorReportCache();
    let calls = 0;
    const create = async () => {
      calls += 1;
      return report;
    };

    await cache.getOrCreate(key, create, 100);
    await cache.getOrCreate({ ...key, flagVersion: 2 }, create, 100);
    expect(calls).toBe(2);
  });
});
