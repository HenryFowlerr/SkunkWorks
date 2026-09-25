# Storage, persistence and RLS design (draft)

**Status:** review draft for contract v1.0. This is not an applied migration.
**SQL scratch file:** `supabase/drafts/team2_additive_schema_draft.sql`.
**CLI evidence:** no `supabase` executable or local Postgres/Docker tools are installed; `npm exec --yes --package=supabase@latest -- supabase --help` and `supabase migration --help` both failed with `ENOTFOUND registry.npmjs.org`. The scratch file was therefore not created by `supabase migration new` and must be moved into a CLI-generated migration after network/CLI access is available.

## Authority and access boundary

Supabase Auth is the identity provider. Every authenticated API request calls `auth.getUser()` and derives the actor ID from that verified result. Authorization uses active rows in `workspace_members`; neither `user_metadata`, a client-supplied role, a visitor-entered name, nor an unsigned claim grants authority.

The private `private.has_workspace_access(workspace_id, user_id, roles)` helper is a read-only RLS predicate. It compares its user argument with `auth.uid()`, reads the membership table under a locked-down `SECURITY DEFINER` owner, uses an empty `search_path`, contains no dynamic SQL, and lives in a non-exposed schema. This avoids recursive policies where a policy must read `workspace_members`. Admin membership satisfies designer/fabricator role checks.

All application tables in `public` enable RLS. Anonymous and authenticated roles receive no writes. Authenticated receives only explicit `SELECT` grants, paired with a workspace-membership policy. Sensitive invitation, access-link, visitor-session, idempotency and limiter tables receive no client grants. Release visitors never receive a Supabase Auth identity or direct table/storage policy; their API access is authorized from a hashed cookie token, live link status and an exact `release_visitor_session_grants` row.

Mutations run in server-only route/data code. The service key bypasses RLS, so a route must authenticate first, check membership/role and resource scope, validate its DTO, then use the privileged repository. The database functions below are callable through PostgREST only by `service_role`; `PUBLIC`, `anon` and `authenticated` execution is revoked. Keep service credentials out of client bundles and logs.

On current Supabase projects, Data API exposure is a separate setting from SQL grants and RLS. Supabase's changelog says new public tables stopped being auto-exposed by default in May 2026, with enforcement for existing projects scheduled for October 2026. A deployment using server Supabase JS `.from()` calls must explicitly expose the needed tables/functions or use a non-Data-API connection. RLS and SQL grants remain required either way. See [RLS and grants](https://supabase.com/docs/guides/database/postgres/row-level-security) and the [Data API exposure change](https://supabase.com/changelog?types=breaking-change).

## Tables and durable invariants

The draft creates the v1 logical records:

- `workspaces`, `workspace_members`, `workspace_invites`, and `user_profiles`.
- `workshops`, immutable `workshop_versions`, and append-only `workshop_snapshot_confirmations`.
- `jobs`, `assets`, and `job_source_assets`.
- `drafts`, append-only `draft_reviews`, `generations`, and immutable `releases`.
- `release_assets` is the immutable allow-list of source objects a published release can expose.
- `release_access_links` stores only SHA-256 token hashes. `release_visitor_sessions` stores only a hash of the HttpOnly cookie token and remains tied to the original link. Each explicit replacement follow appends a `release_visitor_session_grants` row; it never makes a successor the implicit current release.
- `questions`, `flags`, `flag_photo_assets`, append-only `flag_responses`, and append-only `acknowledgements`.
- `review_notes` stores immutable human clarification evidence; `audit_events` stores append-only actor/action records; `idempotency_records` stores unique operation claims and replay results.

Important constraints include workspace-scoped composite foreign keys, membership uniqueness, monotonically versioned mutable job/draft rows, unique workshop and release revision numbers, unique review per draft version and kind, same-job successor pointers, same-release issue photo attachments, and a unique idempotency scope of `(actor_kind, actor_id, operation, idempotency_key)`.

Workshop profile content and release snapshots are immutable JSONB records. Confirmation metadata is stored separately so it cannot rewrite the selected setup. Release snapshot JSONB contains the v1 `DraftContent`; `reviews` contains the server-authored design/process records. A database trigger rejects release/profile snapshot updates and deletes. The live `jobs.latest_release_id` pointer is mutable metadata and is not copied into or written back to historical releases.

