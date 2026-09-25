# Request 0003 — include authorized source metadata in ReleaseView

- Target owner: TEAM-1 for the architecture DTO reference; TEAM-2 owns the runtime contract and endpoint implementation.
- Affected files: `src/contracts/domain.ts`, `tests/contracts/**`, `docs/product/architecture-and-contracts.md`, release GET/follow handlers when implemented.
- Requested exact shape: add required `sourceAssets: Asset[]` to `ReleaseView`. Resolve only the same-job assets whose IDs are in that release snapshot's immutable `sourceAssetIds`; each must be a ready source asset with `releaseId: null` and a server-verified digest. Keep private storage URLs out of this DTO; `assets.getLink` remains separately authorization-checked.
- Reason: the phone needs filename and kind to select the supplied drawing PDF or GLB before requesting a private asset URL.
- Compatibility: additive to the shared v1.0 contract before endpoint implementation; consumers must read `sourceAssets` from the current schema. Pending/failed hashes remain nullable under request 0002, but only ready hashed source assets can appear in a published `ReleaseView`.
- Validation: schema tests check exact asset-ID matching, job ownership, source scope, readiness, and digest; client tests assert the release endpoint uses `ReleaseView`.
- Status: TEAM-1 accepted the additive field and security constraints; TEAM-3 requested the field and will consume it. Team 1's architecture reference still needs to be updated in its owned docs path.
