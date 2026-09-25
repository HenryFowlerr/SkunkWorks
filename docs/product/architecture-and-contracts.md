**SkunkWorks — architecture, ownership and shared contracts, version 1.0**

This is a proposed design for the verified empty repository. TEAM-1 is integration captain, not the sole implementer or sole person allowed to integrate verified work. TEAM-2 owns the authoritative runtime contracts. TEAM-3 owns the visual engine. Amend this design through the shared coordination protocol if current repository evidence justifies a change; do not independently fork it in three chats.

**One application, three substantive workstreams.**

Use one TypeScript Next.js App Router application with npm and a committed package-lock.json. Prefer CSS modules plus shared CSS tokens over a second styling abstraction. Supabase supplies Postgres, Auth and private object storage. Next.js route handlers expose a same-origin application API; UI code consumes one typed client and never reimplements domain logic or writes directly to database tables. OpenAI calls run only on the server. Three.js supplies deterministic diagrams and final-model viewing. Start with polling for cross-device issue updates; realtime subscriptions are an optional improvement.

Select compatible stable dependency versions when bootstrapping, pin the resolved choices and record the runtime. Do not invent version numbers in advance. TEAM-1 owns npm installs and lockfile changes for all teams. Initial requested dependencies: Next.js, React, React DOM, TypeScript, Zod, OpenAI SDK, Supabase JS and SSR packages, Three.js, qrcode, Vitest, Playwright, React Testing Library and their necessary types/tooling. A React Three Fiber wrapper is optional and must be requested before use. A PDF stamping library is optional; browser rendering of the source PDF and printing a separate QR label cover the initial journey.

Proposed hosting is Vercel for the Next.js app and a dedicated Supabase development project. Check available accounts before provisioning. Local database/auth/storage development is useful, but browser-local state is not the final persistence layer. Do not silently switch to a public bucket, in-memory API or static export to make deployment easier.

**Exact write ownership.**

Paths are repository-relative. Specific exceptions below override broader ownership. All otherwise unlisted paths require an owner assignment by TEAM-1 before edits.

