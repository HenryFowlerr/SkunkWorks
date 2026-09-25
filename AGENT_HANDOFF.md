# SkunkWorks agent handoff

Updated: 2026-09-26, Pacific/Auckland

## Original goal

Complete the `TEAM-1.md` assignment for SkunkWorks. Treat the full supplied specification, ownership boundaries, contracts, and collaboration rules as authoritative. Build the designer workflow, workshop setup, draft review and approval, QR printing, and shared application interface. Coordinate integration with Teams 2 and 3 through the repository, deploy the combined application, and verify the complete designer-to-factory-floor-to-designer workflow on desktop and phone. Work autonomously, use parallel subagents as instructed, and resolve failures within Team 1 ownership. Integrate verified changes safely into current `main` without force pushes. Do not declare completion based on mock data, disconnected screens, or unverified deployment. Finish with the deployed URL, verified commit, test evidence, and genuine outstanding blockers.

The source assignment is outside this checkout at:

`/Users/henryfowler/Documents/Codex/2026-09-25/https-www-saasathon-dev-docs-https-2/outputs/skunkworks-build-package/TEAM-1.md`

## Requests received during the session

1. Bootstrap and stabilize the repository first so Teams 2 and 3 could start safely.
2. Keep the shared setup and contracts usable for the other team prompts.
3. Build and improve the full Team 1 designer experience while coordinating Team 2 backend and Team 3 floor/geometry work in isolated worktrees.
4. Integrate verified team milestones safely, deploy the combined application, and verify the real desktop/phone journey.
5. At session end, stop new feature work, preserve every relevant change, run practical checks, document completed versus incomplete work, commit, push without force, and leave this handoff.

## Repository and worktree context

- Remote: `https://github.com/HenryFowlerr/SkunkWorks.git`
- Intended integration branch: remote `main`
- Current local integration branch/worktree: `team-1/studio` at `work/team-1-studio`
- Base remote commit before this integration: `612191c13286ba7c0dd549aaec4aacd5a9c2c59c`
- Team 1 feature commit: `d1ee7a3` (`feat(studio): add designer workflow and review experience`)
- Team 2 implementation/status commits: `65565e8`, `1059649`
- Team 3 regression commits: `dc92f27`, `9c1dbea`
- Team 3 full floor/geometry delivery already on the base: `f42c3e3`
- Combined pre-handoff merge: `3675597` (`merge: integrate Team 2 backend milestone`)
- No pull request was created or discovered locally. This handoff commit is intended to be pushed directly as `HEAD:main`, matching the original integration instruction.

Other worktrees are preserved:

- `work/SkunkWorks`: local `main`, originally at remote `612191c`
- `work/team-2-contracts`: `team-2/contracts`, clean at `1059649`
- `work/team-3-floor`: `team-3/floor`, clean at `9c1dbea`

## Completed work

### Repository foundation and shared contracts

- Bootstrapped the Next.js 16 / React 19 / TypeScript application, exact-pinned dependencies, CI, lint/typecheck/test/build scripts, shared UI, product/integration/ownership docs, and the typed contract/client boundary.
- Kept Team 2 and Team 3 work isolated, recorded cross-team changes under `docs/coordination`, and merged their verified commits without force pushes.
- The browser client uses a same-origin typed API transport. Missing routes surface honest unavailable/error states; production UI does not substitute fixture success data.

### Team 1 designer workflow

- Added authenticated studio composition under `src/app/(studio)/**` and `src/features/studio/**`.
- Added session loading, workspace creation/switching, sign-out, role context, and honest unavailable/unauthenticated behavior.
- Added invitation creation UI that displays the exact server-issued copyable link and expiry. Automatic email delivery is outside scope.
- Added job dashboard and intake with part metadata, confirmed workshop/machine selection, PDF/GLB plus optional bend-manifest upload, upload retry preservation, idempotent job creation, and verified-ready asset attachment.
- File limits are 25 MiB PDF, 50 MiB GLB, and 2 MiB JSON. Team 2 now validates the same limits in contract/server/SQL draft code.
- Added workshop profile creation/versioning, multiple machines and tools, unknown capability handling, sourced bend length, process notes, order constraints, and separate server confirmation.
- Added review desk with authorized source PDF links, supplied GLB viewer, real Team 3 bend scene/mapping editor, sourced facts/findings, cited bend corrections, sequence reordering, machine proposal accept/reject, dual review controls, publish gating, and designer responses to floor flags.
- Generation starts through the typed API with job-version/idempotency data, persists the server operation ID in session storage for refresh recovery, polls the operation, and opens only the server-returned persisted draft.
- Added print label UI that generates a QR only from the server-returned release share URL and prints part, drawing revision, and release identity.
- Added safe same-origin invite return handling in auth and linked the two Team 3 synthetic input packets from the entry page as explicit downloads.
- Added phone/keyboard CSS improvements for review controls and print layout, including 44 px targets and visible focus behavior.

