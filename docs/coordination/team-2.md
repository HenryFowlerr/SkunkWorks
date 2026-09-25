# Team 2 status

- Updated: 2026-09-26 (Pacific/Auckland).
- Contract: v1.0; contract milestone `4a7cd09`, with status/verification updates through `82254dc`.
- Current shared main snapshot: Team 2's existing worktree was safely fast-forwarded from `ea1a2f6` to verified `origin/main` `612191c` (Team 3 floor/geometry delivery) on 2026-09-26. PDF.js `6.3.289` remains exact-pinned on main. Team 2 has not pushed or deployed its changes. Local Team 2 package commit: `65565e8` (`feat(team-2): add workshop and source upload backend paths`), based on `612191c`.
- Worktree: `/Users/henryfowler/Documents/Codex/2026-09-25/goal-complete-the-team-1-md/work/team-2-contracts`, branch `team-2/contracts`. This is the shared Team 2 checkout. Review and preserve local Team 2 commits; keep them unpushed until integration review.

## Fresh Team 2 handoff

Continue in the existing `work/team-2-contracts` worktree. Do not create another checkout or discard, reset, clean, or overwrite its changes. The latest main fast-forward is already included. The migration scratch draft is `supabase/drafts/team2_additive_schema_draft.sql`; it is not an applied migration. Commit `65565e8` captures the current verified Team 2 backend base and remains local/unpushed for integration review.

The committed Team 2 implementation and review material includes:

- `src/app/api/auth/{sign-in,sign-out,sign-up}/route.ts`, `src/app/api/me/route.ts`, and `src/app/auth/callback/route.ts`.
- `src/lib/auth/**`, `src/server/**`, and `src/lib/api/client.ts` (real same-origin JSON transport and Supabase signed-upload client; API/business routes are still incomplete).
- `tests/backend/**`, `tests/contracts/client.test.ts`, and PDF extraction in `src/server/ai/pdf-text.ts`.
- `supabase/drafts/team2_additive_schema_draft.sql`.
- Backend review notes in `docs/backend/{ai-grounding,auth-proxy-integration,storage-and-rls,workflow-invariants}.md`, plus current edits to `docs/backend/contracts.md` and this status file.

## Route implementation state

The following Next route handlers exist in the current Team 2 worktree: `POST /api/auth/sign-up`, `POST /api/auth/sign-in`, `POST /api/auth/sign-out`, `GET /api/me`, `GET /auth/callback`; `GET/POST /api/workshops`, `GET /api/workshops/[id]`, `POST /api/workshops/[id]/versions`, `POST /api/workshops/[id]/versions/[snapshotId]/confirm`; `POST /api/jobs/[id]/assets`; and `POST /api/assets/[id]/complete`. The local auth-route test exercises the honest missing-Supabase-configuration error from `POST /api/auth/sign-in`; it does not prove successful auth/session behavior or callback exchange. Workshop and upload handlers have local type/unit coverage but have not been run against an applied migration or project.

Additional route handlers in the current worktree:

- Workshop list/create/detail/version-save/confirm use workspace-scoped immutable snapshots. Request 0006 is accepted: output notes expose nullable `authorId`, `createdAt`, and source `{label,assetId,page}`; write inputs omit author/time/confirmation; the save RPC stamps changed notes and validates same-workspace ready source assets. Snapshot confirmation is separately recorded.
- `POST /api/jobs/[id]/assets` validates the source DTO and provisional size/type limits, claims the `asset.prepare` key, creates the pending row through a narrow RPC in the SQL draft, and returns a scoped signed upload instruction. It supports idempotent preparation replay while the asset remains pending.
- `POST /api/assets/[id]/complete` requires an authenticated designer in the asset's workspace and finalizes the pending upload only after server-side byte-size, content-signature and SHA-256 verification.

These routes have local type/test coverage only; the SQL is still an unapplied scratch draft and no Supabase project is configured. The remaining typed v1 client routes are unavailable/unverified: workspace/invite; job CRUD/input update; visitor-photo preparation, asset links and visitor streams; AI generation/read; draft-from-release/clarification/finding resolution/read/save/proposal decision/review; publication; release read/replacement/share links; questions; and flag list/create/respond/acknowledge. QR/access exchange `/r/[token]` and invitation landing/redeem `/invite/[token]` are also not implemented. The default browser API uses real fetch and reports missing routes honestly; no fixture success data is substituted.

