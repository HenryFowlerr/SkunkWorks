# Chappe screen patterns and examples

These examples make the [design system](README.md) actionable. They define information order and behaviour; they are not pixel-perfect finished mockups. The product contract and status documents remain authoritative for what data exists today.

## 1. Public landing: explain the handoff

**Section order**

1. Light hero: “A clearer handoff from engineering to the workshop.” Brief supporting copy and one primary CTA. Brand name present as plain text; semaphore mark is optional.
2. Large, legible prepared part or drawing illustration showing the selected B2 area. Label it as illustrative and retain the source boundary; the front screen has no person photograph.
3. One compact product sequence: `Check the facility → Review the guide → Release to the floor → Resolve questions`. Each step should name the human decision and show a small authentic product crop or a simple diagram.
4. A high-trust section: supported / conflict / unknown and proposal / approved / released, with honest explanation of scope.
5. Final invitation to see the workflow. No wall of feature cards or fabricated customer metrics.

**Placement:** desktop copy width around 650px; the part visual can span most of the viewport width. On phone, keep copy before the visual and keep B2 legible. Reserve 16–24px side gutters. Headline should wrap naturally without orphaned one-word lines. Prefer clean image edges; no boxed copy floating over the part. A dark chapter may be used later, once, to signal the released handoff.

**Motion:** one short reveal of a semaphore-like mark to plain “Chappe” near the hero is acceptable. No essential explanation depends on the animation. Use reduced-motion fallback and avoid scroll trapping.

## 2. Engineer job list and job header

Use a descriptive page title, one-line status summary, a top-level “New job” action, and a list/table. Priority columns: job/part, chosen facility, handoff state, latest release, updated time. Search and status filter sit immediately above the list. Select a job to reach its own view; do not make every cell a separate card. Empty state tells the engineer how to create the first job. Avoid a decorative analytics dashboard before the work list.

A job header persistently states part/job name, facility, release version or draft, and current decision. Supporting files and history follow. If the facility has not been chosen, the next action is explicit. Version numbers use tabular numerals.

## 3. Facility capability check

**Wide layout:** comparison rows in the main area, evidence in the right inspector. A row contains requirement, documented facility fact, result (`Documented support`, `Conflict`, `Unknown`), source, and action. Selecting it opens the exact source and scope of the comparison. “Unknown” asks for missing profile data or a human check. No green check for inferred reachability or unverified physical manufacturability.

**Narrow layout:** each row becomes a compact two-line item with result and source visibly retained. Selection opens detail. The result label never relies only on colour.

Example copy:

> **Unknown — tool reach not recorded.** The selected facility profile lists a 3-axis mill, but no setup or reach information for this pocket. Confirm the setup with the shop before release.

This is deliberately more useful than “Capability check passed.”

## 4. Engineer review desk

The main list is operations, grouped by part area if needed. Each row states whether extra guidance is included, proposal/review state, and the latest change. Selecting an operation opens a detail inspector containing: model/drawing context, proposed concise step, cited source/uncertainty, editable approved wording, include/exclude control, and reviewer identity/time. A routine operation can be excluded from detailed floor guidance while remaining selectable on the model.

The publish path is a deliberate review moment: show what the floor will receive, which operations have approved text, unresolved conflicts/unknowns, destination facility, and release version. The final button says “Publish release” rather than “Generate.” A release is immutable; revisions create a new version. Show the older version distinctly when a QR refers to it.

## 5. Manufacturer desktop

Start with facility name and what engineering sent. Equipment profile appears as a readable list/table with source and last update. Show received jobs and open issues in the same vocabulary as engineering. An equipment assertion can be edited or confirmed only through the real supported workflow; display current source data without suggesting it certifies buildability. Avoid a business KPI dashboard for the demo unless there is real operational data to act on.

## 6. Operator phone

After scan, show **job + release identity** and a short operation chooser. The selected operation screen has a clear heading, model or image region with labelled target, concise approved steps, and ask/flag actions. Long steps are split into a meaningful sequence, not hidden in accordions. Keep controls reachable with gloves in mind, but test actual device and environment before asserting usability. Include a text operation list beside or below a model hotspot interface. If model content fails, the approved text and operation context remain available.

Example phone information order:

```text
Job 1042 · Release 3
Sensor mount / Operation 2: Bend B
[part model with selected region; list alternative]
Step 2 of 4 · Approved by engineering
“Align the marked flange to the stop before the bend.”
[Next step]
Ask about this operation   Flag an issue
```

A question composer includes the context automatically and states where the message goes. After sending, show “Sent to engineering” and its current response state. A generated answer must remain labelled as a draft until approved by engineering.

## 7. Engineer issues and floor response

Desktop list: open issues first, with job, release, operation, reporter, age and state. Selection opens the original question plus exact release/operation context. Engineer can respond, approve a suggested response, or issue a revised release, according to supported API behaviour. A response to an old release cannot silently overwrite it. On phone, an operator sees the approved answer alongside the original question and the version it applies to.

## Components, states and language

| Component | Placement and behaviour | Wording rule |
|---|---|---|
| Primary button | One per decision region, blue; top or near task end | Verb + object: “Publish release” |
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
- **Phone:** single column; current task and release first; direct back path; one primary action; supportive actions nearby; no desktop table squeezed to viewport.
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
  background: var(--ch-blue-tint);
}
.reviewRow__meta {
  color: var(--ch-text-secondary);
  font-size: var(--ch-type-small);
}
```

Do not add inline hex values to new modules. Prefer an existing shared component; if a pattern must be repeated, add a shared component and document its states. Verify on an actual screenshot at desktop and phone widths; a passing build does not prove the hierarchy is right.
