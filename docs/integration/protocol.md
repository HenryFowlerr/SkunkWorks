**SkunkWorks — shared delivery, Git and verification protocol, version 1.0**

This protocol is identical for all three workstreams. Their primary agents are responsible for their work even when subagents implement most of it. The task is to build and verify the product, not to finish by writing another plan. Respect current repository instructions and actual protection rules; coordinate changes when they conflict with this proposed structure.

**Start from current evidence and isolate writes.**

Each teammate inspects the repository, default branch, current commits, instruction files, manifests, deployment configuration and open coordination requests. Record the current origin/main SHA when one exists. Confirm the filesystem path and Git worktree identity; separate chats do not guarantee separate directories. Use a separate clone or supported isolated worktree and a workstream branch such as team-1/studio, team-2/platform or team-3/floor. Do not check out different branches in a shared working directory while another agent is writing.

If the repository is still empty, only TEAM-1 creates and pushes the first main commit. Other teams prepare bounded assets/specifications/tests in private scratch areas, then fetch the seed and create their branches from it. Do not independently create three root commits and later merge unrelated histories. If the seed appears while working, use it. Never reset away someone else's local work to obtain it.

TEAM-1 copies the agreed overview and protocol into its owned docs/product and docs/integration paths; TEAM-2 records the runtime contracts in docs/backend and src/contracts. TEAM-3 records geometry conventions in docs/visualization. The package is the initial contract, not permission to overwrite newer coordinated changes.

**Use the maximum useful parallel capacity actually available.**

All three primary agents must inspect the subagent tools and any exposed concurrency limits. Use the maximum permitted concurrent subagents whenever enough useful independent tasks exist. Do not assume a fixed number or confuse separate top-level chats with subagent capacity. Count nested workers against shared limits where the environment does. If capacity is unavailable or a spawn is rejected, report the limitation honestly and continue useful work; do not repeatedly retry the same unavailable slot or claim delegation happened.

Keep available slots occupied with bounded implementation, source investigation, tests, design refinement, edge-case checks and independent review as dependencies permit. Reassign freed capacity, integrate results continuously and continue useful work as the primary agent. Do not create redundant reviews or edits merely to reach an agent count. Subagents inherit their parent's ownership and cannot take another team's files.

Every delegation message must include objective, relevant product context, exact writable paths, contract version/interfaces, dependencies and prohibitions, expected deliverable, verification method and return format. Use disjoint paths in a shared filesystem. If isolation is supported, record the worktree/branch and deliberately integrate its diff. Subagents return changes and evidence to their primary; they do not push main, deploy, apply shared migrations or change dependency manifests on their own.

Required return format: summary; files changed; contract assumptions; commands/tests with outcomes; unresolved limitations; any requested cross-owner change. A completed subagent response is not proof: the primary reads the code, checks diffs, reruns relevant verification and integrates the work.

**Lightweight coordination across separate chats.**

Use repository files, not assumed chat visibility. Each primary owns docs/coordination/team-N.md with: timestamp; workstream branch; latest delivered commit; contract version; working capabilities; verification commands/results; next bounded task; blockers; required changes from another owner. Each team creates requests only under docs/coordination/requests/team-N/. A request names an ID, target owner, affected files/API, proposed exact change, reason, compatibility impact and validation. The target owner acknowledges/decides in its own status file using that ID; the requester can then update its request. Nobody edits another team's status file.

Fetch and read the three status files at startup, before integration and whenever a dependency blocks progress. Commit requests in a small coherent change or provide a feature-branch SHA so other chats can inspect them. A request needing immediate attention can also be handed to the human teammate as a concise message. Do not assume an idle chat will wake automatically. Do independent work while waiting.

Contract changes belong to TEAM-2, shared dependency/configuration changes to TEAM-1, shared visual component changes to TEAM-3. Send the responsible owner a concrete requested patch/interface, not a vague request to “fix integration.” The owner adopts it in its own change. If an owner is absent and the team authorises reassignment, record the ownership transfer before anyone else writes those files. A delayed teammate is not permission to silently seize its domain.

**Integration to main: a concrete repeatable sequence.**

1. Finish a small coherent unit on the isolated workstream branch. Read git status and the diff. Stage explicit owned paths only; inspect the staged diff for unrelated files, generated secrets and accidental removals. Commit with a concise behaviour-focused message. Subagent changes must already have been reviewed.
2. Ensure the working tree is clean or deliberately preserve unfinished work in a separate local commit/branch. Do not stash unknown shared work, discard changes or use destructive reset/clean commands.
3. Fetch origin. Integrate current origin/main into the workstream branch using an ordinary merge. Resolve conflicts deliberately and involve the other owner for its code. A clean merge does not establish semantic compatibility.
4. Install the committed dependency set with npm ci. Run npm run check, relevant component/domain tests and the applicable end-to-end checks against the merged state. The scripts must actually run meaningful checks; skipped tests and unavailable credentials are reported as unverified, not passing.
5. Inspect the final diff against origin/main and verify the change stays within ownership plus already coordinated amendments. For direct integration, use an ordinary non-force push of the verified branch HEAD to main. If protection requires a PR/check workflow, push the workstream branch, create/update the PR, satisfy required checks and use the permitted merge mechanism. Never weaken protection. Attach a created PR to the Codex task when the environment provides that tool.
6. If a direct push is rejected because main advanced, fetch the new main, merge again, inspect conflicts and rerun the checks affected by the combined changes. Then retry an ordinary push. Do not force-push and do not blindly repeat without integrating the winner's work.
7. Fetch after delivery and verify that the intended commit is an ancestor of origin/main. For squash/PR merges, verify the resulting PR merge commit and inspect the resulting files because the original branch SHA may not be an ancestor. Record the delivered commit, checks and any deployment URL in the team's status/handoff.