## Implementation and verification

- Delivered contract milestone: strict v1 DTO schemas/inferred types, success/error envelopes, idempotency and upload shapes, `ReleaseView.sourceAssets`, fixtures, contract tests and docs. `Asset.sha256` is nullable only before successful server verification. TEAM-1 and TEAM-3 acknowledged the shared DTO changes.
- Backend WIP: server-verified auth/session helpers, workspace authorization and repository adapters, API envelope/origin protections, private-storage preparation/finalization and byte hashing, AI grounding/OpenAI adapter, trusted page-indexed PDF text extraction, pure workflow rules, and additive SQL draft. These are implementation/test artifacts only until route wiring and service/database verification are complete.
- PDF dependency handoff: request `0004-pdf-text-extraction-dependency` is accepted; `pdfjs-dist@6.3.289` is pinned on main (`612191c`). `src/server/ai/pdf-text.ts` and its local tests exist in Team 2 WIP. The installed SDK helper and app transport must stay aligned on the Supabase signed-upload multipart body, including `cacheControl=3600`, an unnamed file part, `PUT`, and `x-upsert: false`.
- Local check evidence before this update: the Team 2 contract milestone passed `npm test` (9 files / 66 tests); more recent backend WIP reported passing typecheck and focused AI, lifecycle, HTTP/security/auth checks. Re-run checks after every change and record the exact result below before handing off. None of these checks proves live persistence, upload, provider, permission, or deployment behavior.
- Previous check before the additional workshop and asset route work: `npm run check` passed — TypeScript, ESLint, Vitest (12 files / 79 tests), and Next production build. The build at that point exposed only the five auth handlers. All evidence is local and deterministic; service/database behavior remains unverified.
- Current upload work adds shared caps of 25 MiB PDF, 50 MiB GLB and 2 MiB manifest JSON, verifies exact-boundary behavior in contract tests, and repeats limits in the SQL draft and bucket ceiling. Commit `65565e8` passed `npm run check`: TypeScript, ESLint, Vitest (15 files / 99 tests), and Next production build. The build reports the new workshop routes plus source upload prepare/finalize routes. `git diff --check` passed. SQL is still an unapplied scratch draft and was not parsed/applied against a project; service/storage behavior is unverified.

## Cross-team decisions

- `0001-auth-proxy-helper`: TEAM-1 accepted the exported `updateSession(request)` helper. It is in this worktree's auth WIP; Team 1 can wire its proxy after the helper is committed and merged.
- `0002-asset-hash-finalization`: TEAM-1 and TEAM-3 accepted the nullable pending/failed hash rule. DTO/fixtures are on main; storage finalization remains WIP.
- `0003-contract-schema-runtime-fix`: resolved in the contract schemas by extracting base object schemas before `.omit()`; current full check passes.
- `0004-pdf-text-extraction-dependency`: TEAM-1 accepted the request and pinned `pdfjs-dist@6.3.289` on main. Trusted extraction code/tests exist in Team 2 WIP, but integration with authorized uploaded source bytes and the real sample PDF remain unverified.
- `0005-release-view-source-assets`: TEAM-1 accepted `ReleaseView.sourceAssets`, and TEAM-3 requested/consumes the ready source metadata. DTO and reference documentation are on main.
- `0006-workshop-note-provenance`: accepted by TEAM-1; additive `authorId`, `createdAt`, and source metadata are implemented in the current contract/persistence WIP, including server-owned stamping and same-workspace ready-document validation.

## Live gates and next work

- No active dedicated SkunkWorks Supabase project or credentials are configured. Henry requested a development project and will provide the Supabase organization; check project cost and obtain the required confirmation before project creation. Do not connect to or alter the unrelated inactive personal project.
- `OPENAI_API_KEY` and `OPENAI_MODEL` are unavailable. No live model call is claimed.
- No CLI-generated migration, database application, RLS/storage policy test, upload round trip, hosted API check, or live cross-device verification has been completed. Do not apply the SQL scratch draft or claim persistence until a dedicated project and the authorized workflow are available.
- Next: implement the draft review, proposal decision and publish/release-read route package against v1 contracts; then continue workspace/job setup, visitor access, questions and flags. Integrate PDF extraction only from authorized source bytes. Regenerate a CLI-created migration and verify it against the dedicated project when available; rerun local checks and record exact evidence. Coordinate API/DTO changes through this workstream's status and request files.
