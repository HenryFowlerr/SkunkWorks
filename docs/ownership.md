# Historical file and integration ownership

The three team assignments below ended when Henry stopped those agents. Current work follows [the product brief](product/overview.md), [build status](integration/status.md), and `AGENTS.md`.

The three workstreams share the single TypeScript Next.js application. The common contract and change process are in [the architecture](product/architecture-and-contracts.md) and [delivery protocol](integration/protocol.md).

| Owner | Exact paths and responsibilities |
| --- | --- |
| Team 1 | Root manifests, lockfile, framework/test/lint/format configuration, `.gitignore`, `.env.example`, root `AGENTS.md`, `.github/**`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, `src/app/error.tsx`, `src/app/not-found.tsx`, `src/proxy.ts` or middleware equivalent, `src/app/(studio)/**`, `src/app/(auth)/**`, `src/features/studio/**`, `src/features/workshops/**`, `src/features/review/**`, `src/features/print/**`, `src/components/ui/**`, `src/styles/**`, `src/lib/ui/**`, `tests/e2e/**`, `scripts/integration/**`, `docs/product/**`, `docs/integration/**`, `docs/ownership.md`, `docs/coordination/README.md`, hosting/deployment and combined verification. |
| Team 2 | `src/contracts/**`, `src/app/api/**`, `src/server/**`, `src/lib/api/**`, `src/lib/auth/**`, `src/app/r/[token]/route.ts`, `src/app/invite/[token]/route.ts`, `src/app/auth/callback/route.ts`, `supabase/**`, `scripts/backend/**`, `tests/contracts/**`, `docs/backend/**`; owns database migrations, RLS, auth, invitations, persistence, AI and server transitions. |
| Team 3 | `src/features/visualization/**`, `src/features/operator/**`, `src/app/(floor)/**`, `public/demo/**`, `public/wasm/**`, `tests/geometry/**`, `docs/visualization/**`; owns original sample assets, mapping editor, geometry, final model, phone flow and operator feedback UI. |
| Each team | `docs/coordination/team-N.md`, `docs/coordination/requests/team-N/**`, and co-located feature/server tests in its owned tree. |

Team 1 composes studio routes; Team 2 owns API routes; Team 3 owns floor routes. No two route groups may resolve to the same URL. Team 1 owns shared UI signatures, styling tokens, root configuration, npm installations and the lockfile. Other teams request shared-contract changes from Team 2, shared visual interface changes from Team 3, and dependency/config changes from Team 1 before editing them.
