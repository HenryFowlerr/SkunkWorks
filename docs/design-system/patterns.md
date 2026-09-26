# Chappe screen patterns and examples

These examples make the [design system](README.md) actionable. They define information order and behaviour; they are not pixel-perfect finished mockups. The product contract and status documents remain authoritative for what data exists today.

## 1. Public landing: explain the handoff

**Section order**

1. Light hero: “A clearer handoff from engineering to the workshop.” Brief supporting copy and one primary CTA. Brand name present as plain text; semaphore mark is optional.
2. Large, legible prepared part or drawing illustration showing the selected B2 area. Label it as illustrative and retain the source boundary; the front screen has no person photograph.
3. One compact product sequence: `Check the facility → Review the guide → Release to the floor → Resolve questions`. Each step should name the human decision and show a small authentic product crop or a simple diagram.
4. A high-trust section: supported / conflict / unknown and proposal / approved / released, with honest explanation of scope.
5. Final invitation to see the workflow. No wall of feature cards or fabricated customer metrics.

For the Vercel-hosted landing, place the stable part QR immediately after the part illustration only once its authorised destination is available. Follow it with a separate full-width evidence section: a headline and short explanation above three status columns. Keep the navigation solid and sticky while scrolling, with the engineer and manufacturer routes in that order. Avoid small all-caps section labels when the adjacent headline already names the section; keep source and uncertainty language beside the actual evidence.

**Placement:** desktop copy width around 650px; the part visual can span most of the viewport width. On phone, keep copy before the visual and keep B2 legible. Reserve 16–24px side gutters. Headline should wrap naturally without orphaned one-word lines. Prefer clean image edges; no boxed copy floating over the part. A dark chapter may be used later, once, to signal the released handoff.

**Motion:** the opening uses the user-supplied Chappe signal-form sequence in `site/assets/chappe-morph/frames/` as a full-viewport, scroll-scrubbed opening stage. The six forms resolve into the Chappe wordmark, which makes room for the message to rise from below. Keep it on the site canvas with no extra labels or card treatment. The landing remains usable without it; reduced-motion users see the resolved wordmark and message.

## 2. Engineer job list and job header

Use a descriptive page title, one-line status summary, a top-level “New job” action, and a list/table. Priority columns: job/part, chosen facility, handoff state, latest release, updated time. Search and status filter sit immediately above the list. Select a job to reach its own view; do not make every cell a separate card. Empty state tells the engineer how to create the first job. Avoid a decorative analytics dashboard before the work list.

The live engineering jobs overview places the project list beside the file drop area. Keep manufacturer navigation out of the engineer sidebar; the top bar switches between the two work areas. The sidebar should end at its links and scroll away instead of stretching into an empty coloured column.

A job header persistently states part/job name, facility, release version or draft, and current decision. Supporting files and history follow. If the facility has not been chosen, the next action is explicit. Version numbers use tabular numerals.

## 3. Facility capability check

**Wide layout:** comparison rows in the main area, evidence in the right inspector. A row contains requirement, documented facility fact, result (`Documented support`, `Conflict`, `Unknown`), source, and action. Selecting it opens the exact source and scope of the comparison. “Unknown” asks for missing profile data or a human check. No green check for inferred reachability or unverified physical manufacturability.

**Narrow layout:** each row becomes a compact two-line item with result and source visibly retained. Selection opens detail. The result label never relies only on colour.

Example copy:

> **Unknown — tool reach not recorded.** The selected facility profile lists a 3-axis mill, but no setup or reach information for this pocket. Confirm the setup with the shop before release.

This is deliberately more useful than “Capability check passed.”

## 4. Engineer review desk

The main list is operations, grouped by part area if needed. Each row states whether extra guidance is included, proposal/review state, and the latest change. Selecting an operation opens a detail inspector containing: model/drawing context, proposed concise step, cited source/uncertainty, editable approved wording, include/exclude control, and reviewer identity/time. A routine operation can be excluded from detailed floor guidance while remaining selectable on the model.

The publish path is a deliberate review moment: show what the floor will receive, which operations have approved text, unresolved conflicts/unknowns, destination facility, and release version. The final button says “Publish release” rather than “Generate.” The part QR stays stable and opens current approved knowledge. Internal approval history may remain visible as secondary context; formal CAD revision management is outside the demo.

## 5. Manufacturer desktop

Start with facility name and what engineering sent. Equipment profile appears as a readable list/table with source and last update. Show received jobs and open issues in the same vocabulary as engineering. An equipment assertion can be edited or confirmed only through the real supported workflow; display current source data without suggesting it certifies buildability. Avoid a business KPI dashboard for the demo unless there is real operational data to act on.

## 6. Operator phone

After scan, show **part identity and current approved guidance** with a short operation chooser. The selected operation screen has a clear heading, model or image region with labelled target, concise approved steps, and an obvious path to ask or flag an unresolved issue. Long steps are split into a meaningful sequence, not hidden in accordions. Keep controls reachable with gloves in mind, but test the actual device and environment before asserting usability. Include a text operation list beside or below a model hotspot interface. If model content fails, the approved text, drawing link, and operation context remain available.

