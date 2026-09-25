# SkunkWorks contributor instructions

## Authority and product boundary

The product and engineering boundary are recorded in `docs/product/overview.md`, `docs/integration/protocol.md`, `docs/ownership.md`, and the current contracts in `src/contracts/` after Team 2 lands. Keep the numbered bend identity intact from source drawing through a published release and operator feedback. Do not claim inferred geometry, AI output, or manufacturing suitability as verified fact.

## Ownership

- Team 1 owns the root application setup, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`, shared UI, studio/auth routes, workshop/review/print features, CI, integration docs, and deployment.
- Team 2 owns `src/contracts/`, `src/app/api/`, `src/server/`, `src/lib/api/`, `src/lib/auth/`, `supabase/`, and backend verification.
- Team 3 owns `src/features/visualization/`, `src/features/operator/`, `src/app/(floor)/`, `public/demo/`, and geometry verification.
- A cross-owner change must be requested through `docs/coordination/requests/team-N/` and accepted in the target owner's own status file. Do not edit another team's status or feature paths.
- Team 1 alone updates package manifests, lockfile, shared root config, shared CSS/UI primitives, CI, and deployment config.

## Working rules

- Use `npm` and commit `package-lock.json`; pin every direct dependency.
- Keep server secrets out of browser bundles, source control, logs, and QR URLs.
- UI code calls only the typed same-origin API client. Do not access database tables directly from feature UI.
- Use immutable release snapshots and `expectedVersion` for mutable writes. Show actual server errors and do not convert fixture behavior into deployment success.
- Respect `docs/integration/protocol.md`: inspect before editing, use isolated worktrees, review diffs, merge current main, run relevant checks, and never force-push.
- Tests and checks are required when a task asks for verification. Record the exact command and outcome.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
