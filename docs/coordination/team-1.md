# Team 1 status

- Updated: 2026-09-26 (Pacific/Auckland).
- Workstream: `team-1/studio`, isolated worktree `/Users/henryfowler/Documents/Codex/2026-09-25/goal-complete-the-team-1-md/work/team-1-studio`.
- Integrated local milestones: Team 1 designer workflow `d1ee7a3`; Team 3 floor/geometry and mapped-input fix through `9c1dbea`; Team 2 backend milestone through `1059649`. The combined merge before the final handoff commit is `3675597`.
- Contract: v1.0. Request 0006 is accepted and integrated: workshop note output contains nullable server-owned author/time/confirmation plus nullable source metadata, while write input omits authority fields.

## Completed locally

- Real-auth UI and studio session shell, workspace selection/creation, invitation-link issuance UI, job list/intake, workshop version editor, designer draft review, sourced fact correction, sequence reordering, review/publish controls, factory issue response, and QR label printing are implemented against the typed same-origin client.
- Team 3 supplies the release-bound floor guide, model, ask/flag/acknowledgement UI, geometry engine, two original synthetic PDF/GLB/manifest packets, and the mapped-input regression fix.
- Team 2 supplies auth/session helpers and routes, workshop routes, source upload preparation/finalization, storage and repository adapters, AI grounding/provider code, workflow domain rules, and an unapplied additive SQL draft.
- The entry page links both original synthetic input packets explicitly as downloads and does not present them as completed AI runs.
- Combined verification on 2026-09-26: `npm run check` passed TypeScript, ESLint, 24 Vitest files / 145 tests, and the Next.js production build. `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/skunkworks-playwright-browsers npm run test:e2e` passed 6/6 desktop Chromium and Pixel 7 entry/auth smoke tests.

## Incomplete and blocked

- The combined browser journey is not complete. Team 2 still needs workspace/invite, job CRUD/input update, asset-link/visitor upload, generation/read, draft operations/review/publish, release/share/replacement, question, flag/response/acknowledgement, `/r/[token]`, and `/invite/[token]` handlers.
- `src/lib/auth/proxy-session.ts` exists, but Team 1 has not added the Next 16 `src/proxy.ts` delegation.
- `supabase/drafts/team2_additive_schema_draft.sql` is a scratch draft only. It has not been converted to a CLI migration, applied, or tested with RLS/storage against a dedicated project.
- No active dedicated SkunkWorks Supabase project, Supabase environment values, `OPENAI_API_KEY`, `OPENAI_MODEL`, or deploy target is configured. Do not alter the unrelated inactive personal Supabase project discovered during this session.
- No live AI call, storage upload round trip, real authentication success, persisted designer-to-floor flag loop, QR scan on another device, hosted deployment, or deployed SHA verification has occurred. The E2E suite covers entry/auth layout only.

## Next bounded action

Read `AGENT_HANDOFF.md`, continue from the pushed combined commit, implement the missing Team 2 route packages against the existing contracts, wire the Team 1 proxy to `updateSession`, then obtain the dedicated Supabase/OpenAI/deploy configuration before applying a reviewed migration or claiming any live gate.

## 2026-09-26 continuation

- Henry has not selected the demo part. Keep the existing synthetic bend packets as explicit examples and avoid presenting them as Henry's chosen product.
- Team 1 continuation branch `codex/part-agnostic-foundation` adds `src/proxy.ts` for studio session refresh; connects the actual jobs page to job detail navigation; exposes Start job for designers/admins; preserves selected workspace in those links; and gives fabricators a distinct workshop jobs view with setup navigation. Code commit: `9581852`.
- `npm ci --prefer-offline --no-audit --no-fund` and `npm run check` passed on that commit: typecheck, lint, 24 Vitest files / 146 tests, and Next.js production build with Proxy detected. No real Supabase/OpenAI/deployment verification was performed.
- Next: Team 2 should complete the missing persisted job, draft, release, QR, question and flag routes. Team 1 then needs a live browser run through the connected workflow. The selected physical part and output artwork remain open decisions.
