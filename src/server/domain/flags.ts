import { assertExpectedVersion, DomainError } from "./errors";
import { validateContext } from "./contexts";
import { stablePayloadHash } from "./idempotency";
import type { Actor, Asset, ContextRef, Flag, Release } from "./types";

export type Acknowledgement = {
  id: string;
  flagId: string;
  releaseId: string;
  actorId: string;
  responseVersion: number;
  at: string;
};

export function createReleaseFlag(input: {
  id: string;
  context: ContextRef;
  release: Release;
  question: string;
  photoAssets: Asset[];
  createdBy: Actor;
  createdAt: string;
}): Flag {
  const { id, context, release, question, photoAssets, createdBy, createdAt } = input;
  validateContext(context, { kind: "release", release }, "floor");
  if (!question.trim()) throw new DomainError("VALIDATION_FAILED", "A flag needs a question.");
  if (new Set(photoAssets.map((asset) => asset.id)).size !== photoAssets.length) {
    throw new DomainError("VALIDATION_FAILED", "A flag cannot attach the same photo more than once.");
  }
  for (const asset of photoAssets) {
    if (asset.kind !== "issue_photo" || asset.jobId !== release.jobId || asset.releaseId !== release.id || asset.status !== "ready") {
      throw new DomainError("FORBIDDEN", "A flag can include only verified photos attached to this release.");
    }
  }
  return {
    id,
    context: { ...context },
    question: question.trim(),
    photoAssetIds: photoAssets.map((asset) => asset.id),
    createdBy,
    version: 1,
    status: "open",
    createdAt,
    response: null,
  };
}

export function respondToFlag(input: {
  flag: Flag;
  expectedVersion: number;
  actor: Actor;
  text: string;
  kind: "explanation" | "replacement_release";
  replacementRelease: Release | null;
  at: string;
}): Flag {
  const { flag, expectedVersion, actor, text, kind, replacementRelease, at } = input;
  assertExpectedVersion(flag.version, expectedVersion);
  if (flag.status === "resolved") throw new DomainError("VERSION_CONFLICT", "A resolved flag cannot be changed.");
  if (actor.kind !== "member" || !(actor.roles.includes("designer") || actor.roles.includes("admin"))) {
    throw new DomainError("FORBIDDEN", "Only a workspace designer or admin can respond to a flag.");
  }
  if (!text.trim()) throw new DomainError("VALIDATION_FAILED", "A response cannot be empty.");
  if (kind === "explanation" && replacementRelease !== null) {
    throw new DomainError("VALIDATION_FAILED", "An explanation cannot attach a replacement release.");
  }
  if (kind === "replacement_release") {
    if (
      !replacementRelease ||
      replacementRelease.jobId !== flag.context.jobId ||
      replacementRelease.supersedesReleaseId !== flag.context.releaseId
    ) {
      throw new DomainError("VALIDATION_FAILED", "A replacement response must name a published direct successor for this job.");
    }
  }
  return {
    ...flag,
    version: flag.version + 1,
    status: "responded",
    response: {
      text: text.trim(),
      authorId: actor.id,
      at,
      kind,
      replacementReleaseId: replacementRelease?.id ?? null,
    },
  };
}

export type FlagIdempotency = {
  actorId: string;
  operation: "flag.create";
  key: string;
  payloadHash: string;
  flagId: string;
};

export interface FlagTransaction {
  getIdempotency(actorId: string, operation: "flag.create", key: string): Promise<FlagIdempotency | null>;
  getFlag(flagId: string): Promise<Flag | null>;
  loadFlagContext(input: { releaseId: string; photoAssetIds: string[] }): Promise<{ release: Release; photoAssets: Asset[] } | null>;
  lockFlagMutation(input: { flagId: string; replacementReleaseId: string | null }): Promise<{
    flag: Flag;
    replacementRelease: Release | null;
  } | null>;
  commitFlagCreate(input: { flag: Flag; idempotency: FlagIdempotency }): Promise<void>;
  commitFlagResponse(flag: Flag): Promise<void>;
  commitFlagAcknowledgement(input: { flag: Flag; acknowledgement: Acknowledgement }): Promise<void>;
}

export interface FlagPersistence {
  transaction<T>(work: (transaction: FlagTransaction) => Promise<T>): Promise<T>;
}

