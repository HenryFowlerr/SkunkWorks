# Chappe design system

**Status:** canonical direction for new Chappe UI, September 2026. Read this with [the product brief](../product/overview.md), [current build status](../integration/status.md), [Apple research](apple-research.md), and [screen patterns](patterns.md). Chappe is the public product name; SkunkWorks is the team. The final demonstration part and final logo artwork remain open. Existing screens do not yet implement every pattern here.

## How this stays in use

1. Root [`AGENTS.md`](../../AGENTS.md) requires every agent touching UI to read this directory before editing. The same rule applies to copy, motion, imagery, and responsive changes.
2. Runtime values live in [`src/app/design-tokens.css`](../../src/app/design-tokens.css). Use these variables and existing `src/components/ui/` primitives. Add a token before repeating a new visual value.
3. Use the page templates in [patterns.md](patterns.md), then test a wide laptop, a narrow laptop/window, and a phone. A PR changing UI must state which pattern and tokens it uses and include screenshots or a concise visual check.
4. If a pattern proves wrong, update this guide, the tokens, and the affected component together. Do not allow another parallel design vocabulary to grow inside a feature CSS module.

This is an **inspired adaptation**, not an Apple design kit. Do not use Apple's logo, artwork, SF Pro font files, screenshots, or proprietary interface assets. Apple sources and observed examples are linked in [apple-research.md](apple-research.md); dimensions below are Chappe decisions unless explicitly cited.

## Character

Calm, exact, useful. A Chappe page should feel as if a skilled engineer arranged only the information needed for the next decision. Light backgrounds, dark readable type, generous whitespace, clean blue actions, restrained separators, and precise product imagery. The brand reference is the Chappe optical semaphore: signalling clearly across distance. Use that as a potential motion/mark motif, never as a substitute for a label. No unearned manufacturing or AI certainty.

### Two modes, one product

| | Public landing | Working product |
|---|---|---|
| Purpose | Explain the handoff and motivate a demo or sign-in | Help a person resolve an actual job or operation |
| Layout | Large editorial sections, occasional full-width image, deliberate quiet space | Toolbar, navigation, main work area, contextual inspector where room permits |
| Imagery | Product-first part/drawing visuals with clear evidence scope | Actual drawing/model evidence, compact thumbnails, no decorative photo behind task content |
| Motion | One optional semaphore reveal or subtle image transition | Only state/selection feedback; never animate away a conflict or unknown |
| Density | Few statements and strong visual sequence | Dense enough for comparison, readable and scannable |

Do not paste the landing page's giant headline, photo block, or scrolling reveal into the review desk. Likewise, do not market Chappe with a grid of dashboard cards. Apple’s marketing and software interfaces solve different tasks; [research](apple-research.md) explains the translation.

## Foundations

### Colour

Canonical CSS variables are in `src/app/design-tokens.css`.

| Role | Token | Value | Use |
|---|---|---|---|
| Canvas | `--ch-canvas` | `#fff` | Landing and calm work surfaces |
| Secondary canvas | `--ch-canvas-subtle` | `#f5f5f7` | Alternating marketing section or app chrome |
| Surface | `--ch-surface` | `#fff` | Controls and distinct work surface |
| Primary text | `--ch-text` | `#1d1d1f` | Titles, essential data |
| Secondary text | `--ch-text-secondary` | `#6e6e73` | Explanations and metadata, not critical status alone |
| Hairline | `--ch-border` | `#d2d2d7` | Pane and row separation |
| Action blue | `--ch-blue` | `#0071e3` | Main action, active selection, link |
| Blue hover | `--ch-blue-hover` | `#0077ed` | Hover only |
| Blue tint | `--ch-blue-tint` | `#eaf4ff` | Selected row or subtle callout |
| On dark | `--ch-text-on-dark` | `#f5f5f7` | Dark editorial chapter |

White, grey, and blue are the brand colours. Amber, red, and green have **reserved meanings**: review/unknown, conflict/blocked, and completed/confirmed. A status always has a label and evidence; colour is supplementary. Use `--ch-status-*` tokens. Avoid decorative gradients, neon glows, and several competing blue tints.

### Type

Use the system sans stack in `globals.css` (`-apple-system`, BlinkMacSystemFont, `Segoe UI`, sans-serif). On Apple devices this gives the platform system face; elsewhere it remains familiar and readable. Do not bundle Apple's San Francisco fonts. Use a small scale with `--ch-type-*` tokens. Marketing hero can be `clamp(3rem, 7vw, 6rem)` with tight leading; workspace titles are much smaller and never force scrolling past the job. Body is usually 15–17 CSS px at comfortable line-height; metadata may be 12–14px if it remains legible. Use tabular numerals for versions, measurements, time and job IDs. Sentence case, short labels, and concrete verbs. No all-caps paragraphs, fake technical jargon, or extra-light text.

