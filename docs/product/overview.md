**SkunkWorks — full project understanding, version 1.0**

Prepared 25 September 2026 for Henry Fowler's three-person SaaSathon team. “SkunkWorks” is the repository/project identifier, not a confirmed public brand. This document, ARCHITECTURE_AND_CONTRACTS.md and COLLABORATION_AND_VERIFICATION.md are the common specification. Each TEAM-N.md contains that common material plus exactly one team's execution instructions, so it can be pasted into a fresh Codex chat by itself.

**The product we are actually building.**

Designers and engineers create one-off R&D sheet-metal parts. They have a 3D model and technical drawings with numbered tabs/bends. They upload those files, choose the receiving workshop and obtain an AI-assisted, short visual guide to forming the part. A person reviews the interpretation before publication. The system creates a QR code that goes on the existing paper drawing. A fabricator scans it on a phone, swipes through a small number of illustrated steps, inspects the 3D model, asks contextual questions and flags a confusing bend. The designer receives the exact context and responds; that resolution returns to the operator.

Manufacturers maintain a machinery/capability inventory. The selected equipment, tooling information and workshop notes influence the draft guide and any proposed step changes. This is part of the working product, not an inert settings page. A profile is reusable across jobs; the job records which version and setup it uses.

The core promise is: **the same numbered bend remains understandable from the designer's drawing to the fabricator's hands, and uncertainty can travel back with its context intact.**

The product must contain the illustrated bend deck. A PDF summary, chat box, issue tracker or spinning final model alone would not fulfill the user's idea. Equally, presenting invented geometry or an unverified manufacturing plan as correct would betray that idea.

**What comes from the user, and what this package proposes.**

| Status | Decision or idea |
|---|---|
| Confirmed intent | One-off R&D sheet-metal parts; designer uploads drawings plus 3D model; preserve numbered tabs; short illustrated bending steps with supplied angles/dimensions; printed-drawing QR; phone swipe interface; 3D inspection; contextual chat; flagging back to designers; manufacturer machinery list maintained over time; AI uses that information to adapt instructions. |
| Confirmed build context | Approximately two days, three teammates using separate Codex chats, API access described by the user, one shared GitHub repository, frequent verified integration into main. Exactly three execution prompts are requested. |
| Proposed implementation decisions | Browser app; Next.js/TypeScript; Supabase; OpenAI server calls; Three.js; immutable releases; reviewed source interpretation; manufacturing review of proposed sequence; GLB and PDF as first supported files; explicit panel/hinge geometry for intermediate diagrams; one straight-bend part family first. These were not previously agreed user decisions, but are architectural choices made under the user's explicit creative authority. |
| Proposed improvements | Before/after bend scrub, persistent bend IDs, source drawer, machine-proposal diff, photo on a flag, explicit replacement-release acknowledgement, printable QR label, optional PDF stamp. |
| Superseded framing | General “all engineers/all overseas factories”; expensive CAD licences as the main problem; generic CNC machining as the target; replacing the visual deck with clarification-only document chat. |
| Still unexplored | Paid buyer, price, actual customer demand, CAD authoring system, available example files, workshop hardware, exact account credentials and deployment access. No customer interviews, savings or production accuracy have been established. |
| Longer-term ambition | Richer native CAD import, automatic topology recovery, CAM integrations, machine simulation, collision analysis, broad fabrication/assembly support. Preserve these possibilities without claiming them as weekend functionality. |

**Observed repository facts.**

Read-only GitHub inspection found HenryFowlerr/SkunkWorks to be private, created on 25 September 2026, with default branch name main. The contents endpoint reported “This repository is empty”; the branches endpoint returned an empty array. There is no existing source tree, framework, dependency manifest, lockfile, AGENTS.md, CI or deployment setup to preserve at that inspection point. Repository metadata reported push permission for the connected account. A rulesets request returned 403 with a plan/visibility message; that does not prove future pushes are unrestricted. Each implementation agent must re-inspect the current repository because other teammates may have started since this package was written. No repository changes were made while preparing this package.