### Team 3 integrated work

- Integrated the signed-axis rigid-panel pose evaluator, topology/order validation, bend scene, supplied-model viewer, bend mapping editor, release-bound operator Guide/Model/Ask/Flags experience, response acknowledgement behavior, and two original synthetic PDF/GLB/manifest variants.
- Integrated `dc92f27`, which fixes stable IDs for mapped reference-face and thickness inputs, with a real-component regression test.

### Team 2 integrated milestone

- Integrated auth/sign-in/sign-out/sign-up/me/callback handlers and verified request/session helpers.
- Integrated workshop list/create/detail/version/confirm handlers.
- Integrated source upload preparation and completion handlers with scoped signed upload, server byte/signature/hash verification, idempotency, and size limits.
- Integrated repository/storage adapters, workflow domain rules, AI grounding/OpenAI adapter, page-indexed PDF extraction, HTTP security/envelopes, and extensive deterministic tests.
- Integrated workshop note provenance: response notes include nullable `authorId`, `createdAt`, `source`, and `confirmedBy`; writable `MachineInput` omits authority-bearing fields. Team 1 was adjusted to send only the writable note shape.
- Preserved `supabase/drafts/team2_additive_schema_draft.sql` exactly as a committed, unapplied scratch draft.

## Files and systems changed

- Team 1 routes/features: `src/app/(studio)/**`, `src/features/studio/**`, `src/features/workshops/**`, `src/features/review/**`, `src/features/print/**`
- Auth/entry integration: `src/components/auth/**`, `src/app/page.tsx`, `src/app/page.test.tsx`
- Team 2 contracts/backend: `src/contracts/**`, `src/lib/api/**`, `src/lib/auth/**`, `src/server/**`, `src/app/api/**`, `src/app/auth/**`, `tests/backend/**`, `tests/contracts/**`, `docs/backend/**`
- Team 2 database draft: `supabase/drafts/team2_additive_schema_draft.sql`
- Team 3 UI/geometry/assets: `src/features/operator/**`, `src/features/visualization/**`, `src/app/(floor)/**`, `public/demo/**`, `tests/geometry/**`, `docs/visualization/**`
- Coordination and handoff: `docs/coordination/team-1.md`, `docs/coordination/team-2.md`, `docs/coordination/team-3.md`, this file

## Verification completed

Final combined local checks run in `work/team-1-studio`:

- `npm run check`
  - PASS: TypeScript typecheck
  - PASS: ESLint
  - PASS: Vitest, 24 files / 145 tests
  - PASS: Next.js 16.3.6 production build, 15 static/dynamic pages/routes collected
- `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/skunkworks-playwright-browsers npm run test:e2e`
  - PASS: 6/6 tests on desktop Chromium and Pixel 7 emulation
  - Scope: entry page viewport/content and sign-in/sign-up usability only
- `npm run typecheck && npx vitest run src/features/workshops/workshops-manager.test.tsx`
  - PASS after reconciling Team 2 `MachineInput` note provenance; 5/5 focused workshop tests
- `npx vitest run src/features/studio/jobs/jobs.test.tsx`
  - PASS: 15/15 after making a two-version workshop option lookup unambiguous

One earlier multi-file focused run failed 1 of 46 tests because the test queried two same-named workshop-version options with a broad matcher. The test was corrected to identify version 3 explicitly, and both the focused rerun and final full suite passed.

Earlier team evidence, now subsumed by the combined run:

- Team 2 commit `65565e8`: `npm run check` passed with 15 files / 99 tests and production build.
- Team 3 through `9c1dbea`: `npm run check` passed with 8 files / 36 tests and production build.

## Incomplete, blocked, or unverified

The original assignment is **not complete**. There is no deployed URL and no verified live designer-to-floor-to-designer journey.

### Missing backend routes

Team 2 still needs to implement and test:

- workspace creation and invite issuance/redeem
- job list/create/get/input update
- authorized asset links and visitor photo upload/stream access
- AI generation creation/status and persisted draft creation
- draft get/save/from-release, clarification/finding resolution, proposal decisions, reviews
- publication and release read/replacement/share-link/revoke/follow
- question ask/list/answer behavior used by the operator UI
- flag list/create/respond/acknowledge behavior used by both UIs
- QR exchange `/r/[token]` and invitation landing `/invite/[token]`

The authoritative typed client enumerates these operations in `src/lib/api/client.ts`. `docs/coordination/team-2.md` contains the detailed route inventory.

### Service and deployment blockers