Pending/failed assets store `sha256 = NULL`; only a verified `ready` asset can have a digest. Finalization downloads the uploaded bytes server-side, checks exact byte count and file signature against kind, computes SHA-256 over those bytes, and transitions only `pending → ready`. The API request does not supply a trusted hash. The contract worker has a coordination request to make `Asset.sha256` nullable until ready; do not invent a placeholder digest.

Provisional source limits are 25 MiB per drawing PDF, 50 MiB per GLB, and 2 MiB per bend manifest JSON. The route schema and `prepare_source_asset_internal` both reject oversize metadata, the `assets` table repeats kind-specific size checks, and the bucket has a 50 MiB hard ceiling so a forged byte-size declaration cannot create an unbounded object. Finalization compares stored bytes with the prepared size and fails/deletes mismatches. Issue photos inherit the same bucket-wide ceiling until their product limit is decided.

`POST /api/jobs/[id]/assets` now claims scoped idempotency, atomically creates a pending member source row through `prepare_source_asset_internal`, and returns only a short-lived, single-object signed upload instruction. `POST /api/assets/[id]/complete` requires the verified initiating designer and calls the server-side finalizer. These handlers and RPCs are local code only; the migration draft is unapplied and Supabase credentials are unavailable.

## Private bucket and object authorization

The bucket `skunkworks-private` is created with `public = false`. Object keys are generated from IDs, not filenames:

```text
workspaces/{workspaceId}/jobs/{jobId}/assets/{assetId}/blob
```

The bucket has MIME allow-list hints, but the browser's content type is not evidence: finalization checks bytes. Members may directly select a ready object only if its `assets` row is within their active workspace. A signed-in designer may insert only a matching `pending` source asset row that they created. There are no direct Storage update/delete policies, no upsert, and no public bucket.

Visitor uploads and downloads use server routes. The route validates a live session/link before each request, confirms the asset belongs to the grant's exact release, and streams from the private bucket. A visitor may read a source object only if its ID is in `release_assets`; an issue photo is readable only after the same-release `flag_photo_assets` association. Thus a photo upload cannot reveal or replace a drawing. Use `Cache-Control: private, no-store`, a restrictive referrer policy and no long-lived signed download URL for visitor content. A Supabase signed download URL is itself a bearer capability until expiry; it cannot re-check a revoked QR on every fetch.

For direct member upload, the API creates a one-object signed upload instruction only after the pending row exists and the session client passes the storage INSERT policy. The token is scoped to the immutable object path and short-lived (the current Supabase JS docs state two hours for signed upload URLs); only the scoped upload token, never the service key, reaches the browser. Upload with upsert disabled. If verification fails after bytes reached storage, mark the asset failed and issue a new asset ID/path for replacement instead of overwriting the old path.

See [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), and [signed uploads](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl).

## Route-facing server data operations

The adapter in `src/server/data/repository.ts` exports these server-only entry points:

- `createWorkspaceDataRepository({ sessionClient, serviceClient, workspaceId, requiredRoles })`: calls `sessionClient.auth.getUser()`, reads that same actor's active membership through the RLS-scoped session client, checks `requiredRoles` (admin overrides), then returns a workspace-scoped repository using the server-only service client.
- `repository.getJobBundle(jobId)`: always filters by the verified workspace ID and returns contract-parsed `Job`, `Asset[]`, current `Draft | null`, and `Release[]`. Foreign workspace IDs resolve as not found.
- `repository.getWorkshopSnapshot(snapshotId)`, `getDraft(jobId)`, `getRelease(releaseId)`, and `listFlags({jobId | releaseId})`: validate ownership before mapping database rows through the shared v1 Zod DTO schemas.
- `repository.saveDraft({ jobId, expectedVersion, content })`: requires designer/admin, validates `DraftContentInput`, resets authority-bearing finding/proposal/reviewed fields, and performs a compare-and-swap update filtered by `job_id`, `workspace_id` and `version`. No returned row means `VERSION_CONFLICT`; reviewers from an older content version remain in history but are never current.
- `repository.authorizeReleaseAsset(releaseId, assetId)`: returns a private storage key only after confirming the caller is a member of the owning workspace. The visitor equivalent revalidates the session and exact source/photo association before returning that key.
- `createPrivateStorageAdapter(serviceClient)`: prepares a scoped signed source upload, finalizes and hashes a stored object, and streams an authorized object. The adapter takes a storage key only from an authorization result; callers cannot pass an arbitrary URL or arbitrary bucket path.
- `prepare_source_asset_internal` checks active fabricator/designer workspace membership, exact job/workspace scope, the 25/50/2 MiB per-kind caps, and the live `asset.prepare` idempotency claim before inserting the pending asset and completing the claim in one transaction.
- `create_workshop_internal` and `save_workshop_version_internal` write immutable profile snapshots under a compare-and-swap version and idempotency claim. The save RPC stamps new/edited machine notes with the verified actor/database time, preserves unchanged provenance, and checks every referenced source asset is a ready PDF/manifest in the same workspace. Confirmation is a separate role-checked append-only RPC.