All file paths and technology selections in the accompanying architecture are proposed additions. If useful code now exists, retain it and coordinate a path/contract amendment instead of overwriting it. A genuinely empty repository has no commit from which to create a worktree; TEAM-1 owns the first commit.

**Who uses it and why.**

The designer knows the intended part and its functional requirements. The fabricator understands the actual forming process and the receiving workshop. The operator needs a concise visual reference at the point of work. One person may fulfill multiple roles in a small workshop, but the application must record which human took each action.

Our working commercial hypothesis is that unfamiliar prototype jobs create repeated clarification overhead between organisations. Reusable capability profiles and fast job-specific guides may reduce this overhead. The hypothesis can fail if the guides take longer to prepare than the clarification they save, if the jobs are too simple to need explanation, or if existing CAD/CAM workflows already satisfy the need. Do not hide those possibilities.

Existing software already provides CAD viewing, bend planning, digital instructions, QR access and AI assistance. The proposed distinction is a low-friction, paper-linked, workshop-aware handoff for prototype work. It is not a proven monopoly or new category. Sources supporting this distinction and its limits appear at the end of the common package.

**The experience should feel like a precise workshop tool.**

Use a light technical workspace: warm off-white surfaces, dark graphite text, fine restrained lines, blue for the active bend, amber for a review requirement and red reserved for a blocking problem. Keep 3D material neutral, with the active tab highlighted and completed folds legible. Use generous space around the actual part, clear typography and persistent part/revision identification. Monospace can serve identifiers and dimensions; body text should remain easy to read. Avoid decorative factory stock photography, generic analytics dashboards and fake productivity counters.

Designer desktop: a compact job list and a three-area review workspace—source drawing, 3D/step preview, and the selected bend's facts/findings. Manufacturer profile editing belongs beside this workflow, not in an elaborate enterprise administration product.

Operator phone: the illustration dominates. A visible “Step 2 of 4 · Bend B4” separates sequence position from identity. Show the finished target angle with its convention, a reference-face marker, short action text, and a clear “Flag this bend” action. Previous/next buttons accompany swipe. A bottom navigation offers Guide, Model, Ask and Flags. Preserve the selected bend across these views. Keep tap targets large, support keyboard and reduced motion, and do not make colour the only status signal. Avoid gestures that fight one another: swipe changes steps in Guide; drag orbits only in Model or an explicitly activated model viewport.

**The complete primary journey.**

1. A user signs in and opens a workspace. The workspace is the access boundary for this prototype programme. Designers and fabricators can be invited to it using copyable invitation links. The MVP does not require an enterprise organisation hierarchy or automatic email sending.
2. The fabricator adds a workshop profile. Start with the relevant machine and tooling, but allow more machines to be added and existing entries updated. Record unknown values as unknown. Store documented limits and process notes with a source/author. Updating the profile creates a new version.
3. The designer creates a job, uploads its drawing PDF and supported 3D model, and associates the selected workshop profile version and machine. The UI states accepted formats and limits before upload. The source drawing revision and the app's release number are separate concepts.
4. AI reads the actual source packet, extracts numbered bends and explicit requirements, proposes a short sequence and captions, and considers documented workshop constraints. Each engineering fact has a source or is explicitly unestablished. A machinery recommendation has a rationale and references the profile version. Missing tooling information is not treated as proof that the tool is unavailable.
5. The review workspace shows the generated facts and the proposed diagrams. Reliable intermediate geometry comes from the panel/hinge model described in the architecture. The reviewer can correct mappings, values and proposed order. Unsupported or unmapped geometry remains an actionable incomplete draft; the app must not show a substitute part as the user's part.
6. The designer confirms the interpretation of the source information. The fabricator confirms the selected setup and agreed sequence. A single authorised person can perform both reviews when appropriate, and the record shows that truthfully. Any draft edit invalidates previous approvals. “Reviewed guide” does not certify general manufacturability or control a machine.
7. Publication produces an immutable guide snapshot, a release-bound QR and a downloadable/printable label containing the part and revision identifiers. The engineer can paste the label onto the existing technical drawing. An optional placement-preview PDF stamp is a later enhancement; the essential print workflow must work without it.
8. The operator scans the paper QR using the phone's normal camera. After exchanging its scoped access link, the app opens the issued guide without requiring a full designer account. A valid link exposes only that release's shared content and permitted interactions. Designer actions remain authenticated.
9. The operator swipes through actually different intermediate states, opens the final supplied model or the bend diagram, and asks a question about the current bend. The source viewer is available from factual callouts. Chat distinguishes a documented answer, conflict, missing information and unreadable evidence.
10. “Flag this bend” creates a persisted issue with the job, release, step, bend ID and optional camera view. The operator adds a question and optionally a photo. Sending is confirmed only after persistence. Retry must not create duplicate flags.
11. The designer sees the issue in the review desk, responds and either explains the existing requirement or creates a corrected draft/release. A correction to technical content needs the relevant reviewed update; it cannot silently rewrite the old guide through a chat reply.
12. The operator sees the response on the phone. If a new release exists, the old paper link still identifies the original release and displays the replacement explicitly. The operator acknowledges a response/replacement in an audit event; acknowledgement does not alter the historical snapshot.

