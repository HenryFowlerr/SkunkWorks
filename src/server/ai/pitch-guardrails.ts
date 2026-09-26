import "server-only";

import { ApiFault } from "@/server/http/api";
import type { PitchCapabilityCheck, PitchKnowledgeBase } from "./pitch";

export const PITCH_ACTIONS = ["capability", "knowledge_base", "triage", "preview_question"] as const;
export type PitchAction = (typeof PITCH_ACTIONS)[number];

type Environment = Record<string, string | undefined>;

const DEFAULT_MAX_REQUESTS_PER_WINDOW = 2;
const MAX_MAX_REQUESTS_PER_WINDOW = 3;
const DEFAULT_REQUEST_WINDOW_MS = 10 * 60_000;
const MIN_REQUEST_WINDOW_MS = 60_000;
const MAX_REQUEST_WINDOW_MS = 60 * 60_000;

const OUTPUT_TOKEN_LIMITS = {
  capability: {
    variable: "PITCH_AI_CAPABILITY_MAX_OUTPUT_TOKENS",
    defaultValue: 1_200,
    minimum: 256,
    maximum: 1_600,
  },
  knowledge_base: {
    variable: "PITCH_AI_KNOWLEDGE_BASE_MAX_OUTPUT_TOKENS",
    defaultValue: 1_800,
    minimum: 512,
    maximum: 2_400,
  },
  triage: {
    variable: "PITCH_AI_TRIAGE_MAX_OUTPUT_TOKENS",
    defaultValue: 900,
    minimum: 256,
    maximum: 1_200,
  },
  preview_question: {
    variable: "PITCH_AI_PREVIEW_QUESTION_MAX_OUTPUT_TOKENS",
    defaultValue: 750,
    minimum: 256,
    maximum: 1_000,
  },
} as const satisfies Record<PitchAction, {
  variable: string;
  defaultValue: number;
  minimum: number;
  maximum: number;
}>;

export type PitchGuardrailConfig = {
  maxRequestsPerWindow: number;
  requestWindowMs: number;
  maxOutputTokens: Record<PitchAction, number>;
};

/**
 * Reads only non-secret pitch safety settings. Invalid values fail closed to
 * conservative defaults; no setting can expand a bounded output above the
 * hard ceiling in this module.
 */
export function readPitchGuardrailConfig(environment: Environment = process.env): PitchGuardrailConfig {
  return {
    maxRequestsPerWindow: readBoundedInteger(
      environment.PITCH_AI_MAX_REQUESTS_PER_WINDOW,
      DEFAULT_MAX_REQUESTS_PER_WINDOW,
      1,
      MAX_MAX_REQUESTS_PER_WINDOW,
    ),
    requestWindowMs: readBoundedInteger(
      environment.PITCH_AI_REQUEST_WINDOW_MS,
      DEFAULT_REQUEST_WINDOW_MS,
      MIN_REQUEST_WINDOW_MS,
      MAX_REQUEST_WINDOW_MS,
    ),
    maxOutputTokens: {
      capability: readOutputTokenLimit("capability", environment),
      knowledge_base: readOutputTokenLimit("knowledge_base", environment),
      triage: readOutputTokenLimit("triage", environment),
      preview_question: readOutputTokenLimit("preview_question", environment),
    },
  };
}

export function pitchOutputTokenLimit(action: PitchAction, environment: Environment = process.env): number {
  return readPitchGuardrailConfig(environment).maxOutputTokens[action];
}

export type PitchRateLimitKey = {
  actorId: string;
  jobId: string;
  action: PitchAction;
};

export type PitchRateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number };

type Bucket = { timestamps: number[] };

/**
 * Process-local guard for the short pitch demo. It deliberately uses
 * authenticated server values, never an IP address or a browser-provided key.
 * A production multi-instance deployment needs a shared limiter instead.
 */
