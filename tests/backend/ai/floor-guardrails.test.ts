import { describe, expect, it } from "vitest";
import { FloorRequestLimiter, readFloorGuardrailConfig } from "@/server/ai/floor-guardrails";

const key = {
  actorId: "f0a7e622-c0e0-4d6e-a9bb-1b86e991d0fd",
  jobId: "f0a7e622-c0e0-4d6e-a9bb-1b86e991d0fe",
  action: "question" as const,
};

describe("floor Luna guardrails", () => {
  it("uses conservative defaults and ignores values above its hard bounds", () => {
    expect(readFloorGuardrailConfig({})).toEqual({
      maxRequestsPerWindow: 5,
      requestWindowMs: 600_000,
    });
    expect(readFloorGuardrailConfig({
      FLOOR_AI_MAX_REQUESTS_PER_WINDOW: "10",
      FLOOR_AI_REQUEST_WINDOW_MS: "60000",
    })).toEqual({ maxRequestsPerWindow: 10, requestWindowMs: 60_000 });
    expect(readFloorGuardrailConfig({
      FLOOR_AI_MAX_REQUESTS_PER_WINDOW: "11",
      FLOOR_AI_REQUEST_WINDOW_MS: "3600001",
    })).toEqual({ maxRequestsPerWindow: 5, requestWindowMs: 600_000 });
  });

  it("limits each authenticated actor, resolved part, and Luna action independently", () => {
    const limiter = new FloorRequestLimiter({ maxRequestsPerWindow: 2, requestWindowMs: 60_000 });

    expect(limiter.consume(key, 1_000)).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.consume(key, 2_000)).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.available(key, 10_000)).toEqual({ allowed: false, retryAfterMs: 51_000 });
    expect(limiter.consume(key, 10_000)).toEqual({ allowed: false, retryAfterMs: 51_000 });
    expect(limiter.consume({ ...key, action: "engineer_report" }, 10_000)).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.consume({ ...key, actorId: "f0a7e622-c0e0-4d6e-a9bb-1b86e991d0ff" }, 10_000)).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.consume({ ...key, jobId: "f0a7e622-c0e0-4d6e-a9bb-1b86e991d100" }, 10_000)).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.consume(key, 61_001)).toEqual({ allowed: true, remaining: 0 });
  });

  it("does not consume a request while it only checks availability", () => {
    const limiter = new FloorRequestLimiter({ maxRequestsPerWindow: 1, requestWindowMs: 60_000 });
    expect(limiter.available(key, 1_000)).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.consume(key, 1_000)).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.available(key, 2_000)).toEqual({ allowed: false, retryAfterMs: 59_000 });
  });
});
