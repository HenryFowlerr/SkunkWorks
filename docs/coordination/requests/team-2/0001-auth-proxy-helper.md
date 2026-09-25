# Request 0001 — use the shared Supabase session helper

- Target owner: TEAM-1
- Affected file: `src/proxy.ts` (or the middleware equivalent for the pinned Next.js version)
- Requested change: import `updateSession` from `@/lib/auth/proxy-session` and return `await updateSession(request)` from the proxy.
- Reason: keep Supabase cookie refresh and server-verified session handling in TEAM-2's shared helper.
- Compatibility: additive; signature is `updateSession(request: NextRequest): Promise<NextResponse>`.
- Validation: run `npm run typecheck` after the integration.
- Status: TEAM-1 acknowledged and accepted. The Team 2 `updateSession(request: NextRequest): Promise<NextResponse>` helper remains in backend work-in-progress and is not part of the contract-only milestone commit; proxy integration follows once that helper is committed and merged.
