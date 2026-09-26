# Chappe contributor instructions

## Authority and product boundary

Read `docs/product/overview.md` for Henry's current product brief, then `docs/integration/status.md` for what is working and what remains. The older team-specific instructions in `docs/coordination/` and `docs/ownership.md` describe stopped workstreams; they are historical context, not current ownership assignments. Use `src/contracts/` for the implemented API vocabulary. Do not claim inferred geometry, AI output, or manufacturing suitability as verified fact.

## Working rules

- Use `npm` and commit `package-lock.json`; pin every direct dependency.
- Keep server secrets out of browser bundles, source control, logs, and QR URLs.
- UI code calls only the typed same-origin API client. Do not access database tables directly from feature UI.
- Use immutable release snapshots and `expectedVersion` for mutable writes. Show actual server errors and do not convert fixture behavior into deployment success.
- Inspect current main before editing, use isolated branches/worktrees, review diffs, run relevant checks, and never force-push. Keep `docs/integration/status.md` current so other chats have a truthful handoff.
- Tests and checks are required when a task asks for verification. Record the exact command and outcome.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
