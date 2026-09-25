# TEAM 2 backend handoff

Updated: 2026-09-26, Pacific/Auckland

## Original goal

Complete the full `TEAM-2.md` assignment for SkunkWorks. Treat the supplied product specification, ownership boundaries, contracts, and collaboration rules as authoritative. Publish shared schemas, fixtures, and the typed API client early so Teams 1 and 3 can integrate. Build the real backend for authentication, workspace permissions, private file storage, workshop and machinery profiles, job inputs, grounded AI generation, draft editing, human review, immutable releases, secure QR access, contextual questions, bend-specific flags, designer responses, and operator acknowledgements. AI output must cite evidence and report missing or conflicting information instead of inventing manufacturing facts. Enforce version checks, edit-driven approval invalidation, release-scoped access, and explicit access to successor releases. Apply and verify database migrations, connect the real model provider, and test permissions, concurrency, failures, and recovery. Work autonomously with the required parallel-agent process and coordinate through the repository.

The user later instructed the agent to stop starting work, preserve all progress, document completed and incomplete areas, run practical checks, commit, and push the current intended branch.

## Repository and collaboration context

- Worktree: `/Users/henryfowler/Documents/Codex/2026-09-25/csharp-goal-complete-the-team-2-3/work/team-2`
- Branch: `team-2/contracts`
- Starting commit for this backend work: `ea1a2f6e12314d9595a03ed8f71d27eeec4bfafb`
- Intended GitHub remote: `github`, `https://github.com/HenryFowlerr/SkunkWorks.git`
- The local `origin` remote points to another local worktree and is not the intended delivery remote.
- GitHub `main` was fetched at `612191c13286ba7c0dd549aaec4aacd5a9c2c59c`. It contains Team 3 commit `f42c3e3ddc10006a91653cf919edf3178f971af6`. It was deliberately not merged during this shutdown handoff.
- Existing contract PR: [#1](https://github.com/HenryFowlerr/SkunkWorks/pull/1).
- Ownership rules are in `AGENTS.md`, `docs/ownership.md`, and `docs/integration/protocol.md`. Team 2 owns `src/contracts/**`, `src/app/api/**`, `src/server/**`, `src/lib/api/**`, `src/lib/auth/**`, token/invite/auth callback handlers, `supabase/**`, backend tests/docs, and its own coordination files.
- Parallel lanes implemented storage/schema, AI, and lifecycle work. Their last turns ended with agent-service 401 errors. Their filesystem changes had already landed in the shared worktree; the primary agent reviewed and ran the combined local checks.

## Requested task list

1. Publish strict shared runtime schemas, fixtures, error envelopes, and a typed browser API client.
2. Implement Supabase Auth signup/signin/signout/callback, verified server sessions, invitations, workspace membership, and role enforcement.
3. Implement private source/model/manifest/photo storage with signed uploads, byte and signature verification, SHA-256 finalization, short-lived reads, retry, and recovery.
4. Implement versioned workshop profiles, machinery, documented capability notes, confirmations, jobs, and selected immutable setup inputs.
5. Implement grounded OpenAI PDF generation and contextual Q&A using real uploaded evidence, strict structured output, source citations, missing/conflict states, and server-side model provenance.
6. Implement request-bound persisted generation with leases, idempotency, stale-result rejection, provider error persistence, and first-draft creation.
7. Implement draft editing, mapping review, clarifications, findings, machine proposal decisions, approval invalidation, design/process review, and optimistic concurrency.
8. Implement atomic immutable releases, successor lineage, share-link issue/revocation, QR token exchange, release visitor sessions, and explicit successor access.
9. Implement contextual questions, bend-specific flags, optional photos, designer responses, polling state, and visitor acknowledgements with idempotency and rate limits.
10. Create, apply, and verify Supabase migrations; connect and verify the live OpenAI model; test negative permissions, concurrency, recovery, and hosted cross-device behavior.
11. Integrate current main, run full checks, push without rewriting history, and provide a truthful handoff.

## Completed local implementation

These items are implemented and locally verified with deterministic tests. They are not evidence of a live Supabase/OpenAI deployment.

- Shared v1.0 schemas and typed API client now cover real same-origin JSON requests, strict envelopes, idempotency headers, private signed uploads, upload finalization, and resumable upload recovery.
- The default API client uses real fetch. The explicit unavailable transport remains test-only and never returns fixture success.
- All documented Team 2 route groups exist under `src/app/api/**`, including auth, workspaces, invitations, workshops/versions, jobs/inputs, assets, generation, draft changes/reviews, publication, releases/share links/replacements/photos, questions, flags/responses, and acknowledgements.
- Auth helpers use verified Supabase `getUser()` sessions. Workspace roles come from active database memberships. Admin is accepted by repository role gates as an override.
- Private storage code prepares scoped signed uploads, validates origin/header safety in the browser client, verifies stored byte count and file signatures, calculates SHA-256 server-side, prevents overwrite/upsert, and supports ambiguous completion and interrupted upload recovery.
- Domain code enforces expected versions and resets mapping review, findings, machine proposal decisions, and prior reviews when draft content changes.
- The OpenAI adapter uses the Responses API, actual PDF file input, strict JSON Schema structured output, `store: false`, an environment-selected `OPENAI_MODEL`, bounded timeout, and no production mock fallback.
- Grounding code validates uploaded/authorized PDF bytes and trusted extracted page text, exact citation excerpts, evidence source IDs, bend/step IDs, missing/conflict rules, confirmed workshop notes, and unsupported model output.
- Generation can start without an existing draft. It records a durable operation, uses an input fingerprint and claim token, rejects stale/expired completion, creates or versions the draft, and stores the model identifier internally.
- Q&A stores the question before the provider call. Reusing the same actor/key/payload returns the same receipt; a failed provider call can retry the unanswered record, while a completed retry returns the saved answer without another model call. Model identifiers are stored internally.
- Lifecycle routes validate release context for questions and flags, distinguish member and visitor permissions, persist designer responses and visitor acknowledgements, require explicit successor follow, and implement visitor question/flag rate limits in the SQL draft.
- Release photo preparation now returns either an already-ready asset or fresh upload instructions. The typed client handles both states.
- Documentation was added under `docs/backend/**`, and cross-team requests 0003, 0004, 0006, 0007, and 0008 were recorded under `docs/coordination/requests/team-2/**`.

## Changed files and systems

- Contracts/client: `src/contracts/api.ts`, `src/lib/api/client.ts`, `tests/contracts/client.test.ts`, `docs/backend/contracts.md`.
- API routes: all new files under `src/app/api/**`.
- Auth/token entry handlers: `src/app/auth/callback/route.ts`, `src/app/invite/[token]/route.ts`, `src/app/r/[token]/route.ts`, and `src/lib/auth/**`.
- Server implementation: all new files under `src/server/access/**`, `src/server/ai/**`, `src/server/api/**`, `src/server/auth/**`, `src/server/data/**`, `src/server/domain/**`, and `src/server/http/**`.
- Verification: all new files under `tests/backend/**` plus expanded client tests.
- Backend documentation: `docs/backend/ai-grounding.md`, `auth-proxy-integration.md`, `route-boundaries.md`, `storage-and-rls.md`, and `workflow-invariants.md`.
- Coordination: `docs/coordination/team-2.md` and requests `0003`, `0004`, `0006`, `0007`, and `0008`.
- Database work is preserved as non-applicable drafts in `supabase/drafts/**`. The latest working draft is `supabase/drafts/team2_backend_schema_working.sql`; the earlier partial draft is `team2_additive_schema_draft.sql`.

## Incomplete, blocked, or unverified

### Database migration is a draft and must not be applied

No file remains under `supabase/migrations/**`. The latest SQL was moved to `supabase/drafts/team2_backend_schema_working.sql` during shutdown because it has not been parsed or applied to PostgreSQL and its final function privileges are incomplete. This prevents an accidental `supabase db push` from applying an unreviewed security boundary.

Known SQL issues:

- The working draft defines all 40 RPC names currently called by `src/server/data/**`, and a parameter-name parity audit found no signature-key mismatch.
- It does not yet contain final `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` and intended `GRANT EXECUTE TO service_role` statements for every later RPC. PostgreSQL grants function execution to `PUBLIC` by default, so this is security-critical.
- `publish_release_internal` currently validates the two review roles with `count(distinct dr.actor_id) = 2`. This incorrectly rejects one admin performing both design and process reviews, which the product specification permits. Count the two valid review rows/kinds instead.
- SQL syntax, constraints, triggers, RLS, storage policies, concurrency behavior, and RPC return DTOs have not been exercised on a real PostgreSQL/Supabase instance.
- No migration history exists remotely for this work.

### Team 3 integration mismatch

GitHub main's Team 3 demo manifests use `manifestVersion: "skunkworks-bend-manifest/1.0"`. The current backend tests/docs use `"1.0"`. Update the backend parser/test fixtures to consume the namespaced Team 3 format after merging main, and validate the full actual manifest structure. This was identified but not edited before shutdown.

Team 3 calls `api.questions.ask` without retaining an explicit idempotency key. The client generates a UUID for source compatibility, but reliable UI retries require Team 3 to retain and reuse a key as described in request 0008.

### Live services and deployment

- No Supabase project was created and no migration was applied. One connected organization was visible: `SipSaver`, id `eyvuxuwtrroejgfqcboy`. The user had said they would provide/select the organization. Project creation still requires explicit human selection, a cost lookup, a cost disclosure, and explicit cost confirmation.
- Suggested region for a New Zealand demo is `ap-southeast-2`, subject to human choice.
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_TOKEN_PEPPER` were absent.
- `OPENAI_API_KEY` and `OPENAI_MODEL` were absent. No live provider request was run.
- No hosted API, QR scan, cross-device flag/response loop, RLS negative test, storage upload, or security advisor run was performed.
- No Team 1 deployment was changed. Team 1 must still connect `src/lib/auth/proxy-session.ts` from its owned proxy and configure `SUPABASE_TOKEN_PEPPER` in its environment documentation/runtime.

### Integration and Git

- GitHub main at `612191c` was fetched but not merged. The user explicitly requested shutdown and prohibited starting new work; merging Team 3 at that point would have expanded the handoff operation.
- Full combined Team 1/2/3 checks and browser E2E remain pending after that merge.
- PR #1 existed for the earlier contract milestone. The shutdown commit should be pushed to the same `team-2/contracts` branch; inspect/update the PR description after push if GitHub access permits.

## Risks, assumptions, and technical debt

- Route tests mock persistence. Green route tests do not prove SQL, RLS, or Supabase Storage behavior.
- The working SQL is large and was assembled incrementally. Treat it as review material, not an applicable migration.
- The storage verifier streams the entire uploaded object to hash and inspect it. Size limits are enforced in request schemas, but live memory/runtime behavior has not been measured.
- Signed upload expiry is represented as two hours in application metadata; confirm the actual Supabase signed-upload token lifetime matches before presenting it to users.
- Q&A and generation evidence can use trusted PDF text. Pages with no extractable text are deliberately marked unreadable and must not become visual-only factual evidence.
- The typed client uses `crypto.randomUUID()` when a question idempotency key is omitted. That prevents API breakage but cannot recover a request unless the caller supplies and retains its own key.
- The service configuration currently falls back to the Supabase service-role key as the bearer-token HMAC pepper if `SUPABASE_TOKEN_PEPPER` is absent. Configure a dedicated stable pepper before issuing durable links.
- The original local `origin` remote is another worktree. Use `github` for fetch/push unless the repository owner deliberately repairs remotes.

## Next steps, in priority order

1. Read this handoff, `AGENTS.md`, `TEAM-2.md`, `docs/integration/protocol.md`, and all three coordination status files. Fetch `github/main` and confirm no newer work exists.
2. Review `supabase/drafts/team2_backend_schema_working.sql`. Fix the admin dual-review bug and add exhaustive function privilege revokes/grants. Add static parity/security tests under `tests/backend/**` or `scripts/backend/**`.
3. Create a fresh official migration with the Supabase CLI only after the SQL is reviewable. Apply it to an explicitly approved development project. Never copy the draft into `supabase/migrations` and push without validation.
4. Run migration/table/RPC inspection, positive and negative membership tests, visitor isolation tests, asset policies, idempotent/concurrent publication, stale generations, and Supabase security/performance advisors. Record exact evidence.
5. Merge current `github/main` normally. Resolve only Team 2-owned conflicts. Update the bend-manifest parser to Team 3's namespaced v1.0 format and update request 0007.
6. Run `npm ci`, `npm run check`, geometry/operator/backend tests, and Team 1 E2E against the merged tree.
7. Obtain runtime OpenAI credentials securely, set the explicit enabled `OPENAI_MODEL`, run a real PDF generation and Q&A, and verify source variation, missing/conflicting evidence, invalid IDs, timeout, refusal, and malformed output.
8. Obtain explicit human approval for the Supabase organization and project cost before project creation. Configure secrets outside source control.
9. Run the hosted source upload → generation → edit/review → publish → QR → floor → question/flag → designer response → operator acknowledgement journey on separate sessions/devices.
10. Update `docs/coordination/team-2.md`, the existing PR, and Team 1's verification handoff with live versus local evidence. Do not claim TEAM-2 complete until those live gates pass.

## Verification evidence available at shutdown

Commands run successfully before the final shutdown check:

- `npm ci` — passed, installed the exact lockfile dependency set.
- `npm run typecheck` — passed before the last AI prompt change; the AI lane subsequently reran typecheck successfully after fixing that change.
- `npm run lint` — passed.
- `npm test` — earlier run passed 17 files / 121 tests.
- `npm run build` — passed after `npm ci`; all Team 2 routes were included in the Next.js route manifest.
- `npx vitest run tests/contracts/client.test.ts tests/backend/routes/release-photo.test.ts` — passed, 2 files / 16 tests after photo recovery alignment.
- AI/Q&A focused rerun reported 5 files / 40 tests passed, plus focused ESLint and typecheck passed.
- Lifecycle/client focused rerun reported 4 files / 42 tests passed, plus focused ESLint passed.
- `git diff --check` — passed at the earlier pre-handoff inspection.

Final shutdown verification: `npm run check` passed on 2026-09-26. It ran typecheck, lint, 17 test files / 125 tests, and the Next.js production build. No live-service result should be inferred from these commands.

## Setup notes

- Node requirement: `>=24`; package manager: npm; dependencies are pinned in Team 1-owned `package.json` and `package-lock.json`.
- Core commands: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run check`.
- Supabase CLI used during development: `npx --yes supabase@latest`, version observed `2.118.0`.
- Required runtime variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_TOKEN_PEPPER`, `OPENAI_API_KEY`, and `OPENAI_MODEL`. Optional bounded settings are documented in `docs/backend/ai-grounding.md`.
- Never paste or commit secret values. No secret-like values were found in the pre-handoff repository scan.