**The scope of the visual engine is deliberately explicit.**

The first supported bending family is a single sheet with a small number of straight bends and a tree of rigid planar panels. Suggested demo size: three to five bends. Geometry is expressed in millimetres with explicit hinge axes, panel polygons and mappings to drawing IDs. Target fold rotation is separate from the finished angle printed on the drawing. The renderer computes intermediate poses from the reviewed order. It does not simulate material deformation, springback, tool collision or press motion.

The uploaded final CAD model and the bend-diagram model are different assets. A GLB mesh can be displayed, but does not necessarily contain semantic bend topology. We therefore propose a reviewed mapping/editor plus a portable bend-manifest JSON for reliable diagrams. AI may propose the mapping; it cannot quietly promote inferred topology to a verified fact. The live demo includes an original drawing, matching model and explicitly authored/reviewed manifest. Modifying supported inputs must change the generated result; no hardcoded upload-to-fixture substitution is acceptable.

This is a consequential added input requirement. The UI must explain it. The weekend system must also let a person create/edit a supported panel/hinge mapping, rather than requiring hidden developer edits for every new job. Automatic native-CAD unfolding is a later capability. The guide can remain a draft while mapping is completed, but completion of this build requires at least one real supported upload-to-illustrated-release journey and a second input variation proving that the engine is not fixture-only.

**Machinery adaptation must produce a visible, reviewable result.**

A workshop can record multiple machines, tooling references, documented capabilities and process constraints. A job selects one immutable profile version and one relevant setup. For the first demonstration use a fabricator-authored ordering constraint, such as a named bend preceding another for that documented setup. AI proposes a new sequence with a source-linked explanation; deterministic code checks that the proposed sequence respects explicit constraints. The diagrams then reflect the accepted order.

Such a demonstration proves use of documented setup context. It does not prove the software independently derived a collision-free manufacturing process. For new equipment, generate a new proposal; existing published instructions do not change. An explicit numeric comparison is allowed only when units, applicability and source values are known. An unqualified “maximum thickness” must not be extrapolated across every material and setup.

**What must be real by the end of the build.**

| Essential | High-impact after the first integrated journey | Later ambition |
|---|---|---|
| Real PDF/model intake, saved machinery inventory, selected setup, actual AI generation, reviewed numbered-bend interpretation, deterministic intermediate diagrams, editable sequence, publication, QR/print label, touch guide, interactive model, contextual chat, persisted flag and human response, revision handling, hosted persistence. | Animated transitions, before/after scrub, photo flags, operator acknowledgement, source-region highlights, model camera capture, PDF QR-stamp placement, polished generation progress, setup proposal comparison. Basic machine-influenced proposal and response visibility remain essential, even if their animation is deferred. | STEP/native CAD import, arbitrary bend topology, collision simulation, NC programs, automatic bend deduction, broad engineering checks, multi-part assemblies, multilingual guides, robust offline sync and enterprise integrations. |