export class PitchRequestLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly config: Pick<PitchGuardrailConfig, "maxRequestsPerWindow" | "requestWindowMs">) {}

  consume(key: PitchRateLimitKey, now = Date.now()): PitchRateLimitResult {
    this.prune(now);
    const bucketKey = stableBucketKey(key);
    const previous = this.buckets.get(bucketKey);
    const timestamps = (previous?.timestamps ?? []).filter((timestamp) => timestamp > now - this.config.requestWindowMs);

    if (timestamps.length >= this.config.maxRequestsPerWindow) {
      const retryAfterMs = Math.max(1, timestamps[0] + this.config.requestWindowMs - now);
      this.buckets.set(bucketKey, { timestamps });
      return { allowed: false, retryAfterMs };
    }

    timestamps.push(now);
    this.buckets.set(bucketKey, { timestamps });
    return { allowed: true, remaining: this.config.maxRequestsPerWindow - timestamps.length };
  }

  /** Checks a bucket before expensive private-source work without consuming it. */
  available(key: PitchRateLimitKey, now = Date.now()): PitchRateLimitResult {
    this.prune(now);
    const bucketKey = stableBucketKey(key);
    const previous = this.buckets.get(bucketKey);
    const timestamps = (previous?.timestamps ?? []).filter((timestamp) => timestamp > now - this.config.requestWindowMs);
    if (timestamps.length >= this.config.maxRequestsPerWindow) {
      return { allowed: false, retryAfterMs: Math.max(1, timestamps[0] + this.config.requestWindowMs - now) };
    }
    return { allowed: true, remaining: this.config.maxRequestsPerWindow - timestamps.length };
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      const timestamps = bucket.timestamps.filter((timestamp) => timestamp > now - this.config.requestWindowMs);
      if (timestamps.length === 0) this.buckets.delete(key);
      else this.buckets.set(key, { timestamps });
    }
  }
}

type CapabilityCacheKey = {
  actorId: string;
  jobId: string;
  jobVersion: number;
  inputFingerprint: string;
};

type CachedCapability = {
  capability: PitchCapabilityCheck;
  expiresAt: number;
};

type CachedKnowledgeBase = {
  promise: Promise<PitchKnowledgeBase>;
  expiresAt: number;
};

/**
 * Holds a verified capability result long enough for the next local pitch
 * click. It is process memory only: a restart simply asks the engineer to run
 * the capability check again. This avoids accepting capability content from a
 * browser while keeping the knowledge-base click to one provider call.
 */
export class PitchCapabilityCache {
  private readonly entries = new Map<string, CachedCapability>();

  constructor(private readonly ttlMs: number) {}

  put(key: CapabilityCacheKey, capability: PitchCapabilityCheck, now = Date.now()): void {
    this.prune(now);
    this.entries.set(stableCapabilityCacheKey(key), { capability, expiresAt: now + this.ttlMs });
  }

