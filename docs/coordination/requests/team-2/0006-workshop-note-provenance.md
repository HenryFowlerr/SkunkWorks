# Request 0006 — retain workshop note provenance

- Requesting owner: TEAM-1 (workshop setup UI).
- Target owner: TEAM-2 (shared DTO and API contract).
- Status: accepted by TEAM-1 on 2026-09-26; implementation is in the current Team 2 worktree, pending full review/check and integration.
- Affected contract: `Machine.notes` in `src/contracts/domain.ts`, workshop-version save DTOs, persisted workshop snapshots, and the workshop editor's display model.
- Current shape: `{ id, text, confirmedBy }` records who confirmed a note but loses who authored it, when it was added, and what source supports the documented claim.
- Requested additive shape: preserve existing fields and add `authorId: Id | null`, `createdAt: ISO timestamp | null`, and `source: { label: string; assetId: Id | null; page: number | null } | null`. Existing snapshots may use `null` for provenance they never stored. New notes should record the verified signed-in author and server timestamp; an asset/page reference, when supplied, must identify an authorized source document in the same workspace. `confirmedBy` remains a separate confirmation record.
- Reason: workshop notes influence sequence proposals and must remain attributable. A confirmation must not be mistaken for authorship or independent source evidence. The UI must show unknown legacy provenance as unknown and must not fabricate it.
- Compatibility: additive DTO fields require updates to schema fixtures, save validation, immutable snapshot persistence and readers. Existing saved JSON snapshots can be read with `null` provenance; clients that save a snapshot must include the new fields after the coordinated contract change.
- Validation: contract tests cover legacy null provenance, new author/timestamp capture, valid and cross-workspace source references, and confirmation remaining independent of authorship. Verify actual author comes from `auth.getUser()` and timestamp from the server, never client-supplied identity/time.
- Acceptance: TEAM-1 accepted the proposed shape exactly and recorded that acceptance in its status file. TEAM-2 now adds nullable legacy-compatible output fields, a write DTO without server-owned author/time/confirmation, database-side note stamping, and same-workspace ready-document validation.