/** Adapter loads the exact release and release-scoped photos inside this transaction. */
export async function createReleaseFlagIdempotently(
  persistence: FlagPersistence,
  input: {
    id: string;
    context: ContextRef;
    question: string;
    photoAssetIds: string[];
    createdBy: Actor;
    createdAt: string;
    idempotencyKey: string;
  },
): Promise<Flag> {
  if (!input.idempotencyKey.trim()) throw new DomainError("VALIDATION_FAILED", "Flag creation requires an idempotency key.");
  const releaseId = input.context.releaseId;
  if (!releaseId) throw new DomainError("VALIDATION_FAILED", "Flags must identify a release.");
  const operation = "flag.create" as const;
  const payloadHash = stablePayloadHash({
    context: input.context,
    question: input.question.trim(),
    photoAssetIds: input.photoAssetIds,
  });
  return persistence.transaction(async (transaction) => {
    const prior = await transaction.getIdempotency(input.createdBy.id, operation, input.idempotencyKey);
    if (prior) {
      if (prior.payloadHash !== payloadHash) {
        throw new DomainError("IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for a different flag.");
      }
      const priorFlag = await transaction.getFlag(prior.flagId);
      if (!priorFlag) throw new DomainError("VALIDATION_FAILED", "Flag retry record has no flag.");
      return priorFlag;
    }
    const loaded = await transaction.loadFlagContext({ releaseId, photoAssetIds: input.photoAssetIds });
    if (!loaded) throw new DomainError("NOT_FOUND", "Release or attached photos not found.");
    const flag = createReleaseFlag({
      id: input.id,
      context: input.context,
      release: loaded.release,
      question: input.question,
      photoAssets: loaded.photoAssets,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    });
    await transaction.commitFlagCreate({
      flag,
      idempotency: {
        actorId: input.createdBy.id,
        operation,
        key: input.idempotencyKey,
        payloadHash,
        flagId: flag.id,
      },
    });
    return flag;
  });
}

export async function persistFlagResponse(
  persistence: FlagPersistence,
  input: {
    flagId: string;
    expectedVersion: number;
    actor: Actor;
    text: string;
    kind: "explanation" | "replacement_release";
    replacementReleaseId: string | null;
    at: string;
  },
): Promise<Flag> {
  return persistence.transaction(async (transaction) => {
    const loaded = await transaction.lockFlagMutation({
      flagId: input.flagId,
      replacementReleaseId: input.replacementReleaseId,
    });
    if (!loaded) throw new DomainError("NOT_FOUND", "Flag or replacement release not found.");
    const updated = respondToFlag({
      flag: loaded.flag,
      expectedVersion: input.expectedVersion,
      actor: input.actor,
      text: input.text,
      kind: input.kind,
      replacementRelease: loaded.replacementRelease,
      at: input.at,
    });
    await transaction.commitFlagResponse(updated);
    return updated;
  });
}

export async function persistFlagAcknowledgement(
  persistence: FlagPersistence,
  input: {
    flagId: string;
    expectedVersion: number;
    actor: Actor;
    sessionReleaseId: string;
    at: string;
    acknowledgementId: string;
  },
): Promise<Flag> {
  return persistence.transaction(async (transaction) => {
    const loaded = await transaction.lockFlagMutation({ flagId: input.flagId, replacementReleaseId: null });
    if (!loaded) throw new DomainError("NOT_FOUND", "Flag not found.");
    const result = acknowledgeFlag({
      flag: loaded.flag,
      expectedVersion: input.expectedVersion,
      actor: input.actor,
      sessionReleaseId: input.sessionReleaseId,
      at: input.at,
      acknowledgementId: input.acknowledgementId,
    });
    await transaction.commitFlagAcknowledgement(result);
    return result.flag;
  });
}

export function acknowledgeFlag(input: {
  flag: Flag;
  expectedVersion: number;
  actor: Actor;
  sessionReleaseId: string;
  at: string;
  acknowledgementId: string;
}): { flag: Flag; acknowledgement: Acknowledgement } {
  const { flag, expectedVersion, actor, sessionReleaseId, at, acknowledgementId } = input;
  assertExpectedVersion(flag.version, expectedVersion);
  if (
    actor.kind !== "release_visitor" ||
    !flag.context.releaseId ||
    sessionReleaseId !== flag.context.releaseId
  ) {
    throw new DomainError("FORBIDDEN", "Acknowledgement requires a visitor session for the flag's exact release.");
  }
  if (flag.status !== "responded" || !flag.response) {
    throw new DomainError("VALIDATION_FAILED", "Only a response can be acknowledged.");
  }
  const responseVersion = flag.version;
  const nextFlag: Flag = { ...flag, version: flag.version + 1, status: "resolved" };
  return {
    flag: nextFlag,
    acknowledgement: {
      id: acknowledgementId,
      flagId: flag.id,
      releaseId: flag.context.releaseId,
      actorId: actor.id,
      responseVersion,
      at,
    },
  };
}