- No dedicated active SkunkWorks Supabase project was available. The only connected project observed was an unrelated inactive personal project; it was deliberately left untouched.
- `.env.example` requires `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `OPENAI_API_KEY`, and `OPENAI_MODEL`. None were present in the session environment.
- The SQL file is a draft. It was not produced/applied through a Supabase CLI migration workflow, parsed against a live database, or checked with live RLS/storage advisors.
- No live OpenAI request has been run against the supplied PDFs. Grounding code and deterministic tests do not prove provider behavior.
- No Vercel project/link or equivalent standalone Next.js deployment target was configured. The available Sites connector was determined unsuitable for this server-handler application.
- No deployment, hosted authentication callback, QR scan, second-device session, storage upload, persisted flag/response loop, or deployed commit verification was performed.

### Integration gaps and risks

- `src/lib/auth/proxy-session.ts` is present, but `src/proxy.ts` is not. A future Team 1 agent must follow the installed Next 16 proxy documentation and delegate to `updateSession`.
- Team 1 component tests inject typed API transports/mocks to verify behavior. These tests are not live-service evidence.
- The operator and designer screens depend on missing routes and will show honest endpoint errors until Team 2 completes them.
- Workshop note source metadata is preserved in writable payloads, but the current Team 1 editor does not provide a dedicated UI to add/edit note source metadata. Bend-length source citation is implemented.
- The intake copy still labels limits provisional. The same provisional caps are now enforced in Team 2 code and the SQL draft, pending product confirmation.
- The final print workflow is implemented, but a real server-issued share link and physical/second-device scan are unverified.
- The synthetic demo packets are original matching assets and exercise the geometry tests, but they have not passed through a live uploaded-source/AI/persistence pipeline.
- Subagents began returning HTTP 401 errors after the saved Team 2 milestone. No secret was written to the repository, and no repository work was lost; a future session may need corrected Codex/OpenAI service authentication before using subagents.

## Exact next steps, ordered by priority

1. Start from the pushed `main` SHA recorded in the final session report. Read `AGENTS.md`, this handoff, `docs/coordination/team-2.md`, and `docs/integration/protocol.md` before editing.
2. Implement the missing Team 2 job/generation/draft/review/publish/release route package using the existing v1 contracts and domain adapters. Run `npm run check` before integration.
3. Implement workspace/invite plus visitor/question/flag/share-link routes, including `/invite/[token]` and `/r/[token]`. Preserve expected-version, idempotency, release scoping, and immutable snapshots.
4. Add Team 1 `src/proxy.ts` as a thin Next 16 proxy wrapper around Team 2 `updateSession`; verify auth/invite safe redirects.
5. Obtain Henry's explicit Supabase organization choice and cost confirmation, then create or select a dedicated SkunkWorks project. Do not repurpose the unrelated inactive project.
6. Convert the SQL scratch draft into reviewed CLI migrations, apply them to the dedicated development project, configure private storage/auth callbacks, and run RLS/storage/security checks.
7. Obtain/configure `OPENAI_API_KEY` and `OPENAI_MODEL`; run live grounded generation with both alpha and bravo packets. Verify that changed dimensions/signed folds/order change the persisted draft and that conflicts/unknown facts remain explicit.
8. Configure the intended Next.js hosting target and environment variables, deploy the combined current `main`, and record deployed URL, migration version, and commit SHA.
9. Add and run a credential-gated live Playwright scenario covering sign-in, workspace/invite, workshop version and confirmation, job upload, real AI generation, mapping/sequence edits, both current reviews, immutable publish, server share link/QR, phone guide/model/ask/flag, desktop response/replacement, and phone acknowledgement.
10. Verify G1-G10 from the specification on desktop and a real phone/two browser sessions. Create `docs/integration/verification.md` with exact live commands, timestamps, SHA, deployed URL, results, and any remaining limitations. Only then declare the original assignment complete.

## Setup notes

- Runtime requirement: Node.js 24 or newer; package manager is npm; direct dependencies are exact-pinned.
- Install: `npm ci`
- Local verification: `npm run check`
- Browser smoke verification: `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/skunkworks-playwright-browsers npm run test:e2e`
- Local dev: `npm run dev -- --hostname 127.0.0.1`
- Never commit `.env` values or provider/service keys. Browser-safe Supabase values are the only public environment values.
- Preserve `expectedVersion`, idempotency keys, immutable release snapshots, server-owned review/provenance fields, and same-origin typed API usage.
- Do not run or apply `supabase/drafts/team2_additive_schema_draft.sql` directly. Review and convert it using the Supabase migration workflow after a dedicated project is authorized.
- Next may rewrite `next-env.d.ts` between dev and build route-type paths. Do not commit a generated-only change unless the repository's chosen Next workflow requires it.

## Final status at handoff creation

- Local branch: `team-1/studio`
- Last integrated commit before handoff: `36755971423399649a6133a2f3ea934b001f0762`
- Final handoff/integration commit and verified remote `main` SHA are recorded in the final session response after commit/push.
- Deployed URL: none; deployment is blocked by missing dedicated service/deploy configuration and incomplete API routes.
