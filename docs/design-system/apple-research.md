# Apple research: from showcase pages to working software

Research checked September 2026. This is a study of Apple's publicly documented interface guidance and support examples, then an explicit Chappe adaptation. Apple does not publish a universal “SaaS dashboard” specification. Its guidance covers platform apps; our CSS sizes and page templates are Chappe decisions. Avoid claiming a precise Apple radius, spacing, or animation duration where Apple has not documented one.

## What the sources actually show

| Apple source | Observed principle | Chappe translation |
|---|---|---|
| [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos/) and [Layout](https://developer.apple.com/design/human-interface-guidelines/layout/) | Large resizable windows support more simultaneously visible content and shorter navigation paths. Layout should adapt when space genuinely runs out. | Engineer work area shows navigation, job content, and contextual detail together on wide screens; collapses panes in a defined order. |
| [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars) | Leading area holds back/sidebar/title, middle common tools, trailing search/inspector/important action. Keep groups consistent and avoid clutter. | Persistent work toolbar with job name/release left, view controls and search center, review/release action right. |
| [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) and [Split views](https://developer.apple.com/design/human-interface-guidelines/split-views) | Leading sidebar navigates; optional detail/inspector sits beside content. Sidebars can hide at narrow widths; shallow hierarchy is easier to scan. | Job/review/issue nav at left, main list/model middle, evidence or operation detail at right. |
| [Windows](https://developer.apple.com/design/human-interface-guidelines/windows) and [Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | Critical Mac controls should not depend on the window bottom edge. | Approval and “Resolve issue” live in a top/context action area; bottom can show supporting details only. |
| [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables) | Lists and tables make related items and comparable attributes easy to scan. | Show capability checks, operations, and issues as sortable/filterable rows with status, source, owner and time; expand one row to inspect evidence. |
| [Numbers on Mac: sidebar](https://support.apple.com/guide/numbers/show-or-hide-the-sidebar-tan95190244d/mac) and [object formatting](https://support.apple.com/en-gb/guide/numbers/tan089795ddb/mac) | Format/Organise sidebar can be hidden to gain workspace room; controls follow the selected object. | Detail inspector reflects selected operation or check. It is collapsible; avoid a permanent dashboard of unrelated properties. |
| [Numbers for Mac guide](https://support.apple.com/guide/numbers/welcome/mac) | Sheet tabs at top, a central document canvas, object-specific controls. | A job can have local content views, but job navigation and operation selection stay separate and clear. |
| [Reminders Mac: lists and columns](https://support.apple.com/guide/reminders/view-reminders-in-lists-or-columns-remn1d887139/mac) | One collection can be shown as a simple list or columns when the task calls for it. | Default to an issue list for triage; use stage columns only when moving between states is the actual work. |
| [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars) and [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars) | Compact phones favour clear top-level tab navigation; sidebars require room. | Operator phone uses a direct scan-to-operation flow; if there are multiple top-level areas, use a small consistent tab bar, not a squeezed desktop sidebar. |
| [Searching](https://developer.apple.com/design/human-interface-guidelines/searching) | Search should have clear scope and be easy to find. | One job/operation search, with scope visible and useful empty results; do not repeat search boxes in each pane. |
| [Typography](https://developer.apple.com/design/human-interface-guidelines/typography), [Color](https://developer.apple.com/design/human-interface-guidelines/color), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [Motion](https://developer.apple.com/design/human-interface-guidelines/motion) | Hierarchy, readable type, consistent semantic colour, reachable controls and meaningful motion. | One typographic voice, restrained blue action colour, text labels for states, reachable phone controls and reduced-motion support. |

Apple’s [MacBook Air](https://www.apple.com/macbook-air/) and [Apple Intelligence](https://www.apple.com/apple-intelligence/) public pages use large editorial messages, generous empty space, controlled product imagery, and deliberate section changes. They are useful references for **Chappe's public landing page**. The workspace references above are more relevant for the engineer and operator application. The visual conclusion is an inference from those examples, not an Apple requirement.

## Laptop / desktop blueprint

### Wide working window (Chappe recommendation, roughly ≥1280 CSS px)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Chappe / Jobs › 1042 / Release 3      view / search        Review / Publish │ top toolbar
├───────────────┬───────────────────────────────────────────┬──────────────────┤
│ Jobs          │ Sensor mount · Facility A                 │ Selected operation│
│ Review        │ source / check summary / version          │ evidence & source │
│ Issues        │                                           │ suggestion state  │
│ Facility      │ [check or operation table / model canvas] │ edit / decision   │
│               │                                           │                  │
└───────────────┴───────────────────────────────────────────┴──────────────────┘
 leading nav              primary work                  contextual inspector
```

**Placement and behaviour:**

1. Top toolbar: back/breadcrumb, current job and release identity on the leading side; the current view and search in the middle where useful; the one primary action on the trailing side. Keep the action visible during vertical scroll and distinguish draft from released state.
2. Left sidebar: a few stable destinations (`Jobs`, `Review`, `Issues`, `Facility`). Use clear text plus restrained symbols. Job-specific second-level links may appear under the active job; never more than two deep in the sidebar. Selection is blue-tinted, not a coloured slab.
3. Middle: the actual work. Use a table/list for comparisons and a model/drawing canvas when spatial context is central. A table row exposes its core status, evidence, and next step; clicking selects it rather than sending the person through repeated modal screens.
4. Right inspector: updates for the selected check, operation, model area or issue. Put the source, claim, uncertainty and edit/approval controls here. It can close to give the main canvas room. Do not place global navigation here.
5. Use hairline pane divisions and mostly white surfaces. A neutral grey chrome/background may separate the main content. Use an outer card only when a contained tool or media truly needs one.
6. Prefer one scrollable main region and a separately scrollable inspector if needed. Show which region scrolls. Avoid a nested scroll region inside every panel.

### Narrow laptop / resized window (approximately 768–1279 CSS px)

- Keep top toolbar and main work. Collapse the right inspector into a selected-item drawer or a dedicated detail view before compressing the table into unreadable columns.
- Let the left sidebar collapse with a visible reopen control. Preserve current destination and job title.
- Replace wide tables with fewer priority columns plus an explicit detail action. Source and unknown state cannot disappear.
- Do not put the only release button at the bottom of a long page. Use a toolbar action and an explicit final review step.
- These are content breakpoints: tune them against actual minimum useful widths rather than treating 768 or 1280 as Apple specifications.

### Interaction details

- Selecting a row changes the inspector and keeps the list position; the selection is announced and keyboard reachable.
- A new issue can open in the detail area, with job/release/operation already visible. Do not make the engineer re-enter context.
- Search and filters sit near the relevant list header, with a clear scope. Sorting belongs to column headers.
- An unknown or conflict check links to underlying documented facts or states exactly what is missing. “Review” prompts a human decision; blue action remains distinct from amber/red status.
- Shortcuts are enhancements for frequent desktop actions, with visible labels and no hidden keyboard-only path.

## Phone blueprint: operator first

```text
┌─────────────────────────────┐
│ ‹ Back   Job 1042   Release 3│ identity and return
│ Bracket / Operation 2       │ selected work context
├─────────────────────────────┤
│ [readable model or photo]   │ direct area selection
│  area marker + text fallback│
├─────────────────────────────┤
│ Approved step 2 of 4        │ one concise instruction
│ evidence / warning as needed│
│ [Next step]                 │ primary progression
├─────────────────────────────┤
│ Ask about this   Flag issue │ contextual support
└─────────────────────────────┘
```

The operator reaches this from a QR code on a specific release. The first screen identifies that release and offers direct operation selection; the phone should not begin at a generic dashboard. Show the selected area and approved step before explanation about the product. The model is a navigation aid: retain an accessible text operation list. Ask/flag controls carry the job, release, operation, and selected area automatically. Voice input is optional and never the sole route. Return from a question to the same operation and scroll position.

Phone navigation follows [Apple's compact navigation guidance](https://developer.apple.com/design/human-interface-guidelines/tab-bars): a small stable tab bar is appropriate only for genuinely separate top-level sections; within an operation, use a clear back path and local steps, not tabs for every substep. A sticky action area can help reachability, but it must respect viewport safe areas and keyboard opening. Avoid bottom-only warning/status text. The selected operation, version, and “approved” meaning remain in text. Large touch targets and generous spacing matter in a workshop.

## Mobile engineer view

If an engineer opens Chappe on a phone, support triage: job list → issue/check → evidence → response. Show the issue headline, severity/state, release/operation, source and reply action in a single-column order. Allow a brief response and defer dense model editing or multi-column capability comparison to a wider screen. This is a product scope choice, not a platform limitation. Never silently hide a consequential unknown because it does not fit.

## Marketing placement and photo treatment

For the public page, start light: a restrained navigation line, a single clear headline, short supporting sentence and one CTA. Place a large realistic workshop/phone photo in the first or second major section with a clean crop and generous negative space; let content lead into it rather than surrounding every image with a card. Follow with a concise product sequence that shows the engineer check, reviewed release, operator guide, and contextual answer. Use a real or accurately labelled conceptual UI crop to show the product. A later dark section can mark the cross-distance handoff story, but must still be readable and keep CTA meaning clear. Rounded photo frames may be broad and soft; ordinary data containers should be flatter. These are our observations from [MacBook Air](https://www.apple.com/macbook-air/) and [Apple Intelligence](https://www.apple.com/apple-intelligence/), adapted for a B2B product. The photography should depict Chappe's actual workflow, not Apple products.

## Questions to settle with user research

The current flow and imagery are informed product hypotheses, not evidence of real operator behaviour. Observe engineers reviewing facility checks and operators locating an operation before claiming the layout is validated. Test whether a model hotspot or text list is faster in a real workshop; whether the operator can distinguish unknown from conflict; and whether release version is understood at scan time. Record findings beside this guide and adjust patterns accordingly.
