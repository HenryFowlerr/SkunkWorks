# Request 0002 — represent unverified asset hashes honestly

- Target owners: TEAM-1 and TEAM-3 for consumer review; TEAM-2 owns the contract change after acknowledgement.
- Affected contract: Asset.sha256 in src/contracts/domain.ts; upload preparation/finalization DTOs and fixtures.
- Proposed exact change: make sha256 nullable for pending and failed assets, with a schema refinement requiring a valid 64-hex digest whenever status is ready. The server computes and stores the digest only after verifying uploaded bytes. The upload preparation response continues to return only its upload instructions and asset ID.
- Reason: the server cannot know the uploaded file's digest before bytes exist. A client-supplied digest is untrusted until the server verifies the object. Assigning a placeholder digest would make the DTO false.
- Compatibility impact: consumers must handle sha256: null for pending or failed assets. Ready source assets in drafts/releases continue to have a verified digest.
- Validation: add schemas/fixtures for pending with null, failed with null, ready with a valid digest, and ready with a null or invalid digest; finalization computes the digest from the stored object.
- Status: TEAM-1 and TEAM-3 acknowledged and accepted. TEAM-2 implements the nullable pending/failed digest and ready-digest invariant in the v1.0 contract. The server-side digest verification/finalization remains separate backend work and is not claimed as delivered by the contract milestone.