API handlers must use the DTO contract and turn adapter errors into the v1 API error envelope/status. They must never log the signed upload token, visitor cookie, invitation/QR token, provider key or file contents.

## Transaction, concurrency and recovery contracts

The SQL draft provides narrow service-role RPCs:

- `public.claim_idempotency_internal(actorKind, actorId, operation, key, payloadHash, leaseSeconds)` serializes a unique scoped key. A matching completed call replays its response; the same key with a different hash raises `IDEMPOTENCY_KEY_REUSED`; a live running claim returns running; an expired lease can be reclaimed with a new claim token. Every mutating route hashes a canonical validated payload and scopes the claim by actor and operation.
- `public.publish_release_internal(workspaceId, jobId, actorId, expectedDraftVersion, supersedesReleaseId, allowPredecessorVisitors, idempotencyRecordId, claimToken)` locks the job and current draft, checks exact draft version, current design/process reviews, confirmed selected setup/machine, ready source assets, reviewed panel model, no open blocking findings, and that the requested predecessor equals the job's current release. It inserts one immutable revision and source allow-list, advances the job pointer/version, and completes the idempotency response in the same transaction. Concurrent requests for one job serialize; a different key racing after the winner sees a stale predecessor and gets a conflict. The route/domain validator must additionally validate full geometry, evidence pointers, bend/step relationships and the recomputed input fingerprint.
- `public.follow_release_replacement_internal(sessionId, currentReleaseId, replacementReleaseId)` adds only a direct same-job published successor when that successor explicitly allows predecessor visitors. Every later read still checks the original link's live revocation state and the per-release grant.
- `public.consume_visitor_rate_limit_internal(sessionId, releaseId, operation)` uses one atomic upsert keyed by access link and operation with a database-clock, globally aligned five-minute fixed window. Initial budgets are 20 questions and 8 flags per link/window. The HTTP layer returns the standard retryable rate-limit envelope. Add an edge/IP budget as well; link budgets do not replace network-level abuse controls.

The mutation transaction owns both the domain write and completion of the idempotency claim. Do not make a sequence of separate HTTP requests and assume they are atomic. For network failure after commit, retry with the same key/payload and replay the stored result. For a lost worker before commit, its lease expires and a retry can reclaim it. Flag response and acknowledgement routes compare `expectedVersion`, lock the flag row, append the actor event, and update status/version in one transaction; stale responses return 409.

Invitations are stored as hashes, bound to workspace/role/expiry, and redeemed only for a verified signed-in user in one transaction. Share-link revocation sets `revoked_at`; every later exchange, visitor API request, replacement follow and asset stream checks it. A visitor's typed name is display text only and is never treated as verified identity.

## Verification still required

When a dedicated development Supabase project and CLI are available:

1. Create an official migration using `supabase migration new team2_persistence_rls`, then review/move this scratch SQL into it.
2. Start/inspect the intended local Supabase stack, apply the generated migration there, run `supabase test db`, and inspect `pg_policies`, grants, triggers, foreign keys and indexes.
3. Test as anon, member in workspace A, member in workspace B, designer, fabricator, admin, valid visitor session and revoked visitor session. Attempt reads and writes directly through PostgREST and Storage, not only through route handlers.
4. Race same-key and different-key publication calls; verify one release for the same idempotency key, stale expected versions get a conflict, old reviews fail after edit, failed upload retry uses a fresh asset path, and a revoked QR cannot open a new asset stream.
5. Run current Supabase database advisors/security checks against the dedicated project. Do not run any of these commands against the unrelated inactive personal project.

The local Python static checks cover draft structure only. They do not parse PostgreSQL SQL or prove RLS behavior. No migration has been applied and no live project has been provisioned.