Illustrative direct-integration commands, used only after staging/committing and confirming a clean owned worktree:

```sh
git fetch origin
git merge --no-edit origin/main
npm ci
npm run check
# Run relevant real-service and browser checks described below as well.
git diff --stat origin/main...HEAD
git diff --check
delivered_sha=$(git rev-parse HEAD)
git push origin HEAD:main
git fetch origin
git merge-base --is-ancestor "$delivered_sha" origin/main
```

A nonzero result is investigated, not ignored. The initial empty-repository seed is the only case without origin/main to merge; TEAM-1 verifies the branch is genuinely absent before creating it. Main is never force-pushed. Rebasing an unpublished private branch can be acceptable, but this protocol uses merges to avoid rewriting work already shared with teammates.

Database work is also coordinated: TEAM-2 alone manages migrations and applies them to the selected shared environment. Prefer additive migrations during the weekend. A local migration passing does not prove the deployed database has that migration. TEAM-1 checks the deployed schema/application combination with TEAM-2 before the final demo. Do not run destructive resets against the shared project or production data.

**Time-boxed milestones, not permission to stop early.**

| Target | TEAM-1 | TEAM-2 | TEAM-3 | Evidence |
|---|---|---|---|---|
| First 30–60 minutes, adapt to actual start time | Minimal runnable seed, ownership, scripts, deployment attempt. | Contract/permission design and service access inspection; after seed, contract-only commit. | Original sample asset plan, geometry tests and component API design. | Shared main exists; basic build runs; dependency blockers are explicit. |
| First integrated session | Intake/review wired to API and shared scene. | Real assets, generation, drafts, reviews, publication and scoped release read. | Actual poses/model view and floor route using release DTO. | Upload → real AI draft → reviewed illustrated release → second-device retrieval. |
| Next session | Workshop editor, machine proposal review, designer issue response, print. | Machine context, Q&A, flags/responses and version transitions. | Phone chat/flags/response state; mapping/editor completion. | Machine input changes proposal; flag crosses devices and receives response. |
| Final build period | Full E2E, deployment, pitch rehearsal and responsive polish. | Negative/security/concurrency cases, provider failure, migration checks. | Geometry variation, touch/browser/reduced-motion and performance checks. | All essential requirements demonstrated on hosted build; no mocked completion claims. |

Deploy early and keep the combined app buildable. After essential work passes, freeze discretionary dependencies and contracts. Fix failures and material UX problems before adding optional features. Never interpret these target times as measured implementation estimates or a guaranteed schedule.

**Verification that proves the actual product.**

TEAM-1 owns the complete browser scenario and final evidence index in docs/integration/verification.md. TEAM-2 and TEAM-3 supply their evidence and fix failures in their owned modules. TEAM-1 does not substitute its own fake backend or renderer to get a green E2E run.

| Gate | Owner/evidence |
|---|---|
| G1 Build and contracts | TEAM-1 check script runs type checking, lint, unit/contract tests and production build. TEAM-2 fixtures validate against the committed schemas. All three consume the same types. |
| G2 Geometry is genuine | TEAM-3 pure tests cover hierarchy, signed rotations, order changes and invalid topology. Browser inspection shows distinct intermediate poses. A second geometry/input variation changes the result. |
| G3 AI is real and grounded | TEAM-2 runs the live provider on the supplied original drawing; changing a supported source fact changes the draft. Missing/conflicting evidence is not invented. Unknown IDs and malformed output are rejected. The mock transport is disabled in this path. |
| G4 Machine awareness works | Change a confirmed setup constraint/profile version; show a corresponding source-linked proposal and accepted sequence. Published old content remains unchanged. An unsupported equipment inference is shown as unknown. |
| G5 Publishing and revisions | Both required reviews match the draft version; edits invalidate them. A stale save/publish returns 409. A successor preserves its predecessor and old QR history. Parallel publish retries do not create duplicate releases. |
| G6 Paper-to-phone | Scan a printed or displayed real QR on another device/session. Load the persisted issued release, source references and interactive guide. This cannot depend on designer localStorage. |
| G7 Completed communication | Phone flag stores the actual step/bend/release; designer responds on desktop; phone receives the persisted response. Optional photo, if presented as shipped, is really uploaded and retrievable with correct access. |
| G8 Permissions | Unrelated workspace user cannot read job/assets; QR visitor cannot edit draft/profile, approve, publish or answer as designer. Revoked token/session fails. No service/provider secret is in a client bundle, repository or logs. |
| G9 Failure/recovery | Unsupported model, missing mapping, failed upload, provider timeout/unavailable, interrupted generation, network loss and repeated flag submission have honest states and recoverable behaviour. No success toast precedes persistence. |
| G10 Hosted combined state | Correct environment, deployed migration version and current code SHA; real AI, private storage, source URLs and cross-device flow work on the hosted domain. Authentication redirects use that domain. |

