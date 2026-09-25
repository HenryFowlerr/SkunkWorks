# Backend workflow invariants

These pure domain rules mirror `docs/product/architecture-and-contracts.md` contract v1.0. They do not implement a database, auth provider, object store, API route, or model call. Adapters must enforce the same rules in their transaction and authorization boundary.

## Draft versions and reviews

- `Draft.version` is the content version. Every content edit uses `expectedVersion`, increments once, and removes both review records.
- Design and process review records are separate, each stamped with the current version. Recording one does not increment the draft or erase the other review. A stale version returns `VERSION_CONFLICT` with the expected and current versions.
- Publish requires one current design review and one current process review. Authenticated role checks are still required at the API boundary; the domain helper also prevents a visitor from reviewing.
- Editing and review APIs accept content and review intent separately. They must not accept client-authored approval identities or timestamps.

## Context binding

- A context identifies exactly one resource: a release or a draft. A draft context includes the current `draftVersion`; a release context has no draft version.
- Floor context is release-only. The server loads that exact immutable snapshot, checks the job association, and resolves the step and bend from the snapshot. A supplied bend label must match the loaded step.
- Draft contexts are studio-only and version exact. Questions and flags must retain the canonical context returned by validation.

## Machine proposals

- The proposed bend order is a permutation of the draft's stable bend IDs, with each bend exactly once.
- Only confirmed constraints with an exact `appliesToPartFamily` match are enforced. If the job family is unknown, the caller must create a visible review finding for each unresolved applicability; it must not infer applicability.
- Every applied matching constraint needs its matching `workshop_note` evidence reference. The validator proves pointer and order consistency, not the truth of the note's manufacturing content.
- Acceptance reorders the existing step records, marks the proposal with a server-authored decision, increments draft content version, and clears reviews. Rejection records the server-authored decision but does not change step order or content version.

## Publication

- The publication gate checks the current job/draft relationship, exact source and setup identities, ready source assets, matching input fingerprint, confirmed workshop snapshot, valid reviewed geometry, source-evidence validation, one-to-one bend-to-step mapping, supported signed fold rotations, resolved blocking findings, decided machine proposals, and both current reviews.
- Geometry topology and evidence pointer/semantic checks are supplied by their dedicated validators. `geometryValid` and `evidenceValid` are inputs to the pure gate, not claims made by this module.
- The persistence adapter must implement `PublicationPersistence` as one atomic transaction. `lockPublication` must serialize writes to the job, current draft, and latest release. `commitPublication` must insert the immutable snapshot, advance the job's latest-release pointer, and insert the actor/operation/key/payload-hash idempotency record in that same transaction. A database uniqueness constraint must back the key scope.
- A retry with the same actor, operation, key, and payload returns its original release before current-version checks. Reusing that key for a different payload is an error. A different key cannot publish a competing release from a stale predecessor: the supplied `supersedesReleaseId` must equal the locked current release, including `null` for the first release.
- The released content is copied and frozen at publication. A correction is a new draft and a successor; no release snapshot is edited. The successor's `allowPredecessorVisitors` value is the publisher's explicit policy for following from its direct predecessor.

## Release access and flags

- Replacement metadata is computed from a direct same-job successor. `canFollowReplacement` is true only when that successor explicitly allows predecessor visitors.
- Follow is an explicit action. The adapter must load the visitor session and original link, confirm that the link is not revoked, confirm a direct same-job successor and the successor's allow flag, and extend only the scoped session. The extension stores the original access-link ID so revocation also ends successor access. Knowing a release ID grants nothing.
- Flags and their contexts remain bound to the original release. Only same-release verified photos may be attached. An explanation has no replacement-release ID; a replacement response must point at a direct same-job successor. A visitor cannot respond as a designer.
- Flag creation is idempotent on the actor/`flag.create`/key scope and a canonical payload hash. The persistence adapter must atomically store the flag and idempotency record under a uniqueness constraint; same-payload retries return the original flag and changed-payload retries fail.
- Acknowledgement requires the responding visitor session for that exact release, uses `expectedVersion`, emits an acknowledgement event, and may move the flag to `resolved`; it never edits release content.

## Generation completion

- At start, persistence records the job version, input fingerprint, and base draft version alongside the v1.0 `Generation` DTO. Completion checks these values and a freshly computed current input fingerprint in the same transaction that writes the generated draft.
- Completion applies only if the generation is still running and unexpired, the job version and input fingerprint still match, and the current draft version still equals the recorded base version (including `null` when no draft existed). Otherwise the result is discarded and cannot overwrite newer work.
- Applying a valid generated result creates the next draft content version and clears reviews. The persistence adapter owns terminal generation state/error recording and must not leave an unawaited background promise.

## Persistence and authorization boundary

All storage contracts in `src/server/domain/**` and `src/server/access/**` are interfaces only. They require an adapter to provide serializable/locked transactions, database uniqueness constraints, audit persistence, row-level authorization, scoped private asset access, and actor verification. These patches intentionally do not claim those integrations are live.
