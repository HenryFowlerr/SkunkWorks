import "server-only";

import { ApiFault } from "@/server/http/api";

export const FLOOR_AI_ACTIONS = ["question", "engineer_report"] as const;
export type FloorAiAction = (typeof FLOOR_AI_ACTIONS)[number];

type Environment = Record<string, string | undefined>;

const DEFAULT_MAX_REQUESTS_PER_WINDOW = 5;
const MAX_REQUESTS_PER_WINDOW = 10;
const DEFAULT_REQUEST_WINDOW_MS = 10 * 60_000;
const MIN_REQUEST_WINDOW_MS = 60_000;
const MAX_REQUEST_WINDOW_MS = 60 * 60_000;

export type FloorGuardrailConfig = {
  maxRequestsPerWindow: number;
  requestWindowMs: number;
};

/**
 * Read non-secret limits for live Luna calls. Invalid or overly broad values
 * fall back to conservative defaults, so a deployment setting cannot remove
 * the budget guard by accident.
 */
export function readFloorGuardrailConfig(environment: Environment = process.env): FloorGuardrailConfig {
  return {
    maxRequestsPerWindow: readBoundedInteger(
      environment.FLOOR_AI_MAX_REQUESTS_PER_WINDOW,
      DEFAULT_MAX_REQUESTS_PER_WINDOW,
      1,
      MAX_REQUESTS_PER_WINDOW,
    ),
    requestWindowMs: readBoundedInteger(
      environment.FLOOR_AI_REQUEST_WINDOW_MS,
      DEFAULT_REQUEST_WINDOW_MS,
      MIN_REQUEST_WINDOW_MS,
      MAX_REQUEST_WINDOW_MS,
    ),
  };
}

export type FloorRateLimitKey = {
  actorId: string;
  jobId: string;
  action: FloorAiAction;
};

export type FloorRateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number };

type Bucket = { timestamps: number[] };

/**
 * Process-local quota keyed only from authenticated server identity and the
 * resolved job. A horizontally scaled production deployment must replace this
 * with a shared atomic limiter.
 */
export class FloorRequestLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly config: FloorGuardrailConfig) {}

  consume(key: FloorRateLimitKey, now = Date.now()): FloorRateLimitResult {
    this.prune(now);
    const bucketKey = stableBucketKey(key);
    const timestamps = (this.buckets.get(bucketKey)?.timestamps ?? [])
      .filter((timestamp) => timestamp > now - this.config.requestWindowMs);

    if (timestamps.length >= this.config.maxRequestsPerWindow) {
      this.buckets.set(bucketKey, { timestamps });
      return { allowed: false, retryAfterMs: Math.max(1, timestamps[0] + this.config.requestWindowMs - now) };
    }

    timestamps.push(now);
    this.buckets.set(bucketKey, { timestamps });
    return { allowed: true, remaining: this.config.maxRequestsPerWindow - timestamps.length };
  }

  /** Cheap preflight before private PDF/source reads; it does not reserve a call. */
  available(key: FloorRateLimitKey, now = Date.now()): FloorRateLimitResult {
    this.prune(now);
    const timestamps = (this.buckets.get(stableBucketKey(key))?.timestamps ?? [])
      .filter((timestamp) => timestamp > now - this.config.requestWindowMs);
    if (timestamps.length >= this.config.maxRequestsPerWindow) {
      return { allowed: false, retryAfterMs: Math.max(1, timestamps[0] + this.config.requestWindowMs - now) };
    }
    return { allowed: true, remaining: this.config.maxRequestsPerWindow - timestamps.length };
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      const timestamps = bucket.timestamps.filter((timestamp) => timestamp > now - this.config.requestWindowMs);
      if (timestamps.length) this.buckets.set(key, { timestamps });
      else this.buckets.delete(key);
    }
  }
}

const processConfig = readFloorGuardrailConfig();
const processLimiter = new FloorRequestLimiter(processConfig);

/** Reject an exhausted actor/job/action bucket before loading private evidence. */
export function assertFloorRequestQuotaAvailable(input: FloorRateLimitKey): void {
  assertQuotaResult(processLimiter.available(input));
}

/** Reserve a bounded Luna request immediately before the adapter is invoked. */
export function consumeFloorRequestQuota(input: FloorRateLimitKey): void {
  assertQuotaResult(processLimiter.consume(input));
}

function assertQuotaResult(result: FloorRateLimitResult): void {
  if (result.allowed) return;
  const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1_000));
  throw new ApiFault(
    "RATE_LIMITED",
    `Luna requests for this part and action are limited to ${readableCountWindow(processConfig)}. Try again in about ${readableDuration(retryAfterSeconds)}.`,
    { retryable: true, retryAfterSeconds },
  );
}

function readBoundedInteger(raw: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function stableBucketKey(input: FloorRateLimitKey): string {
  return JSON.stringify([input.actorId, input.jobId, input.action]);
}

function readableCountWindow(config: FloorGuardrailConfig): string {
  return `${config.maxRequestsPerWindow} ${config.maxRequestsPerWindow === 1 ? "request" : "requests"} per ${readableDuration(Math.ceil(config.requestWindowMs / 1_000))}`;
}

function readableDuration(seconds: number): string {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}