Automate deterministic domain, permission and state-transition checks. Use browser tests for the central flow and meaningful human inspection for visual fidelity. Record actual commands, SHA, environment, outcome and unresolved limitations. A recording is useful backup evidence, not a replacement for the required live demonstration. If service credentials are unavailable, complete code and local verification but leave live-service gates unverified and report the specific prerequisite.

Recommended npm script contract, owned by TEAM-1: dev; build; lint; typecheck; test (non-watch); test:e2e; check (typecheck + lint + unit/contract tests + build). Optional test:live is clearly marked as requiring real service credentials and its skip is not a pass. Each teammate contributes tests in its owned paths. Do not spend scarce time on tests that merely duplicate implementation or cosmetic details while a core integration remains untested.

**Five-minute demo plan and truthful boundaries.**

Use one original synthetic part with three to five straight bends, a matching PDF, GLB and reviewed manifest. TEAM-3 creates the geometry and assets; TEAM-1 owns their readable drawing presentation and stage narrative through coordination, without editing TEAM-3-owned originals. TEAM-2 ensures real processing and persistence. A second variant changes at least one dimension or signed bend value and one sequence, exercising the actual renderer/model pipeline.

Spend about 45 seconds explaining the prototype handoff, 150 seconds on upload/review/QR/guide, 60 seconds on the flag and response, 30 seconds on actual AI/equipment context and 15 seconds on the next validation step. Rehearse to fit the official five minutes, leaving the three-minute Q&A separate. Source upload/generation timing should be measured. If a pre-generated release is used to save time, label it and still show a real live action; do not disguise cached results as a new generation.

Say what is authored geometry, what is AI-proposed, what a human reviewed and what remains unsupported. The prototype does not simulate a press brake or certify manufacturability. The panel renderer is a controlled diagram engine, not a material-deformation solver. Prepared original example data is acceptable; fabricated customer adoption is not.

**Final workstream handoff.**

Each primary reports: delivered capabilities; remote commit/PR and deployed URL where applicable; exact checks with outcomes; changes to public contracts; file ownership respected; live versus mocked/fixture behaviour; remaining missing gates; and the next owner's required action, if any. Update its coordination file. Finish only when its explicit acceptance gates are evidenced. The overall product is complete only after TEAM-1's combined verification confirms all essential functionality, with TEAM-2 and TEAM-3 fixing their failures. Do not claim full completion because a branch builds or a landing page loads.

**Sources and verification limits.**

The private repository was inspected through the connected GitHub API: [repository](https://github.com/HenryFowlerr/SkunkWorks). Its emptiness is an observation at package preparation, not a permanent assumption. The exact competition requirements came from the [participant docs](https://www.saasathon.dev/docs), read successfully in the browser earlier in this task.

For implementation, consult the current official [OpenAI file-input guide](https://developers.openai.com/api/docs/guides/file-inputs) and [structured-output guide](https://developers.openai.com/api/docs/guides/structured-outputs); verify model/account compatibility rather than assuming a name. Harness-provided delegation should be used when available; do not build an in-product multi-agent platform merely because the coding process uses subagents.

The proposed Supabase setup follows the official [SSR client guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [storage access-control guidance](https://supabase.com/docs/guides/storage/security/access-control) and [changelog](https://supabase.com/changelog), inspected during preparation. The markdown changelog endpoint was unreadable through the web tool; its HTML counterpart was read. TEAM-2 must verify the chosen versions' exact APIs before implementation.

Rendering/import choices refer to [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html); the application structure refers to [Next.js route handlers](https://nextjs.org/docs/app/getting-started/route-handlers). A file-loader capability is not a semantic CAD-unfolding capability.

Industrial context: [SOLIDWORKS bend tables](https://help.solidworks.com/2024/English/SolidWorks/sldworks/c_Bend_Tables.htm) already contain bend identifiers and parameters; [Delem Profile-T](https://www.delem.com/en/solutions/offline-software/profile-t/profile-t) advertises sequencing and collision checks; [Bystronic](https://www.bystronic.com/usa/en-us/news/240220-press-brake-essentials) describes tooling-dependent forming concerns. These explain the boundary around this prototype. They do not establish its customer demand or expected savings.
# Historical coordination protocol

The three-team ownership process below belonged to stopped agents. For current work, use [the product brief](../product/overview.md), [build status](status.md), and `AGENTS.md`. Keep its safe Git/review principles, but do not wait for absent team owners.
