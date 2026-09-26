import "server-only";

import type { FlagReplySuggestion } from "@/contracts/ai";

type FloorReportCacheKey = {
  jobId: string;
  flagId: string;
  flagVersion: number;
};

type Entry = {
  promise: Promise<FlagReplySuggestion>;
  expiresAt: number;
};

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 300;

/**
 * Short-lived, process-local reuse for an open floor flag. It makes the
 * automatic engineer desk handoff one provider call per exact flag version
 * while preserving the existing explicit human response/persistence boundary.
 * A production multi-instance deployment needs a shared equivalent.
 */
export class FloorReportCache {
  private readonly entries = new Map<string, Entry>();

  get(key: FloorReportCacheKey, now = Date.now()): Promise<FlagReplySuggestion> | null {
    this.prune(now);
    return this.entries.get(stableKey(key))?.promise ?? null;
  }

  getOrCreate(
    key: FloorReportCacheKey,
    create: () => Promise<FlagReplySuggestion>,
    now = Date.now(),
  ): Promise<FlagReplySuggestion> {
    this.prune(now);
    const cacheKey = stableKey(key);
    const existing = this.entries.get(cacheKey);
    if (existing) return existing.promise;

    const promise = Promise.resolve().then(create);
    const entry: Entry = { promise, expiresAt: now + TTL_MS };
    this.entries.set(cacheKey, entry);
    void promise.catch(() => {
      if (this.entries.get(cacheKey) === entry) this.entries.delete(cacheKey);
    });
    return promise;
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    while (this.entries.size > MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }
}

const processFloorReportCache = new FloorReportCache();

export function getOrCreateFloorReport(
  key: FloorReportCacheKey,
  create: () => Promise<FlagReplySuggestion>,
): Promise<FlagReplySuggestion> {
  return processFloorReportCache.getOrCreate(key, create);
}

export function getCachedFloorReport(key: FloorReportCacheKey): Promise<FlagReplySuggestion> | null {
  return processFloorReportCache.get(key);
}

function stableKey(input: FloorReportCacheKey): string {
  return JSON.stringify([input.jobId, input.flagId, input.flagVersion]);
}