| Owner | Paths and external responsibilities |
|---|---|
| TEAM-1 — designer experience and integration | Root package.json, package-lock.json, tsconfig, Next/test/lint/format config, .gitignore, .env.example, root AGENTS.md, README.md, .github/**, src/app/layout.tsx, src/app/globals.css, src/app/page.tsx, src/app/error.tsx, src/app/not-found.tsx, src/proxy.ts or middleware equivalent for the chosen Next version, src/app/(studio)/**, src/app/(auth)/**, src/features/studio/**, src/features/workshops/**, src/features/review/**, src/features/print/**, src/components/ui/**, src/styles/**, src/lib/ui/**, tests/e2e/**, scripts/integration/**, docs/product/**, docs/integration/**, docs/ownership.md, docs/coordination/README.md. Hosting/deployment configuration and combined release verification. |
| TEAM-2 — contracts, data and intelligence | src/contracts/**, src/app/api/**, src/server/**, src/lib/api/**, src/lib/auth/**, src/app/r/[token]/route.ts, src/app/invite/[token]/route.ts, src/app/auth/callback/route.ts, supabase/**, scripts/backend/**, tests/contracts/**, docs/backend/**. Database migrations, RLS, storage policies, authentication/invitation/session services, AI prompts/adapters and all state transitions. Supabase environment setup and migrations. |
| TEAM-3 — visual engine and floor experience | src/features/visualization/**, src/features/operator/**, src/app/(floor)/**, public/demo/**, public/wasm/**, tests/geometry/**, docs/visualization/**. Original demo drawings/models/manifests, panel/hinge editor, supplied-model view, swipe deck, contextual chat/flags/response view and mobile interaction. |
| Each team separately | docs/coordination/team-1.md, team-2.md or team-3.md; docs/coordination/requests/team-1/**, team-2/** or team-3/**. Only its own status/request files. Co-located unit/component tests within its owned feature/server tree. |

TEAM-1 owns page composition for studio routes, TEAM-3 owns floor routes and TEAM-2 owns API routes. No team may create a competing page or route handler at a URL owned by another team. There must not be two route-group pages resolving to the same URL. TEAM-1's auth proxy delegates to TEAM-2's exported session helper rather than copying authentication logic. TEAM-1 adds that import only when the helper exists and checks the installed Next.js version's proxy/middleware convention.

Source source-of-truth hierarchy: server state and schema → published contracts → feature code. Runtime schemas and TypeScript types live in src/contracts, with types inferred where practical. Frontend display DTOs do not expose Supabase row internals or Three.js objects. Database JSONB snapshots must validate against the same versioned schemas used by the API.

**Routes that each experience uses.**

| URL | Page owner | Purpose |
|---|---|---|
| / | TEAM-1 | Small purposeful entry with sign-in and clearly labelled original demo access. |
| /login, /signup | TEAM-1 | Real auth UI using TEAM-2 services; honest verification-required states. |
| /studio | TEAM-1 | Jobs, outstanding flags and create-job action. |
| /studio/jobs/new | TEAM-1 | Upload and setup selection. |
| /studio/jobs/[jobId] | TEAM-1 | Source review, shared diagram/editor, draft approval, issue responses and publication. |
| /studio/jobs/[jobId]/print/[releaseId] | TEAM-1 | QR label with identifiers and printable original drawing access. |
| /studio/workshops | TEAM-1 | Machinery inventory and versioned profile editing. |
| /r/[token] | TEAM-2 handler | Exchange release-scoped bearer link for a scoped session, then redirect to the floor URL. |
| /floor/[releaseId] | TEAM-3 | Guide, Model, Ask and Flags, all release-bound. |
| /invite/[token] | TEAM-2 handler | Read-only invite validation and safe redirect to sign-in/confirmation. Authenticated POST performs redemption. |
| /auth/callback | TEAM-2 handler | Complete provider confirmation, preserve a safe intended invite/job destination and verify the session. |

**Data conventions, fixed before parallel feature work.**

Use UUID strings for persisted entity IDs, ISO-8601 UTC timestamps, millimetres for geometry, degrees for angles and explicit mm-to-render scale conversion. Preserve original displayed units and precision from sources. Never treat a null value as zero. Source PDF pages are one-based, step array positions are zero-based in code, and the UI labels step numbers starting at one. Bend IDs such as B4 are stable user/source identifiers, not array positions. A drawing's external revision string is separate from an application's monotonically increasing release number.

All response payloads carry contractVersion: '1.0'. Success envelope: {data: T, meta: {requestId, contractVersion}}. Error envelope: {error: {code, message, fieldErrors?, retryable}, meta}. Codes include UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, VALIDATION_FAILED, VERSION_CONFLICT, UNSUPPORTED_ASSET, MAPPING_REQUIRED, REVIEW_REQUIRED, GENERATION_RUNNING, PROVIDER_UNAVAILABLE, PROVIDER_TIMEOUT, RATE_LIMITED and RELEASE_REVOKED. Use correct HTTP statuses; do not represent failures as 200 success data.

Mutable-resource requests use expectedVersion. A stale write returns 409 with enough information to reload, not a last-write-wins update. Creation/generation/publication/flag requests accept Idempotency-Key scoped to actor, operation and payload hash. Reusing a key with a different payload is an error. Publication and approval transitions happen atomically on the server. The AI may never set review actors, permissions, publication status or timestamps.

**Core DTO shape.**

The following signatures define the cross-team vocabulary. TEAM-2 turns them into concrete exported schemas, discriminated unions and fixtures before adding endpoints. Optional UI conveniences can be additive; changing these meanings requires coordination.

```ts
type Id = string;
type Vec2 = [number, number];
type Vec3 = [number, number, number];
type Role = 'admin' | 'designer' | 'fabricator';
type EvidenceRef =
  | {kind: 'document'; assetId: Id; page: number;
     region: [number, number, number, number] | null; excerpt: string}
  | {kind: 'workshop_note'; snapshotId: Id; machineId: Id; noteId: Id}
  | {kind: 'human_clarification'; recordId: Id};
type EvidenceState = 'supported' | 'conflict' | 'not_found' | 'unreadable';
type SourcedValue<T> = {value: T | null; evidence: EvidenceRef[];
  evidenceState: EvidenceState; originalText: string | null};
type Actor = {id: Id; displayName: string;
  kind: 'member' | 'release_visitor'; roles: Role[]};

type Asset = {id: Id; jobId: Id; releaseId: Id | null; kind: 'drawing_pdf' | 'model_glb' |
  'bend_manifest' | 'issue_photo'; filename: string; mimeType: string;
  byteSize: number; sha256: string | null; version: number;
  status: 'pending' | 'ready' | 'failed'; drawingRevision: string | null};

`sha256` is null while an upload is pending or has failed. A `ready` asset must have a valid 64-character hexadecimal digest computed by the server after verifying the stored bytes; the browser's claimed hash is not trusted. A published release may only reference ready, server-verified source assets.

type Machine = {id: Id; name: string; process: string; model: string | null;
  usableBendLengthMm: SourcedValue<number>;
  tools: {id: Id; name: string; specification: string | null;
    evidence: EvidenceRef[]}[];
  notes: {id: Id; text: string; confirmedBy: Id | null}[];
  approvedOrderConstraints: {beforeBendId: string; afterBendId: string;
    appliesToPartFamily: string; noteId: Id}[]};
type WorkshopSnapshot = {id: Id; workshopId: Id; workspaceId: Id;
  version: number; name: string; machines: Machine[];
  confirmedBy: Id | null; confirmedAt: string | null};

type Panel = {id: string; polygonMm: Vec2[]};
type Hinge = {id: string; parentPanelId: string; childPanelId: string;
  axisStartMm: Vec2; axisEndMm: Vec2};
type PanelModel = {schemaVersion: '1.0'; units: 'mm';
  thicknessMm: number; rootPanelId: string; panels: Panel[]; hinges: Hinge[];
  origin: 'authored_manifest' | 'reviewer_mapped' | 'ai_proposed';
  referenceFaceLabel: string; reviewed: boolean};
type Bend = {bendId: string; hingeId: string | null;
  finishedAngle: SourcedValue<{degrees: number;
    convention: 'internal' | 'external' | 'from_flat'}>;
  foldRotationDeg: SourcedValue<number>; // signed rotation from flat
  insideRadiusMm: SourcedValue<number>;
  directionText: SourcedValue<string>};
type Step = {id: Id; bendId: string; instruction: string;
  evidence: EvidenceRef[]; camera: {positionMm: Vec3; targetMm: Vec3} | null};
type Finding = {id: Id; kind: 'source_conflict' | 'missing_data' |
  'capability' | 'mapping'; severity: 'blocking' | 'review' | 'info';
  bendId: string | null; message: string; evidence: EvidenceRef[];
  disposition: 'open' | 'resolved'; resolutionRecordId: Id | null};
type MachineProposal = {id: Id; snapshotId: Id; machineId: Id;
  proposedBendOrder: string[]; rationale: string; evidence: EvidenceRef[];
  status: 'proposed' | 'accepted' | 'rejected'; decidedBy: Id | null};
type DraftContent = {sourceAssetIds: Id[]; workshopSnapshotId: Id;
  machineId: Id; panelModel: PanelModel | null; bends: Bend[];
  steps: Step[]; findings: Finding[]; machineProposals: MachineProposal[]};
type Review = {kind: 'design' | 'process'; actorId: Id;
  draftVersion: number; at: string};
type Draft = {id: Id; jobId: Id; version: number; content: DraftContent;
  reviews: Review[]; generationId: Id | null; inputFingerprint: string};
type Job = {id: Id; workspaceId: Id; title: string; partNumber: string;
  partFamily: string; version: number;
  workshopSnapshotId: Id | null; machineId: Id | null; sourceAssetIds: Id[];
  draftId: Id | null;
  latestReleaseId: Id | null; createdAt: string};
type Release = {id: Id; jobId: Id; revisionNumber: number;
  snapshot: DraftContent; sourceDraftVersion: number; reviews: Review[];
  publishedAt: string; publishedBy: Id; supersedesReleaseId: Id | null;
  allowPredecessorVisitors: boolean};
type ReleaseView = {job: Job; release: Release;
  sourceAssets: Asset[];
  replacementReleaseId: Id | null; canFollowReplacement: boolean; actor: Actor;
  permissions: {canAsk: boolean; canFlag: boolean; canRespond: boolean}};

`ReleaseView.sourceAssets` contains exactly the source assets named by `release.snapshot.sourceAssetIds`. The server resolves those IDs only within the same job; each returned item is a ready source asset (`releaseId: null`) with a server-verified digest. The DTO contains no storage path or bearer URL. The browser requests each authorized, expiring URL separately through `assets.getLink`.

type ContextRef = {jobId: Id; releaseId: Id | null;
  draftId: Id | null; draftVersion: number | null;
  stepId: Id | null; bendId: string | null};
type Answer = {id: Id; context: ContextRef; evidenceState: EvidenceState;
  text: string; evidence: EvidenceRef[]; suggestedFlag: string | null};
type Flag = {id: Id; context: ContextRef; question: string;
  photoAssetIds: Id[]; createdBy: Actor; version: number;
  status: 'open' | 'responded' | 'resolved'; createdAt: string;
  response: {text: string; authorId: Id; at: string;
    kind: 'explanation' | 'replacement_release';
    replacementReleaseId: Id | null} | null};
type Generation = {id: Id; jobId: Id; inputFingerprint: string;
  state: 'running' | 'succeeded' | 'failed' | 'expired';
  startedAt: string; expiresAt: string; draftVersion: number | null;
  errorCode: string | null};
```

ContextRef has exactly one of releaseId or draftId; draft context also requires draftVersion. Floor questions/flags always use releaseId. A step must belong to the cited draft/release and its bendId must match; the server looks this up rather than trusting a client label. Evidence regions, when present, are normalized x/y/width/height in [0,1] from the top-left of the PDF page. Absence means page-level citation, not an invented precise box. Document evidence must refer to an allowed source asset and existing page. A valid pointer alone does not prove semantic support; source review remains visible.

Each supported step performs one bend once. The array defines order; do not persist a competing stepNumber field. Each referenced bend has one hinge and a known, reviewed signed fold rotation. The fold angle and displayed finished angle are distinct values. Zero is valid only when supported; missing is null. Generating an unsupported angle is a blocking finding. Reordering changes order, not bend identity.

**Renderer and editor contracts, owned by TEAM-3.**

Export these from src/features/visualization/index.ts. They consume domain DTOs from src/contracts; never export a Three.js mesh as a domain DTO.

```ts
type SceneData = {panelModel: PanelModel; bends: Bend[]; steps: Step[]};
type BendSceneProps = {data: SceneData; completedStepCount: number;
  activeStepProgress: number; selectedBendId: string | null;
  interactive: boolean; reducedMotion?: boolean;
  onBendSelect?: (bendId: string) => void};
// completedStepCount is 0..steps.length. Progress is 0..1 for the next
// step, and must be 0 when all steps are complete.
declare function BendScene(props: BendSceneProps): React.ReactNode;
declare function ModelViewer(props: {assetId: Id;
  resolveAssetUrl: (assetId: Id) => Promise<string>;
  onError?: (message: string) => void}): React.ReactNode;
declare function BendMapEditor(props: {value: PanelModel | null;
  bends: Bend[]; onChange: (next: PanelModel, bends: Bend[]) => void;
  readOnly?: boolean}): React.ReactNode;
declare function evaluatePose(data: SceneData, completedStepCount: number,
  activeStepProgress: number): Record<string, number[]>;
// Matrix arrays are 16-number column-major transforms in the mm coordinate
// system. Implementation is pure and does not depend on DOM/WebGL.
```

All panel polygons are defined in a common flat XY plane with +Z toward the reference face. Hinge endpoints are in that same flat coordinate system. A child's transform is its parent's transform composed with the rotation about its hinge in flat coordinates; descendants inherit it. A tree is required: one root, one parent per non-root, no cycles or disconnected panels. Axis length must be nonzero and hinge endpoints lie on the intended shared panel edge within a documented tolerance. Validate finite coordinates, nondegenerate polygons and identifiers. Thickness is visual extrusion; radius/material deformation are not simulated. Label diagrams accordingly, and do not expose a precision measurement tool on the schematic.

Tests must prove subtree movement, order dependence, consistent bend IDs, signed rotation direction and boundary poses. At step n, the completed operations have full rotation and later operations are flat. Camera orbit must not change the reference-face convention or physical bend direction. A reduced-motion mode renders before/after poses without animation. Provide a visible fallback explanation on WebGL failure; the supplied drawing remains usable, but do not call the interactive model complete when it fails.

**API contracts and typed client.**

TEAM-2 exports one browser-safe api object from src/lib/api/client.ts. Its groups match the table below: auth, workspaces, workshops, jobs, assets, drafts, generations, releases, questions and flags. Methods take structured objects; names and parameter types are committed in the contract milestone. All mutations enforce server permissions, origin/CSRF rules and input validation. UI teams may use a test-only transport implementing the same signatures while endpoints are unfinished; it is never silently enabled in deployed production.

| HTTP operation | Client method / essential input → output |
|---|---|
| POST /api/auth/sign-up; POST /api/auth/sign-in; POST /api/auth/sign-out; GET /api/me | auth.signUp/signIn/signOut/me; credentials remain outside logs; me returns Actor and workspace membership. Signup may return verificationRequired. |
| POST /api/workspaces; POST /api/workspaces/[id]/invites; POST /api/invites/redeem | workspaces.create/invite/redeemInvite; role-bound copied invitation, explicit authenticated redemption and same-origin safe return. Admin controls membership. |
| GET /api/workshops?workspaceId=…; POST /api/workshops | workshops.list/create → workshop IDs/current snapshot. |
| GET /api/workshops/[id]; POST /api/workshops/[id]/versions | workshops.get/saveVersion({expectedVersion, machines, name}) → new immutable WorkshopSnapshot. |
| POST /api/workshops/[id]/versions/[snapshotId]/confirm | workshops.confirm → confirmed snapshot metadata; fabricator/admin only. |
| GET /api/jobs?workspaceId=…; POST /api/jobs; GET /api/jobs/[id] | jobs.list/create/get → Job or {job, assets, draft, releases}. |
| PATCH /api/jobs/[id] | jobs.updateInputs({expectedVersion, workshopSnapshotId, machineId, sourceAssetIds, partFamily}) → updated job; invalidates draft reviews. |
| POST /api/jobs/[id]/assets; POST /api/assets/[id]/complete | assets.uploadAsset is the browser orchestration wrapper. Prepare upload, upload privately using storage instructions, verify/finalize → Asset. UI supplies File and optional progress callback. |
| POST /api/releases/[id]/photos; POST /api/assets/[id]/complete | assets.uploadReleasePhoto({releaseId, file}) → Asset. Scoped visitors may upload only validated image photos for their release; they cannot upload/replace source drawings or models. |
| GET /api/assets/[id]/link | assets.getLink → {url, expiresAt}; authorise by job membership or the exact release's allowed assets. |
| POST /api/jobs/[id]/generate; GET /api/generations/[id] | generations.create({expectedJobVersion, idempotencyKey}); generations.get → Generation and resulting draft when complete. |
| POST /api/jobs/[id]/draft/from-release | drafts.createFromRelease({releaseId, expectedJobVersion, expectedDraftVersion: number or null}) → new current Draft copied from that same-job release, no reviews, incremented job/draft version. Reject if newer work would be overwritten without matching versions. |
| POST /api/jobs/[id]/clarifications; POST /api/jobs/[id]/draft/findings/[findingId]/resolve | drafts.recordClarification({text}) → EvidenceRef for an immutable human record; drafts.resolveFinding({expectedVersion, recordId}) → Draft after checking corrected content and applicable evidence, recording disposition, incrementing content version and clearing reviews. |
| GET /api/jobs/[id]/draft; PUT /api/jobs/[id]/draft | drafts.get/save({expectedVersion, content}) → Draft; server strips/rejects client review actors. |
| POST /api/jobs/[id]/draft/proposals/[proposalId]/decision | drafts.decideProposal({expectedVersion, decision: 'accept' or 'reject'}) → Draft. Fabricator/admin decides; acceptance applies the proposed valid order, records actor and clears reviews. Rejection records the decision and leaves the order unchanged. |
| POST /api/jobs/[id]/draft/reviews | drafts.review({expectedVersion, kind}) → Draft; actor recorded server-side and all review prerequisites checked. |
| POST /api/jobs/[id]/publish | releases.publish({expectedDraftVersion, supersedesReleaseId, allowPredecessorVisitors}) → Release. Same-job predecessor only. Atomic and idempotent. |
| GET /api/releases/[id] | releases.get → ReleaseView, including separately computed successor metadata. |
| POST /api/releases/[id]/follow-replacement | releases.followReplacement({replacementReleaseId}) → authorised successor ReleaseView. Visitor explicitly clicks; server verifies same-job published successor chain and publisher-enabled predecessor access, then extends the scoped session. |
| POST /api/releases/[id]/share-links; DELETE /api/releases/[id]/share-links/[linkId] | releases.createShareLink/revokeShareLink → {linkId, accessUrl} on creation; designer/admin only. |
| POST /api/questions | questions.ask({context, question}) → Answer. The server selects the applicable immutable evidence. |
| GET /api/flags?jobId=… or ?releaseId=…; POST /api/flags | flags.list/create({context, question, photoAssetIds, idempotencyKey}) → Flag list or Flag. Visitors can only query their release. |
| POST /api/flags/[id]/response | flags.respond({expectedVersion, text, kind, replacementReleaseId}) → Flag; authorised designer/admin. |
| POST /api/flags/[id]/acknowledge | flags.acknowledge({expectedVersion}) → Flag; records actor/event; it cannot amend release content. |

Small supporting metadata fields may be added during TEAM-2's contract milestone. Do not invent duplicate API endpoints in UI code. TEAM-1 print UI calls createShareLink and renders the returned URL into the QR; it never derives a guessable URL from jobId. Reprinting may issue another link for the same release; old links stay valid until explicitly revoked. Store hashes of bearer tokens, not their plaintext in general database records. Never put provider keys or private storage paths into QR payloads.

Draft save accepts editable content, not authority: server-owned proposal statuses, decidedBy fields, review metadata, resolved finding records and panelModel.reviewed cannot be forged through it. The server derives them from authorised decision/review records and resets them when dependent content changes. A finding is resolved through the clarification/resolve operations after corrected content is saved and validated. The record alone cannot bypass an invalid angle, missing mapping or contradictory unresolved instruction. AI-produced proposals start as proposed with no actor. Process-order constraints apply only when their stated part family matches; unknown applicability becomes a review finding.

An issue_photo asset has a non-null releaseId and belongs to its uploader's scoped session until attached to a permitted flag; source assets have releaseId null and are exposed to visitors only through the release snapshot's sourceAssetIds. Finalisation and flag creation verify all these relationships. An attached photo is readable by authorised members and visitors of that same release through its flag association, even though it is not in the immutable sourceAssetIds. Before attachment it is readable only by its uploader and authorised members. Unattached visitor photos are not a way to access other jobs or replace source evidence. Invitations are workspace/role-bound, expiring, single-use hashed tokens; redemption requires a verified signed-in user. Preserve the intended invite across login using a same-origin allowlisted return path, then revalidate expiry and permitted role on redemption.

**Database and permission design.**

TEAM-2 owns migrations and indexes. Minimum logical tables: workspaces, workspace_members, workspace_invites, workshops, workshop_versions, jobs, assets, drafts, draft_reviews, generations, releases, release_access_links, release_visitor_sessions, questions, flags, flag_responses, acknowledgements, review_notes and audit_events. Tables can be consolidated where it preserves invariants; do not add workflow engines or microservices. Immutable JSONB snapshots are appropriate for workshop versions and release content, with indexed relational ownership/job/version references. Add unique constraints for membership, workshop version, job release number and scoped idempotency keys; index foreign keys used for membership/job/release lookups.

Roles: admin manages workspace membership and may perform designer/fabricator actions; designer manages jobs, design review, publication, responses and sharing; fabricator manages/validates workshop context and process review. All signed-in members can inspect jobs in their workspace. A release visitor has only that release's shared assets, read view, contextual question/flag creation and acknowledgement; no draft, membership, profile edit, publication or designer response permissions. A typed name on a visitor flag is not verified identity. Use server-issued actor/session IDs and label visitors appropriately.

Enable RLS on exposed tables and scoped private storage policies. Server-side service credentials, if needed for token exchange/administration, stay server-only; explicitly check authorisation before any privileged query. Never use user-editable user_metadata as authority. Verify sessions using current Supabase guidance. Keep API row access and raw storage access equally scoped; a secure page with a public CAD bucket is not secure. Do not expose an unrestricted arbitrary-URL fetch endpoint for AI files. Uploaded documents are untrusted evidence, not instructions that can alter application permissions or make external calls.

QR token exchange sets an HttpOnly, appropriately SameSite, Secure-on-HTTPS scoped cookie and redirects away from the token URL. Do not log raw tokens. Use a restrictive referrer policy. The release visitor session is bound to the access-link ID so revocation is enforced on subsequent API and asset-link requests. Rate-limit unauthenticated AI/flag use. Demo access uses only original synthetic assets, never private customer material. Seed actual designer/fabricator accounts through a server-only script or secure account creation; do not ship a production role-switch dropdown that changes permissions on the client.

**Publication and correction invariants.**

Publication requires all source assets ready; valid panel topology; every step mapped; required angle/orientation values supported or recorded through an authorised clarification; no unresolved blocking findings; a confirmed selected workshop snapshot; and both design/process reviews matching the current draft version. Server validators are in src/contracts and src/server/domain, owned by TEAM-2. TEAM-3 proposes geometry-validator improvements through that owner and tests render correctness separately.

Draft.version is a content version. Recording a design or process review does not increment it or erase the other matching review; those records are separate. Every content edit clears both reviews. Publication locks/checks the content version and both review records atomically. Job inputs persist on Job; generation requires non-null selected workshop/machine and ready source assets. Draft.inputFingerprint must match the job's selected source checksums and setup snapshot before publication; changed inputs require reconciliation/regeneration and review. Generation records the input fingerprint and version; it must not overwrite a newer human-edited draft when it finishes. Existing released snapshots are immutable; the live replacementReleaseId is metadata computed separately. Profile updates never mutate them. Only the current release in a same-job release chain can be superseded without an explicit version-conflict response. Corrections create and review a new draft, then publish a successor atomically. Old issues stay tied to their original release. A publisher explicitly chooses whether predecessor QR holders may access the replacement; do not auto-grant successor access merely from a known ID. The floor shows a follow action only when allowed. The follow endpoint grants only the validated same-job successor and preserves revocation linkage to the original access link. Otherwise the designer supplies a separately issued authorised link. Never silently switch the displayed guide. An explanation response cannot change a dimension or operation silently; a technical correction is represented as a replacement release and linked to the issue.

**AI implementation boundary.**

Use a server-only OpenAI adapter with configurable OPENAI_MODEL and a verified model supporting the chosen inputs and structured outputs. PDF processing and schema-constrained output are documented capabilities, but schema-valid output is not engineering truth. No native STEP-to-bend-graph capability is assumed. A model call extracts/proposes semantic facts, captions, evidence and setup recommendations. The server combines those proposals with the actual mapped geometry; it rejects unknown IDs, missing evidence pointers, invalid units and invalid operation references. It records uncertainty rather than inventing requirements.

Separate document extraction/draft generation from contextual Q&A. Keep the demo packet small enough to pass directly rather than building a vector database. Include the source manifest, explicit job/version context and workshop snapshot. Disallow instructions inside uploaded files from overriding the application prompt. Return supported/conflict/not_found/unreadable classifications. Never let the model publish, approve, grant access, change documents, send email or claim a machine is safe to run. Preserve generation provenance, human corrections and the model identifier for debugging without logging secrets or full private documents.

Use a request-bound generation operation first: create a running record, await the provider within a configured timeout shorter than the hosting limit, validate and persist atomically, then return. Persist errors. Duplicate requests return the existing operation; a client may poll its record. Do not return 202 and rely on an unawaited promise in a serverless process. A stale running record becomes expired based on its lease and is retryable. If actual measured runtime exceeds hosting limits, TEAM-2 proposes a durable job runner to TEAM-1; do not hide it behind optimistic success. The mock provider is explicit and test-only. Live acceptance requires the real adapter.

**Bootstrap without blocking two teammates.**

TEAM-1 alone creates the first main commit if still empty: minimal runnable app, compatible dependencies, scripts, ownership map, coordination files and CI skeleton. It does not create another owner's feature implementations or types. Publish that seed promptly after basic build checks. TEAM-2 and TEAM-3 can inspect services, design schemas, prepare tests and original assets in scratch areas while waiting; they must not independently initialise unrelated main histories.

After the seed, TEAM-2's first merge is a small contract milestone: schemas/types, API client signatures, example fixtures and meaningful schema tests, plus a temporary typed transport that explicitly reports unavailable endpoints. No UI should be told those endpoints work. TEAM-3 first delivers a pure geometry evaluator, a sample manifest and the shared component interfaces. TEAM-1 can build controlled forms using the committed fixtures. All teams then replace test transports with the real API for end-to-end acceptance.

The first integrated milestone is modest but real: authenticated job creation → uploaded files stored → AI creates a draft → shared renderer shows its mapped part → reviews publish → phone retrieves the persisted release through QR. Add flags/responses and machine-proposal acceptance immediately after; that first milestone is progress, not the definition of final completion.
