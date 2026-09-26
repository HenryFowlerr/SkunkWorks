import { describe, expect, it } from "vitest";
import type { PitchCapabilityCheck, PitchKnowledgeBase } from "@/contracts/pitch";
import {
  PitchCapabilityCache,
  PitchKnowledgeBaseCache,
  PitchRequestLimiter,
  readPitchGuardrailConfig,
} from "@/server/ai/pitch-guardrails";

const capability: PitchCapabilityCheck = {
  approvalState: "draft",
  decision: "needs_supplier_input",
  code: "SOURCE_EVIDENCE_MISSING",
  title: "More supplier evidence needed",
  explanation: "The supplied record does not establish the needed setup fact.",
  checks: [],
  requiredEngineerDecisions: [],
  sourceKeysRead: [],
};

const knowledgeBase = {} as PitchKnowledgeBase;

const key = {
  actorId: "f0a7e622-c0e0-4d6e-a9bb-1b86e991d0fd",
  jobId: "f0a7e622-c0e0-4d6e-a9bb-1b86e991d0fe",
  action: "capability" as const,
};

describe("pitch demo guardrails", () => {
  it("uses conservative defaults and refuses environment values above hard maxima", () => {
    expect(readPitchGuardrailConfig({})).toEqual({
      maxRequestsPerWindow: 2,
      requestWindowMs: 600_000,
      maxOutputTokens: {
        capability: 1_200,
        knowledge_base: 1_800,
        triage: 900,
        preview_question: 750,
      },
    });

    expect(readPitchGuardrailConfig({
      PITCH_AI_MAX_REQUESTS_PER_WINDOW: "3",
      PITCH_AI_REQUEST_WINDOW_MS: "60000",
      PITCH_AI_CAPABILITY_MAX_OUTPUT_TOKENS: "1600",
      PITCH_AI_KNOWLEDGE_BASE_MAX_OUTPUT_TOKENS: "2400",
      PITCH_AI_TRIAGE_MAX_OUTPUT_TOKENS: "1200",
      PITCH_AI_PREVIEW_QUESTION_MAX_OUTPUT_TOKENS: "1000",
    })).toMatchObject({
      maxRequestsPerWindow: 3,
      requestWindowMs: 60_000,
      maxOutputTokens: { capability: 1_600, knowledge_base: 2_400, triage: 1_200, preview_question: 1_000 },
    });

    expect(readPitchGuardrailConfig({
      PITCH_AI_MAX_REQUESTS_PER_WINDOW: "4",
      PITCH_AI_REQUEST_WINDOW_MS: "3600001",
      PITCH_AI_CAPABILITY_MAX_OUTPUT_TOKENS: "1601",
      PITCH_AI_KNOWLEDGE_BASE_MAX_OUTPUT_TOKENS: "2401",
      PITCH_AI_TRIAGE_MAX_OUTPUT_TOKENS: "1201",
      PITCH_AI_PREVIEW_QUESTION_MAX_OUTPUT_TOKENS: "1001",
    })).toMatchObject({
      maxRequestsPerWindow: 2,
      requestWindowMs: 600_000,
      maxOutputTokens: { capability: 1_200, knowledge_base: 1_800, triage: 900, preview_question: 750 },
    });
  });

  it("limits each authenticated actor, job and action independently in a sliding window", () => {
    const limiter = new PitchRequestLimiter({ maxRequestsPerWindow: 2, requestWindowMs: 60_000 });

    expect(limiter.consume(key, 1_000)).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.consume(key, 2_000)).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.consume(key, 10_000)).toEqual({ allowed: false, retryAfterMs: 51_000 });
    expect(limiter.consume({ ...key, action: "triage" }, 10_000)).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.consume({ ...key, actorId: "f0a7e622-c0e0-4d6e-a9bb-1b86e991d0ff" }, 10_000)).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.consume({ ...key, jobId: "f0a7e622-c0e0-4d6e-a9bb-1b86e991d100" }, 10_000)).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.consume(key, 61_001)).toEqual({ allowed: true, remaining: 0 });
  });

  it("rejects an exhausted bucket during cheap preflight without adding another request", () => {
    const limiter = new PitchRequestLimiter({ maxRequestsPerWindow: 1, requestWindowMs: 60_000 });
    expect(limiter.available(key, 1_000)).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.consume(key, 1_000)).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.available(key, 2_000)).toEqual({ allowed: false, retryAfterMs: 59_000 });
    expect(limiter.consume(key, 2_000)).toEqual({ allowed: false, retryAfterMs: 59_000 });
  });

  it("keeps a server-verified capability result only for the local pitch window and exact authenticated input", () => {
    const cache = new PitchCapabilityCache(60_000);
    const cacheKey = {
      actorId: key.actorId,
      jobId: key.jobId,
      jobVersion: 4,
      inputFingerprint: "a".repeat(64),
    };
    cache.put(cacheKey, capability, 100);

    expect(cache.get(cacheKey, 60_099)).toBe(capability);
    expect(cache.get({ ...cacheKey, actorId: "f0a7e622-c0e0-4d6e-a9bb-1b86e991d0ff" }, 60_099)).toBeNull();
    expect(cache.get({ ...cacheKey, jobVersion: 5 }, 60_099)).toBeNull();
    expect(cache.get({ ...cacheKey, inputFingerprint: "b".repeat(64) }, 60_099)).toBeNull();
    expect(cache.get(cacheKey, 60_100)).toBeNull();
  });

  it("single-flights a knowledge-base draft and clears it when the verified capability changes", async () => {
    const cache = new PitchKnowledgeBaseCache(60_000);
    const cacheKey = {
      actorId: key.actorId,
      jobId: key.jobId,
      jobVersion: 4,
      inputFingerprint: "a".repeat(64),
    };
    let calls = 0;
    const create = async () => {
      calls += 1;
      return knowledgeBase;
    };

    const first = cache.getOrCreate(cacheKey, create, 100);
    const second = cache.getOrCreate(cacheKey, create, 100);
    expect(cache.get(cacheKey, 100)).toBe(first);
    expect(cache.get({ ...cacheKey, inputFingerprint: "b".repeat(64) }, 100)).toBeNull();
    await expect(Promise.all([first, second])).resolves.toEqual([knowledgeBase, knowledgeBase]);
    expect(calls).toBe(1);

    cache.clear(cacheKey);
    expect(cache.get(cacheKey, 101)).toBeNull();
    await expect(cache.getOrCreate(cacheKey, create, 101)).resolves.toBe(knowledgeBase);
    expect(calls).toBe(2);
  });
});