**Current Engineering Test Block phone flow.** The default QR guide puts an authorised GLB/STL visual reference above the selected released step and a compact release-scoped **Quick assist** composer below it. Keep part and revision identity quiet, avoid a dashboard header, and do not put a persistent red report control ahead of the question flow. An assist answer may offer a contextual flag/report action prefilled with the question; reporting remains a separate deliberate flow. Long answers may scroll inside chat history. The visual model is a navigation aid only: it never establishes dimensions, datum interpretation, tooling, setup, safety, or manufacturing feasibility. If graphics fail, offer the released drawing as the controlled source.

Example phone information order:

```text
Job 1042 · Release 3
Sensor mount / Operation 2: Bend B
[part model with selected region; list alternative]
Step 2 of 4 · Approved by engineering
“Align the marked flange to the stop before the bend.”
[Next step]
────────────────────────────────────
[ Speak or type question ] [ Flag & hold ]
```

A phone has one persistent, safe-area-aware bottom action bar. For the ordinary operation flow, it carries exactly two deliberate actions: **Speak or type question** (petrol) and **Flag & hold** (reserved conflict red). For the current direct model/chat QR workspace, the composer itself is the only initial bottom action; reporting is contextual after an answer so a floor operator first sees only the part and a way to ask for help. “Speak” opens a compact composer with browser dictation, an editable typed transcript, an explicit stop/listening state, and a typed fallback; raw audio is not retained by default. The assistant answer is release/operation-scoped, names its approved-source scope, and never clears a hold or asserts a manufacturing outcome. If the operator says it resolved the immediate issue, automatically queue the raw question plus an **assistant draft** improvement candidate for engineering review. “Flag & hold” creates the hold before any AI reporting, preserves the raw statement, and queues an urgent assistant-drafted investigation note. Do not use a sound alone as the alert. A prepared/static demo must name that limitation honestly.

## 7. Engineer issues and floor response

Desktop list: hard-stop flags first, then ordinary questions and resolved-assist improvement reports, each with job, release, operation, reporter, age and state. Selection opens the raw statement plus exact release/operation context, assistant draft summary, candidate improvement, source/uncertainty, and hold state. Engineer can keep a hold, respond, approve/edit a suggested response, correct a guide, or issue a revised release, according to supported API behaviour. An assistant draft cannot publish a release or clear a hold. A response to an old release cannot silently overwrite it. On phone, an operator sees the approved answer alongside the original question and the version it applies to.

## Components, states and language

| Component | Placement and behaviour | Wording rule |
|---|---|---|
| Primary button | One per decision region, petrol action; top or near task end | Verb + object: “Publish release” |
| Secondary button | Adjacent for alternative action | “Save draft”, “View source” |
| Destructive action | Separate, explicit confirmation | Name what will be removed |
| Status label | Beside related fact, with text and semantic colour | “Unknown — no profile data” |
| Source reference | In row summary and detail inspector | File/profile name + relevant detail |
| Inline feedback | Near control that caused it | Actual error and next step |
| Empty state | In the working list/region | What is empty and how to proceed |
| Model selection | Highlight plus text label; sync with operation list | “Operation 2 · Bend B” |
| Release identity | Job header and operator phone header | “Release 3”, not ambiguous “latest” |

Use a real `<button>` for actions and `<a>` for navigation. Preserve focus when panels update; announce async state changes. Plain language and semantic HTML matter more than adding visual chrome.

## Responsive contract

- **Wide desktop:** navigation + main work + inspector together when useful; top toolbar carries persistent identity and action.
- **Narrow desktop/tablet:** collapse inspector first, then sidebar if needed; don't shrink critical type or conceal status.
- **Phone:** single column; current task and release first; direct back path; the two-action help/hold bar stays reachable above the safe area; no desktop table squeezed to viewport.
- **Reduced motion / low bandwidth:** task and status remain functional without large photography, 3D rendering, or animated reveals.

## Code usage

New CSS should consume `--ch-*` variables from [`design-tokens.css`](../../src/app/design-tokens.css), for example:

```css
.reviewRow {
  border-bottom: 1px solid var(--ch-border);
  padding: var(--ch-space-4) var(--ch-space-6);
  color: var(--ch-text);
  background: var(--ch-surface);
}
.reviewRow[aria-selected="true"] {
  background: var(--ch-action-tint);
}
.reviewRow__meta {
  color: var(--ch-text-secondary);
  font-size: var(--ch-type-small);
}
```

Do not add inline hex values to new modules. Prefer an existing shared component; if a pattern must be repeated, add a shared component and document its states. Verify on an actual screenshot at desktop and phone widths; a passing build does not prove the hierarchy is right.

## Separate engineering and manufacturing work areas

Use a shared compact top navigation to switch work areas, then task-specific side navigation. Engineering opens the parts/jobs list and review desk. Manufacturing opens parts/handoffs, with equipment editing on a separate route. A handoff groups approved part requirements, selected facility evidence and contextual questions; unavailable historical evidence must not be replaced with a newer profile. Use flat rows, a definition list for specifications, and a contained horizontally scrollable operation table on narrow phones. Switching workspace returns to that work area's list rather than preserving the previous part URL.