  get(key: CapabilityCacheKey, now = Date.now()): PitchCapabilityCheck | null {
    this.prune(now);
    return this.entries.get(stableCapabilityCacheKey(key))?.capability ?? null;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

/**
 * Shares one in-flight knowledge-base provider call for an exact verified
 * capability key, then keeps the result only for the local demo window.
 */
export class PitchKnowledgeBaseCache {
  private readonly entries = new Map<string, CachedKnowledgeBase>();

  constructor(private readonly ttlMs: number) {}

  getOrCreate(
    key: CapabilityCacheKey,
    create: () => Promise<PitchKnowledgeBase>,
    now = Date.now(),
  ): Promise<PitchKnowledgeBase> {
    this.prune(now);
    const cacheKey = stableCapabilityCacheKey(key);
    const existing = this.entries.get(cacheKey);
    if (existing) return existing.promise;

    // Register the promise before invoking the factory, so another request in
    // this process joins it rather than starting a duplicate model call.
    const promise = Promise.resolve().then(create);
    const entry: CachedKnowledgeBase = { promise, expiresAt: now + this.ttlMs };
    this.entries.set(cacheKey, entry);
    void promise.catch(() => {
      if (this.entries.get(cacheKey) === entry) this.entries.delete(cacheKey);
    });
    return promise;
  }

  /**
   * Returns only the server-held draft for the same authenticated cache key.
   * The promise is intentionally shared with creation so a preview can never
   * substitute browser-provided knowledge-base content while a draft is still
   * finishing.
   */
  get(key: CapabilityCacheKey, now = Date.now()): Promise<PitchKnowledgeBase> | null {
    this.prune(now);
    return this.entries.get(stableCapabilityCacheKey(key))?.promise ?? null;
  }

  clear(key: CapabilityCacheKey): void {
    this.entries.delete(stableCapabilityCacheKey(key));
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

const processConfig = readPitchGuardrailConfig();
const processLimiter = new PitchRequestLimiter(processConfig);
const processCapabilityCache = new PitchCapabilityCache(processConfig.requestWindowMs);
const processKnowledgeBaseCache = new PitchKnowledgeBaseCache(processConfig.requestWindowMs);

/** Rejects an exhausted bucket before private storage, PDF parsing, or raster work. */
export function assertPitchRequestQuotaAvailable(input: PitchRateLimitKey): void {
  assertQuotaResult(processLimiter.available(input));
}

/** Reserves one bounded pitch request immediately before the model adapter runs. */
export function consumePitchRequestQuota(input: PitchRateLimitKey): void {
  assertQuotaResult(processLimiter.consume(input));
}

function assertQuotaResult(result: PitchRateLimitResult): void {
  if (result.allowed) return;
  const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1_000));
  throw new ApiFault(
    "RATE_LIMITED",
    `Pitch AI requests for this job and action are limited to ${readableCountWindow(processConfig)}. Try again in about ${readableDuration(retryAfterSeconds)}.`,
    { retryable: true, retryAfterSeconds },
  );
}

export function cachePitchCapability(input: CapabilityCacheKey, capability: PitchCapabilityCheck): void {
  processCapabilityCache.put(input, capability);
  // A fresh capability run may differ even with the same source fingerprint.
  // Never reuse an earlier knowledge-base draft after it.
  processKnowledgeBaseCache.clear(input);
}

export function getCachedPitchCapability(input: CapabilityCacheKey): PitchCapabilityCheck | null {
  return processCapabilityCache.get(input);
}

export function getOrCreatePitchKnowledgeBase(
  input: CapabilityCacheKey,
  create: () => Promise<PitchKnowledgeBase>,
): Promise<PitchKnowledgeBase> {
  return processKnowledgeBaseCache.getOrCreate(input, create);
}

/** Exact, short-lived draft used solely by the authenticated phone-preview route. */
export function getCachedPitchKnowledgeBase(input: CapabilityCacheKey): Promise<PitchKnowledgeBase> | null {
  return processKnowledgeBaseCache.get(input);
}

function readOutputTokenLimit(action: PitchAction, environment: Environment): number {
  const limit = OUTPUT_TOKEN_LIMITS[action];
  return readBoundedInteger(environment[limit.variable], limit.defaultValue, limit.minimum, limit.maximum);
}

function readBoundedInteger(raw: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function stableBucketKey(input: PitchRateLimitKey): string {
  // JSON preserves field boundaries, unlike delimiter concatenation. All three
  // values originate from server validation/authentication before this point.
  return JSON.stringify([input.actorId, input.jobId, input.action]);
}

function stableCapabilityCacheKey(input: CapabilityCacheKey): string {
  return JSON.stringify([input.actorId, input.jobId, input.jobVersion, input.inputFingerprint]);
}

function readableCountWindow(config: Pick<PitchGuardrailConfig, "maxRequestsPerWindow" | "requestWindowMs">): string {
  return `${config.maxRequestsPerWindow} ${config.maxRequestsPerWindow === 1 ? "request" : "requests"} per ${readableDuration(Math.ceil(config.requestWindowMs / 1_000))}`;
}

function readableDuration(seconds: number): string {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}
