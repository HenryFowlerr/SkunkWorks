# Engineer and manufacturer workflow review

26 September 2026 · branch `codex/workflow-ux` · builds on the native-source and AI-prompt work in `codex/part-knowledge-ai`.

## Product contract

Henry's latest directions govern this review: one evolving knowledge base per part, a stable part QR, engineer-approved answers, manufacturer phone priority, and no required formal CAD revision ceremony. The workflow PDF was described in the conversation but is not attached to this checkout; its described main and side flows are used, without inventing additional requirements. The supplied originals are two products, each with one `.SLDPRT` and one `.SLDDRW`. A cached image is source context, not a dimensional specification.

## Findings and implementation

| Finding | User consequence | Change |
|---|---|---|
| Authenticated manufacturers entered engineering-oriented jobs/review screens | Unclear what to read versus edit | Dedicated manufacturing list, handoff and equipment routes; legacy fabricator job URLs render the handoff |
| Engineer and manufacturer navigation lacked a clear top-level boundary | Users could mistake setup work for engineering approval | Explicit Engineering / Manufacturing work areas with separate side navigation |
| Public demo put the equipment form ahead of received work | Repeat visitors had to pass onboarding to reach a part | Work-first manufacturer page; equipment moves to its own hash route |
| Review desk lacked a concise workflow overview | Sources, missing drawing exports, approval and questions were difficult to scan | Four-part progress summary and task section links |
| Part requirements and facility facts were scattered | Manufacturer could confuse part intent with machine evidence | Part specification list, approved operation requirements, facility/setup evidence and question history together |
| Job search was missing | Growing part lists were hard to navigate | Search by part title or number on both lists |
| Switching workspace preserved a job URL | URL could point at the previous workspace's part | Switch goes to the selected work area's root; part handoff also checks workspace identity |
| Facility editor hid controls from admins allowed by the API | Admins could not perform an already permitted action | Admin and fabricator receive equipment management controls; designer remains read-only |
| Answers from older approvals lacked an obvious applicability label | Historical advice might look current | Each report states current or earlier/unapproved guidance context |
| Public file picker omitted SolidWorks drawings | One of Henry's actual source formats was rejected | `.SLDDRW` is accepted for local filename drafts; no parsing claim |

## Page map and expected next action

| Page | Purpose / next action |
|---|---|
| `/studio` | Engineering part list → add or open part |
| `/studio/jobs/new` | Pair each product's drawing and model → retain originals and select facility |
| `/studio/jobs/:id` | Inspect source → check documented facility requirements → review AI proposal → explicitly approve → answer floor questions |
| `/studio/workshops` | Engineering reference view of facility evidence; role controls still apply |
| `/studio/manufacturing` | Find a visible part → inspect its handoff |
| `/studio/manufacturing/jobs/:id` | Check approval, specifications and setup evidence → open phone view |
| `/studio/manufacturing/equipment` | Record and confirm equipment facts if role permits |
| `/parts/:id` | Stable, signed-in phone destination → current approved knowledge, or retained previews while approval is pending |
| Public `#/manufacturer` | Prepared example handoff and questions |
| Public `#/manufacturer/equipment` | Prepared capability evidence and local onboarding draft |

Engineering and Manufacturing are distinct routes. Workspace role remains the permission boundary: navigation does not grant additional editing rights. A fabricator's legacy engineering-list/detail URL leads to manufacturing content. Public Pages routes are separate demo screens, not the authenticated application's database-backed routes.

## Specifications and evidence

- Part identity comes from the job record.
- Operation angle, radius and direction come only from the current approved snapshot, preserving supported/conflict/unknown labels. No draft steps are rendered as manufacturing instructions.
- The selected machine and facility must match the approved snapshot when one exists. If that saved facility version is no longer in the current profile list, display unavailable evidence instead of silently substituting the latest profile.
- Material and tolerances are explicitly not extracted; refer to an approved readable drawing. Before approval, the UI says that an approved drawing is awaited.
- Tool names are recorded profile facts. They do not establish tooling reach, clearance, collision freedom or manufacturing suitability.
- Floor reports retain approval and operation context. A response does not automatically remove an operation hold.
- The AI prompt implementation remains versioned: guide proposal, floor question and engineer reply draft. AI suggestions require explicit engineer action before becoming approved answers.

## Walkthroughs

Engineer: create one record for Engineering test block and another for manufacturing test sheet; attach each native pair. View cached source images, supply/obtain readable drawing and model exports when conversion becomes available, select confirmed facility evidence, review the generated proposal and its citations, resolve missing facts, approve the intended guidance, share the stable part QR, and approve replies to later floor questions.

Manufacturer: open Manufacturing, find the part, inspect approval and selected setup, open the phone view, choose the relevant operation, ask or flag with that context, and read the engineer's applicable reply. Equipment editing is a separate occasional task. Workspace visibility alone is not a work order or facility acceptance.

## Remaining product gaps

| Priority | Gap | Required outcome |
|---|---|---|
| Before a real two-part demo | Native drawings/models provide cached images only | Authorized CAD conversion or readable exports; retain provenance and validate extracted facts |
| Before external multi-user use | Hosted Next application, configuration and pending database migrations are not verified in this work | Deploy/configure and test real sign-in, private upload, approval and phone access |
| Before facility-specific sharing | Membership is workspace scoped | Implement explicit facility assignment and least-privilege invitations; do not imply existing list visibility is a received order |
| Before anonymous QR sharing | Stable native-part route requires membership | Define and implement the intended recipient-access policy |
| Before claiming broad manufacturing support | Detailed records and guidance remain bend-oriented | Model the test block's actual machining specifications from readable evidence; do not pretend bend fields cover machining |
| Workflow follow-up | Questions require approved floor context; photo/voice support remains incomplete | Define pending-part questions and supported attachment/input paths, then test persistence |
| Facility history usability | API list exposes current facility snapshots | Add authorized historical snapshot retrieval if the manufacturer needs to inspect exact older evidence in this page |

## Design and verification

Uses the canonical working-product pattern: compact toolbar, distinct work areas, flat rows, contextual sections, specification lists, contained tables and phone stacking. Existing `--ch-*` colours, spacing and status tokens and shared Button/Panel/Field/StatusBadge components are reused. Panel gains an optional anchor ID. No new palette or token family.

Validation: TypeScript, ESLint, 291 unit/component tests, production build; six existing entry/auth desktop/phone browser tests. New tests cover workspace filtering, search, dedicated handoff URLs, hiding draft requirements, missing historical facility evidence, mismatched workspace rejection and dropping the old part URL when switching workspace.

Visual checks use the actual React components with fixture API responses, not a live signed-in database session. Desktop, narrow desktop and phone widths are 1440, 900, 390 and 320px. Static demo checks block external service calls, confirm the profile form is on its own route, and check 1440/390/320px. Screenshots are local review artifacts. They demonstrate layout, not successful live upload or AI generation. Existing end-to-end tests cover entry/auth; they do not prove the complete manufacturing transaction.