If time becomes short, remove optional extras and visual flourish first. Do not declare success by discarding the deck, equipment influence, actual AI call, source upload, 3D model, chat or completed flag loop. If an essential element remains missing, report the prototype as incomplete and give the exact blocker.

**Recovery and edge cases are part of the experience.**

- Upload failure: retain job metadata, identify the failed file, allow replacement/retry, and never leave a document marked ready before upload verification.
- Unsupported model: show its filename and supported alternatives; allow another model export. No random fallback geometry.
- Missing bend mapping: highlight the unmapped bend and open the mapping editor. Publication remains unavailable until essential mappings are complete.
- Conflicting dimensions: show both sources. AI does not choose design intent. Reviewer must resolve or explicitly remove the unsupported instruction from the proposed guide with a recorded reason.
- No provider credentials, timeout or refusal: show a real failure and retry. A labelled sample dataset may help exploration, but it is not a successful live generation.
- Interrupted generation: persist the operation state, detect expiry and retry without pretending an in-memory task is durable.
- Concurrent edits: return a conflict and reload/compare. Never silently overwrite another review.
- New profile/revision: propose review, preserve the issued snapshot and show the difference.
- Phone loses connectivity: display the last loaded view as offline/read-only. Do not claim a flag was submitted until the server confirms it. Durable offline queues are optional.
- Revoked QR: show access unavailable without disclosing private metadata. The designer can issue a replacement access link for the same release.
- App reports a hold: this is workflow status only; there is no machinery interlock.

**The competition story.**

The current participant guide specifies a working hosted AI SaaS, a live demo, a Sunday 27 September 10am deadline, five presentation minutes and three Q&A minutes. It names Innovation, Execution, Impact & Value, and Presentation & Demo without published weights. Sunday daylight saving advances the clock. Recheck organiser announcements for changes. The private repository needs the access the organisers request; do not make it public without the team's explicit decision. [Participant guide](https://www.saasathon.dev/docs)

Open with an unfamiliar prototype part and the numbered drawing. Upload the real files, select the workshop and show the resulting AI draft plus one setup-driven proposal. Approve it, open the print label, scan with a second device and swipe through different bend states. Flag one unclear instruction, respond on the designer screen and show the response arrive on the phone. The audience should remember one bend staying identifiable throughout the journey.

Borrow from the supplied winner accounts: Atlas's intervention before downstream cost, Howards' instantly visible transformation and Monad's preserved request/decision record. These are our interpretations of the supplied research, not verified judges' reasons or claims about what those teams built in one weekend.

Do not invent customer validation, measured savings, accuracy percentages, machine compatibility or winning odds. A genuine short fabricator conversation is valuable, but it is not a prerequisite for finishing the build package. If it does not happen, say so. The prototype can be technically complete while its commercial hypothesis remains unvalidated.

**Working assumptions that agents must check without repeatedly asking permission.**

No existing stack was observed. Next.js, Supabase and OpenAI are proposed for speed and shared TypeScript, not account availability claims. TEAM-1 confirms hosting access; TEAM-2 confirms database/auth/storage and the selected model's actual PDF/structured-output support. Use an environment variable for the model; prior conversational references to GPT-6/Astra do not prove that an account has that API model enabled. Do not silently replace an explicitly requested model later. Ask for missing credentials securely, never in source or chat logs. TEAM-3 owns original demonstration assets if no suitable licensed example is supplied.

The browser is the delivery surface; installation is not necessary. Manufacturer profiles are workspace-scoped in this MVP. A shared supplier directory across unrelated customers is future work. Owners may approve appropriate free-tier deployment within the execution task's authority; paid plans, production data migrations and expanded external access require their applicable authorisation. This specification task itself has not deployed or modified the project.
