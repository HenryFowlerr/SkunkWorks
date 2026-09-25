# Request 0006 — dedicated server token pepper

- Target owner: TEAM-1.
- Affected files: `.env.example` and the shared deployment/runtime secret configuration.
- Exact change: document a server-only `SUPABASE_TOKEN_PEPPER` secret (no `NEXT_PUBLIC_` prefix) and provide it to the application runtime as a stable random secret. TEAM-2 currently falls back to the server-only `SUPABASE_SERVICE_ROLE_KEY` if this dedicated value is absent.
- Reason: invitation and QR bearer URLs are derived deterministically from a scoped idempotency key so retried create calls can return the same URL, while the database stores only the SHA-256 token hash. A dedicated pepper avoids coupling token validity to service-role-key rotation.
- Compatibility: additive server environment variable; no public DTO or API change.
- Validation: confirm the secret is configured on local/hosted runtimes without exposing it in browser bundles or logs; rerun typecheck/build after updating the environment example.
- Status: open pending TEAM-1 acknowledgement.
