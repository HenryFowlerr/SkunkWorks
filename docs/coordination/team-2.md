# Team 2 status

- Updated: 2026-09-26 (Pacific/Auckland)
- Branch: `team-2/contracts`
- Latest contract milestone: `4a7cd0988ad7667d71c888e64e1cdd398cb7c878` (`feat(contracts): define v1.0 API and domain schemas`), based on `origin/main` `afb33650429f31601a413820fc51a7c90dbee51e`.
- Contract version: 1.0.

## Delivered

- Authoritative Zod schemas and inferred types for v1.0 domain DTOs, request DTOs, and success/error envelopes in `src/contracts/**`.
- Browser-safe typed client at `src/lib/api/client.ts`; its injectable transport validates envelopes and preserves idempotency headers. The exported default `api` uses an explicit unavailable transport that always rejects. It does not return fixtures or imply live API availability.
- Synthetic workshop, source asset, panel/hinge model, draft, release, flag, and actor fixtures; schema and client tests in `tests/contracts/**`.
- `Asset.sha256` is nullable for pending/failed assets and required/valid for ready assets. Release source metadata is constrained to the ready, same-job source assets named by the immutable release snapshot; storage URLs are separately authorized through `assets.getLink`.
- Contract notes and decisions are in `docs/backend/contracts.md` and requests 0001, 0002, and 0005.

## Verification

- `npm test` — passed, 9 test files / 66 tests (rerun 2026-09-26).
- `npm run check` — passed: TypeScript, ESLint, tests (9 files / 66 tests), and Next.js production build. TEAM-1 independently reran the combined check on the same contract plus backend-WIP tree and confirmed the 66-test count.
- `git diff --cached --check` — passed before the contract commit.
- Validation was run after merging Team 1's `afb3365` Vitest alias commit. No contract-only override remains.
- The contract milestone does not verify a real Supabase project, live OpenAI call, private object upload, deployment, QR scan, or cross-device state.

## Request decisions and coordination

- 0001, auth proxy helper: TEAM-1 acknowledged and accepted `updateSession(request)`. The helper remains in separate Team 2 backend work-in-progress; Team 1 will connect protected studio/floor routes after that helper is committed and merged. Public entry/auth routes remain pass-through and route handlers still authorize themselves.
- 0002, asset hash finalization: TEAM-1 and TEAM-3 acknowledged and accepted the nullable pending/failed hash rule. Contract and fixtures are delivered. Server-side byte verification and finalization remain backend work.
- 0003, refined Zod schema runtime failure: resolved by extracting unrefined Finding and MachineProposal object bases before `.omit()`. Full test and check commands passed; request text was authored by the requester and is left for that requester to close.
- 0004, trusted PDF extraction dependency: open for TEAM-1 decision/manifest integration. Team 2 has not changed package manifests.
- 0005, release source asset metadata: TEAM-1 accepted the additive `ReleaseView.sourceAssets` shape; TEAM-3 requested and will consume it. Runtime contract is delivered. TEAM-1 still owns updating the reference DTO in `docs/product/architecture-and-contracts.md`.

## Current backend state and next work

The contract milestone is separate from ongoing Team 2 backend/auth/API/Supabase work in the worktree; those files were not included in commit `4a7cd09`. The current production build exposes `/`, auth sign-in/up/out, `/api/me`, and `/auth/callback`; studio/floor pages and core job/upload/draft/release/flag handlers are not yet present. No active dedicated SkunkWorks Supabase project or credentials were available at the last account inspection. No project was created or changed and no migration was applied. Therefore persistence, authentication, storage, AI generation, routes, and live permissions remain unverified; the explicit unavailable transport must stay in place until real handlers are integrated.

Next bounded work: continue the owned backend implementation after confirming the shared project and credentials through the authorized account path; complete upload-byte verification/finalization and release source-asset authorization, then integrate routes against the v1.0 schemas. Do not claim live behavior from fixtures or the contract-only client.

Required coordination: TEAM-1 to update the architecture reference for nullable asset hashes and `ReleaseView.sourceAssets`, and decide the PDF extraction dependency request 0004. TEAM-3 can merge `4a7cd09` and use its exported types and client signatures.
