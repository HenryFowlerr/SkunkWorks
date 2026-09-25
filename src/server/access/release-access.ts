import { DomainError } from "../domain/errors";
import type { Actor, Release } from "../domain/types";

export type ReleaseViewAccess = {
  replacementReleaseId: string | null;
  canFollowReplacement: boolean;
};

/** Replacement metadata is live, while the release snapshot remains immutable. */
export function releaseViewAccess(release: Release, directSuccessor: Release | null): ReleaseViewAccess {
  const isDirectSuccessor =
    directSuccessor !== null &&
    directSuccessor.jobId === release.jobId &&
    directSuccessor.supersedesReleaseId === release.id;
  return {
    replacementReleaseId: isDirectSuccessor ? directSuccessor.id : null,
    canFollowReplacement: isDirectSuccessor && directSuccessor.allowPredecessorVisitors,
  };
}

export type FollowContext = {
  sourceRelease: Release;
  successor: Release;
  actor: Actor;
  visitorSession: {
    id: string;
    /** Derived under the adapter's session/link lock, not stored as a DB status. */
    state: "active" | "revoked" | "expired";
    expiresAt: string;
    revokedAt: string | null;
  };
  /** Database time sampled while the visitor session and link are locked. */
  checkedAt: string;
  sessionReleaseId: string;
  accessLink: { id: string; releaseId: string; revokedAt: string | null };
};

export function assertCanFollowReplacement(context: FollowContext): void {
  const { sourceRelease, successor, actor, visitorSession, checkedAt, sessionReleaseId, accessLink } = context;
  if (!visitorSession.id || actor.kind !== "release_visitor") {
    throw new DomainError("FORBIDDEN", "Following a replacement requires a scoped visitor session.");
  }
  const expiresAt = Date.parse(visitorSession.expiresAt);
  const checkedAtMs = Date.parse(checkedAt);
  if (
    visitorSession.state !== "active" ||
    visitorSession.revokedAt !== null ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(checkedAtMs) ||
    expiresAt <= checkedAtMs
  ) {
    throw new DomainError("RELEASE_REVOKED", "This visitor session is revoked or expired.");
  }
  if (accessLink.revokedAt !== null) throw new DomainError("RELEASE_REVOKED", "This release link has been revoked.");
  if (
    sessionReleaseId !== sourceRelease.id ||
    accessLink.releaseId !== sourceRelease.id ||
    successor.jobId !== sourceRelease.jobId ||
    successor.supersedesReleaseId !== sourceRelease.id
  ) {
    throw new DomainError("FORBIDDEN", "The requested release is not this job's direct successor.");
  }
  if (!successor.allowPredecessorVisitors) {
    throw new DomainError("FORBIDDEN", "The publisher did not allow predecessor visitors to follow this release.");
  }
}

/** The adapter must persist this grant against the original link ID for revocation inheritance. */
export type SuccessorAccessGrant = {
  accessLinkId: string;
  visitorSessionId: string;
  sourceReleaseId: string;
  releaseId: string;
};

export interface ReleaseFollowTransaction {
  lockFollowContext(input: {
    sourceReleaseId: string;
    replacementReleaseId: string;
    visitorSessionId: string;
  }): Promise<FollowContext | null>;
  extendScopedSession(grant: SuccessorAccessGrant): Promise<void>;
}

export interface ReleaseFollowPersistence {
  transaction<T>(work: (transaction: ReleaseFollowTransaction) => Promise<T>): Promise<T>;
}

/** Explicit visitor action; the returned scope stays linked to the original revocable token. */
export async function followReplacement(
  persistence: ReleaseFollowPersistence,
  input: { sourceReleaseId: string; replacementReleaseId: string; visitorSessionId: string },
): Promise<Release> {
  return persistence.transaction(async (transaction) => {
    const context = await transaction.lockFollowContext(input);
    if (!context) throw new DomainError("NOT_FOUND", "Release replacement is unavailable.");
    if (context.visitorSession.id !== input.visitorSessionId) {
      throw new DomainError("FORBIDDEN", "The locked visitor session does not match the requested session.");
    }
    assertCanFollowReplacement(context);
    await transaction.extendScopedSession({
      accessLinkId: context.accessLink.id,
      visitorSessionId: context.visitorSession.id,
      sourceReleaseId: context.sourceRelease.id,
      releaseId: context.successor.id,
    });
    return context.successor;
  });
}
