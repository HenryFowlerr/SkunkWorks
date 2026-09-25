# Backend contract milestone

Version 1.0 DTOs and runtime validators are exported from `src/contracts`. They are the shared boundary between the browser, route handlers, persisted snapshots, and Team 3's geometry/floor work. The browser client exports `api` and `createApiClient` from `src/lib/api/client.ts`; method inputs and outputs are inferred from the shared schemas.

## Trust boundaries

- API responses use `{ data, meta }` or `{ error, meta }`. `meta.contractVersion` is exactly `1.0`; error codes on the wire are restricted to `ApiWireErrorCodeSchema`.
- `ENDPOINT_UNAVAILABLE` is local client state. It is deliberately excluded from wire error envelopes. The default `api` currently uses `unavailableApiTransport` and rejects every request and upload; this contract milestone does not provide working service routes or pretend fixture-backed success.
- Mutating methods with an idempotency key send it in the `Idempotency-Key` header and omit it from the request body. Expected-version values stay part of the typed request body.
- Draft write schemas omit server authority fields such as `panelModel.reviewed`, proposal decisions, and finding resolution metadata. Server transitions must derive those fields from authenticated records.
- `Asset.sha256` may be `null` while pending or failed. A ready asset requires a valid 64-character hexadecimal digest. Upload preparation returns only the asset ID and short-lived upload instructions; the server verifies stored bytes and computes the digest during completion.
- Panel/hinge geometry uses millimetres, a single connected acyclic panel tree, unique IDs, nonzero simple polygons, and hinge axes following the corresponding parent and child polygon edges within 0.5 mm. Finished angle and signed fold rotation are separate values.
- Context references identify exactly one draft version or immutable release. Flags are release-scoped and their response/replacement fields must agree with state.
- `ReleaseView.sourceAssets` contains the metadata for exactly the IDs in that release snapshot's immutable `sourceAssetIds`. Each entry must be a ready source asset belonging to the same job, with `releaseId: null` and a verified hash. The route must resolve only those IDs after authorizing the release. This metadata allows the floor to select the supplied PDF or GLB; each file URL is separately authorized through `assets.getLink`.

## Browser API surface

The client groups methods under `auth`, `workspaces`, `workshops`, `jobs`, `assets`, `generations`, `drafts`, `releases`, `questions`, and `flags`, following the route table in `docs/product/architecture-and-contracts.md`. Team 3's shared floor calls are:

```ts
api.releases.get({ releaseId }): Promise<ReleaseView>
api.assets.getLink({ assetId }): Promise<AssetLink>
api.questions.ask({ context, question }): Promise<Answer>
api.flags.list({ jobId } | { releaseId }): Promise<Flag[]>
api.flags.create({ context, question, photoAssetIds, idempotencyKey }): Promise<Flag>
api.flags.acknowledge({ flagId, expectedVersion }): Promise<Flag>
```

`ReleaseView` includes `sourceAssets` metadata for the published snapshot's authorized source asset IDs; it does not include private storage URLs.

`assets.uploadAsset` and `assets.uploadReleasePhoto` orchestrate prepare → private upload → server completion, with optional progress callbacks. They do not calculate or submit trusted checksums from browser input. `ApiTransport` is injectable for contract tests; it is not a persisted browser mock or enabled production fallback.

## Verification

Contract tests live in `tests/contracts`. They validate representative workshop, asset, geometry, draft, release and flag fixtures; geometry topology and edge constraints; cited evidence bounds; server-owned draft fields; revision review matching; asset scope/hash state; release/draft context consistency; generation state; envelopes; client route signatures; idempotency headers; upload order; response validation; and explicit unavailability. Run `npm test -- --run tests/contracts` with the application's `@/` alias configured by Vite/Vitest.

Until route handlers, database migrations, storage policies, and credentials are integrated and verified, these DTOs and client signatures are contracts only. Do not claim live persistence, AI generation, private storage, or cross-device behavior from this milestone.