### Space, geometry, layering

Use the 4/8/12/16/24/32/48/64px spacing tokens. A marketing section can use 80–144px vertical room at desktop widths, scaled down on phone; a work row should be compact. Use `--ch-radius-sm` (8px) for fields and row affordances, `--ch-radius-md` (14px) for menus/panels, `--ch-radius-lg` (24px) for a **large photo frame only**, and `--ch-radius-pill` for primary marketing CTA. Plain content sections and data tables usually need no rounded outer card. Separate panes with a hairline; add a shadow only for an actual floating layer. Avoid “card inside card” layouts.

### Imagery

The public landing uses the prepared part and drawing as its main visual. Do not place a person photograph on the front screen. Product imagery must be true to the implemented state and marked as an illustration when conceptual. Do not fake live product screens, imply a factory is a customer, or treat an illustrative part as forming validation. Provide descriptive alt text and keep the chosen operation legible on mobile.

### Original visual references

These earlier generated concept photographs are historical composition references, not current landing assets or a real Chappe deployment. The current front screen is product-first by Henry's direct request.

| Scene | Reference | What to carry forward |
|---|---|---|
| Operator asks beside a machine | [Workshop voice concept](assets/workshop-voice-concept.jpg) | Bright clean workshop, person and machine in one frame, clear space on the left for adjacent editorial copy. |
| Operator selects model area | [Workshop model concept](assets/workshop-model-concept.jpg) | Crisp close crop, phone and selected part prominent, workshop context secondary. The model is illustrative. |

### Motion

Use opacity and small position changes to clarify transition. A semaphore symbol may briefly resolve to the Chappe wordmark on the public page; text must remain readable without motion. Do not scrub a 3D model or claim through long scroll-jacking. Keep core actions available immediately. Honour `prefers-reduced-motion`. An animation cannot be the sole indication of a state change.

## The product's interaction rules

- Show **what the person is deciding** first. Engineer: which facility, where the check conflicts or lacks evidence, what will be released. Operator: which job/release/operation, next approved step, ask/flag.
- Every facility check is **documented support**, **documented conflict**, or **unknown**. Unknown must never be made green. Geometry inference and AI proposals remain labelled as such.
- An AI suggestion is visually distinct from engineer-approved, published content. Approval is explicit; the stable part QR opens current approved knowledge while internal approval records preserve history.
- A floor question carries job, release, operation, and optional selected model area. A reply shows its approval and version context.
- Show source and recency close to consequential claims. Link to drawing/profile evidence where possible. No badge that merely says “verified” when the verification scope is narrower.
- Reserve blue for navigation and action. A blue badge must not mean “safe to manufacture.”
- State labels use ordinary language: “Unknown — machine travel not recorded,” “Conflict — required bend radius below recorded minimum,” “Draft suggestion,” “Approved in release 3.”

## UI inventory

Build with the existing `Button`, `Panel`, `StatusBadge`, `Field`, source-reference, and shell primitives where suitable. Converge them on the tokens; do not create visually unrelated copies per route. Add variants only for a genuine interaction role. For new UI, prefer a plain section, a table/list, a toolbar, and a detail panel over one card per fact. Implement keyboard focus, disabled/loading/error states, hover, touch target, and a truthful empty state. Tables need header labels and mobile alternatives. A model viewer requires a usable operation list fallback.

## Accessibility and QA gate

- Verify readable contrast for text and status; target WCAG AA (4.5:1 for normal text) in the actual colour pair. Make all meaning available in text and screen-reader labels.
- Keep mobile interactive targets at least 44 × 44 CSS px where practical, with spacing against accidental taps. The CSS value is a Chappe web rule, not a conversion of Apple's point units.
- Keyboard users can move through navigation, rows, model area alternatives, inspector and approval without trapping focus. A visible focus ring uses blue with sufficient contrast.
- At 320–430px widths, no horizontal page scroll, clipped primary action, or hidden release/status context. At 768–1280px, collapse secondary panels before reducing type. At 1440px, use the extra width for useful simultaneous context rather than stretching prose.
- Test loading, empty, conflict, unknown, AI failure, permission, stale release, and successful published state. Use realistic job/operation lengths.
- A PR description includes: screen/pattern used, token/component changes, wide/narrow/mobile visual evidence, interaction states checked, and any deliberate deviation from this guide.
