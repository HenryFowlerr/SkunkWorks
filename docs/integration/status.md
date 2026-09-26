# Current build status

Updated 26 September 2026. This file is the concise handoff for any new SkunkWorks/Chappe coding or design chat. Read [the product brief](../product/overview.md) first. Older `AGENT_HANDOFF.md` and `docs/coordination/team-*.md` record stopped workstreams and should not be mistaken for current instructions.

## What exists

- Repository: `HenryFowlerr/SkunkWorks`, Next.js 16 / React 19 / TypeScript, Supabase auth, typed same-origin API client, OpenAI adapter, Three.js bend example.
- Public landing page now presents the broader Chappe manufacturing handoff, including review, selective guidance, QR/feedback, and sign-in/sign-up. Detailed branding remains a separate design task.
- Engineer studio, manufacturer equipment/profile view, review desk, print label, and operator phone screens exist. They do not all have live backing routes yet.
- Dedicated Supabase organization: `SkunkWorks` (free). Project: `Chappe`, ID `lzomgexzwxipbgdkgzbd`, region `ap-southeast-2` (Sydney), project URL `https://lzomgexzwxipbgdkgzbd.supabase.co`. Do not use the unrelated SipSaver project. The local checkout has ignored `.env.local` with project URL, publishable key, and server secret key; never commit or echo secrets.
- Initial schema and workspace/job RPC migrations were applied to Chappe on 26 September 2026. The repo contains matching files in `supabase/migrations/`. All public application tables have RLS enabled. Supabase's INFO notices for six server-only tables without policies are intentional; check after any schema change.
- Auth, workshop versions, source upload preparation/completion, workspace creation, job list/create/get/update, and authorized member asset link routes are implemented. The workspace creation route provides the first admin membership after sign-up.

## Verification on this slice

- `npm run check` passed on 26 September 2026: TypeScript, ESLint, Vitest, and Next production build.
- `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/skunkworks-playwright-browsers npm run test:e2e` passed 6/6 desktop and phone browser smoke checks for the landing and auth screens. These checks did not create a Supabase user or exercise the whole job lifecycle.
- A read-only service-key query against Chappe succeeded with zero workspaces. The initial schema and two additive RPC migrations applied successfully. Supabase security advisors reported only six INFO notices for intentional server-only tables without browser policies. Performance INFO notices report unindexed foreign keys and unused indexes; optimization is later work.

## What remains real work

- AI generation route and persisted draft lifecycle; explicit selective guide decision and engineer edit/approval; stronger facility/process feasibility review with documented evidence and unknown states.
- Invitation issuance/redemption, floor QR exchange, release publication/read/share, operator question/flag/response round trip, visitor asset access. The existing screens show endpoint-unavailable errors until those routes exist.
- OpenAI key/model are not configured. No live AI generation has been verified. The final demo product and output illustration design are undecided.
- Hosted deployment and public URL are not configured. Local tests do not prove the judge-accessible demo. The database password reset is with Henry in Supabase's open dialog; automatic review rejected the agent entering a new credential. The app uses API keys and does not need the direct Postgres password.

## Working rules

- Commit small coherent slices, run `npm run check` and focused browser checks, and update this status with **actual** outcomes. Open a PR for review, attach it to the Codex task, merge verified changes as Henry authorized, and keep `main` understandable for parallel chats.
- Treat [the product brief](../product/overview.md) as the current scope. Historical team assignments and the older bend-specific architecture are implementation history only.
- Keep all provider secrets server-side. Use a reviewed, immutable release; never silently replace a published guide. Maintain expected-version/idempotency and role checks in write routes.
- Do not claim arbitrary manufacturability or AI instruction accuracy. Surface documented conflicts and unknowns and require engineer approval.
