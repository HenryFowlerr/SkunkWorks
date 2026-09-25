# Release, floor question and flag route boundaries

These API routes use the v1.0 DTOs and standard `{ data, meta }` / `{ error, meta }` envelopes. `parseApiBody` enforces JSON content type and same-origin writes, and `handleApiOperation` adds `Cache-Control: no-store` and a request ID. Routes do not log visitor cookies, QR tokens, signed upload URLs, questions, or file contents.

## Visitor release access

- `/r/[token]` exchanges the QR bearer token on the server, sets the opaque visitor session cookie, then redirects to a URL without the bearer. The cookie is HttpOnly, SameSite=Lax and Secure on HTTPS.
- A visitor route reads that cookie through `readVisitorSessionToken`, then resolves the requested release or flag through a server-side resolver. The resolver checks the session expiry and revocation state, original access link, and exact release grant using database time. A present but revoked cookie does not fall back to member authentication.
- Release reads, flag lists, question and flag writes, acknowledgements, photo preparation, upload completion, and asset reads remain bound to the granted release. A release ID or client-provided job/workspace/asset scope grants no access.
- Replacement access is opt-in through `/api/releases/[releaseId]/follow-replacement`. The server adapter accepts only a direct same-job successor that explicitly permits predecessor visitors, and extends the current session grant while retaining the original link. Reads do not follow successors automatically.
- Share-link creation and revocation require an active designer role. Creation requires `Idempotency-Key`; the database stores the bearer hash, and the route returns the access URL once.

## Questions and evidence

- `/api/questions` validates the exact draft or immutable release context and canonical version before persisting. A visitor must present a release context that resolves to the same job and exact release as the live grant.
- Evidence comes only from the current job source allow-list for drafts or the immutable `release_assets` allow-list for releases. Each asset is authorized again for its actor and context; private bytes are loaded server-side and checked against stored size and SHA-256 before PDF text extraction.
- Grounded generation receives only extracted PDF page text and confirmed notes from the selected machine in the saved workshop snapshot. The provider output is schema/evidence validated, then persisted with the question ID and canonical context. A provider or validation failure leaves the persisted question unanswered and retryable; no placeholder answer is returned.
- Question creation requires `Idempotency-Key`. Repeating the same key with the same actor, context and question reuses the persisted question receipt; retrying an unanswered receipt re-runs grounded generation, and replaying a completed receipt returns its saved answer before evidence extraction or another provider call. Reusing a key with a different payload is rejected. Answer completion is idempotent for the same answer and model identifier.
- Visitor question insertion and the per-link question budget are one database operation. The route never accepts visitor identity, display name, or evidence IDs as proof of authority.

## Flags, responses and acknowledgements

- A flag must point to a canonical floor context for one immutable release. Member creation requires active workspace membership; visitor creation additionally requires the exact live session grant. Visitor flag budget consumption and insertion occur in the same database mutation.
- Flag creation requires an idempotency key. Attached photos must be ready issue-photo assets authorized to the same release and visitor session. Photo metadata preparation is idempotent and release-bound; the subsequent signed upload points to that one pending asset, and the common completion route revalidates the visitor session and asset scope before finalizing it.
- Designer responses require an active designer role. Repository mutation checks `expectedVersion`; replacement responses must identify a direct same-job successor under the database lock. Explanations cannot carry a replacement release.
- Visitor acknowledgements require a live grant for the flag's exact release and `expectedVersion`. The database records acknowledgements by actor and flag version, so retries are idempotent and acknowledgements never mutate release content.
- Visitors may list flags only through a one-release repository. Member filtering is performed through the caller's RLS-derived workspace repository.

## Upload recovery

The photo preparation endpoint returns the shared `ResumeAssetUploadResult` union after the repository creates or replays an idempotent pending photo record and the storage adapter confirms that the object belongs to that visitor session and release. `upload_required` carries a short-lived signed instruction; the client uploads it and calls `/api/assets/[assetId]/complete`. On a same-key replay, the storage adapter checks for an already-uploaded object: if present, it finalizes and returns `ready`; if absent, it returns a fresh upload instruction for the same pending asset. The finalizer is idempotent for an already-ready object with the matching digest.

Signed upload URLs are bearer capabilities until expiry. Keep their lifetime short, bind each URL to a unique private object path, prohibit upsert, and avoid returning them in logs or analytics. Visitor reads continue through server authorization so link revocation and release grants are checked on each read.
