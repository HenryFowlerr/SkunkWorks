# Request 0001 — expose release source asset metadata to floor clients

- Target owner: TEAM-2.
- Affected contract: `ReleaseView` in `src/contracts/domain.ts`, `releases.get` in `src/lib/api/client.ts`, and the release read response.
- Proposed exact change: add `sourceAssets: Asset[]` to `ReleaseView`, populated only from the immutable release snapshot's `sourceAssetIds`. Include only those source assets and preserve `Asset.status` plus nullable `sha256` semantics. A `ready` asset must still have a valid server-verified digest; pending/failed assets may have `sha256: null`.
- Reason: the floor has the source IDs but not their kind, status, or filename. It cannot select the actual drawing PDF and final GLB or show truthful asset readiness using `assets.getLink`, which returns only a temporary URL and expiry.
- Compatibility impact: consumers of `ReleaseView` must accept the additional field. TEAM-3 will select the PDF/GLB by `kind`, show retrieval only for ready assets, and call `assets.getLink` only for the selected release asset.
- Validation: add/update strict schema and API-client fixtures for release reads with their exact source assets; reject missing, unrelated, or wrong-job assets. Verify pending/failed null hashes and ready valid digest according to request 0002.
- Status: delivered by TEAM-2 in contract commit `4a7cd0988ad7667d71c888e64e1cdd398cb7c878` and present on current main. Team 3 consumes `ReleaseView.sourceAssets` for source-asset selection.
