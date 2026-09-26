# Modus 2.0 adaptation for Chappe

**Status:** current external reference for Chappe's visual direction, September 2026. Read this with the [design system](README.md), [screen patterns](patterns.md), [product brief](../product/overview.md), and [current build status](../integration/status.md).

## The reference, and the boundary

Chappe uses [Trimble Modus 2.0 Blueprint](https://modus.trimble.com/) as a public, industrial-application reference. Its public [Modus Web Components repository](https://github.com/trimble-oss/modus-wc-2.0) describes a framework-agnostic enterprise component library and is [MIT licensed](https://github.com/trimble-oss/modus-wc-2.0/blob/main/LICENSE).

This repository is **not** adopting Modus as a runtime dependency or rebranding Chappe as Trimble. Keep Chappe's CSS Modules, `src/components/ui/` primitives, routes, content, and interaction model. Adapt the structural discipline below into Chappe tokens and components; do not copy or ship Trimble logos, icons, typography files, screenshots, illustrations, names, or component source. The official source is a useful real design-system reference, not evidence that Chappe has a relationship with Trimble.

Apple research remains useful historical context for responsive application layout, but it is not the visual source of truth. This Modus-inspired adaptation replaces the former Apple-blue, soft-panel direction.

## The implementation contract

The goal is a compact, legible technical application that looks intentionally designed for engineering-to-workshop work. It is a refinement, not a product redesign.

Keep:

- the existing information architecture, routes, copy, evidence labels, model/drawing context, and release/approval behaviour;
- the distinction between documented support, conflict, and unknown;
- engineer approval as the authority for proposals and releases; and
- the public site's product-first part/drawing story and the phone's direct operation flow.

Change:

- the Apple-blue action language to a dark petrol action colour;
- oversized rounded containers to flat, divider-led content;
- decorative perspective, glow, gradient, and motion treatment to restrained technical presentation; and
- generic “dashboard card” grouping to rows, panes, toolbars, tables, and inspectors that expose the next decision.

Do not add fabricated operational metrics, AI decoration, false live-product imagery, or claims that the application has validated a manufacturing outcome. Existing product/evidence rules still apply.

## Token and geometry rules

All values belong in [`src/app/design-tokens.css`](../../src/app/design-tokens.css), with [`site/tokens.css`](../../site/tokens.css) kept aligned for the Pages demo. Do not introduce feature-local colour or radius values.

### Colour

| Role | Canonical token | Value | Use |
|---|---|---:|---|
| Canvas | `--ch-canvas` | `#f8f8f4` | Warm off-white application and landing background |
| Secondary canvas | `--ch-canvas-subtle` | `#eef0eb` | Restrained chrome, alternate area, or non-interactive structural grouping |
| Surface | `--ch-surface` | `#ffffff` | Actual control, editor, print, or media surface |
| Primary text | `--ch-text` | `#1b2521` | Headings and consequential data |
| Secondary text | `--ch-text-secondary` | `#5b6760` | Metadata and explanation, never the only status signal |
| Hairline | `--ch-border` | `#d1d7d0` | Pane, row, and table separation |
| Strong hairline | `--ch-border-strong` | `#859188` | Focused structural boundary or disabled control edge |
| Action petrol | `--ch-action` | `#155e75` | Primary action, active navigation, and links |
| Action hover | `--ch-action-hover` | `#104a5a` | Action hover/pressed state |
| Action tint | `--ch-action-tint` | `#e5f1f3` | Selected row or quiet contextual highlight |
| On dark | `--ch-text-on-dark` | `#f7f8f4` | Text only when an intentionally dark chapter is warranted |

`--ch-blue`, `--ch-blue-hover`, and `--ch-blue-tint` are compatibility aliases during migration only. New code must use the `--ch-action*` tokens and must not reintroduce “blue” as the design vocabulary.

Amber, red, and green remain reserved for labelled review/unknown, conflict/blocked, and documented completion/confirmation states. Petrol is never a safety or manufacturing-pass badge.

### Radius and surfaces

| Situation | Rule |
|---|---|
| Fields, buttons, compact selected rows, status tags | `--ch-radius-sm` (4px) |
| Functional surfaces such as a small editor, QR/print region, or contained tool | `--ch-radius-md` (6px) |
| Device frame, model/media canvas, dialog | `--ch-radius-lg` (12px), only when the object is visibly a separate physical or floating surface |
| Ordinary headings, paragraphs, findings, lists, tables, and action rows | No enclosing card; use the canvas/surface directly with a hairline divider |
| Pill radius | Compatibility-only; do not use it for new primary CTAs or general UI grouping |

Use a single hairline to separate adjacent work. A background or shadow must communicate a real layer: a dialog, a device frame, a model canvas, a printed/QR artifact, or a focused editing surface. Do not place a card behind explanatory text just to make it feel designed. Do not nest cards.

## Layout and interaction translation

1. **Start with the work, not chrome.** Put job/release identity, the current decision, evidence, and the next action above decoration. Wide engineer views can have navigation, main work, and a contextual inspector; narrow views collapse the inspector before shrinking type.
2. **Prefer rows to tiles.** Facility checks, operations, issues, sources, and history are comparable facts. Show them as stacked rows or tables with a visible source/status/action rather than a matrix of isolated cards.
3. **Use a surface only when it earns one.** A model canvas, phone, print/QR preview, modal, or editable form can be contained. Explanatory copy, summary facts, and lists normally sit directly on the canvas with dividers.
4. **Keep the public landing direct.** Retain the concise product story and prepared part/drawing; reduce retail-like oversized colour treatment, deep rounded hero trays, perspective product renders, and decorative scrolling effects. A restrained hero visual is enough.
5. **Make selection quiet but obvious.** Use petrol text/indicator and the action tint for an active row. Preserve keyboard focus and do not rely on colour for state.
6. **Treat status as evidence, not decoration.** Every support/conflict/unknown state has readable text and nearby source context. Do not turn an unknown into a green pass or make a blue/petrol visual imply manufacturability.
7. **Keep motion functional.** Short state/selection feedback is allowed; automatic 3D turns, glow pulses, decorative parallax, and scroll-jacking are not. The existing user-supplied Chappe signal-form wordmark sequence is the single brand-specific exception, only when it follows the landing pattern, keeps core content available, and has a resolved static reduced-motion state.

## How it maps to the existing screen patterns

| Pattern | Modus-inspired application |
|---|---|
| Public landing | Off-white field, graphite copy, one petrol CTA, prepared part/drawing as the visual anchor, flat evidence columns, and no boxed copy over the visual |
| Engineer list and header | Compact structural toolbar and a divider-led list/table; maintain persistent job, facility, release, and decision context |
| Facility check | Comparable rows with documented fact, textual result, source, and next action; selected evidence opens in an inspector or detail view |
| Review desk | Operation list and detail inspector, with proposal/approved/unknown distinctions expressed in text and controlled status styling rather than card colour |
| Manufacturer workspace | Readable equipment table/profile with exact source and recency; no invented KPI dashboard |
| Operator phone | A genuine device/model frame may use the larger radius; inside it, keep the job/release, selected operation, approved step, and ask/flag actions flat and reachable |

## Ready-to-give implementation brief

Use the following prompt when handing this work to another coding chat:

> Use Trimble Modus 2.0 only as the visual and interaction reference for Chappe. Preserve all information architecture, routes, content, evidence labels, and behaviour. Do not install or import Modus components, branding, logos, icons, illustrations, fonts, screenshots, blue palette, gradients, glassmorphism, oversized rounded cards, fake dashboard metrics, or generic AI decoration. Refactor the existing CSS Modules and in-house primitives toward a compact technical application: off-white canvas, graphite text, petrol action colour, 4px controls, 6px functional surfaces, 12px device/media/dialog frames, hairline dividers, flat stacked rows, and shadows only for dialogs, canvases, print/QR output, or device frames. Ordinary copy, findings, lists, and action rows must not sit inside cards. Use `--ch-action*` tokens, retaining `--ch-blue*` only as compatibility aliases. Keep documented support, conflict, and unknown semantically distinct; do not imply manufacturing validation or AI certainty. Follow `docs/design-system/README.md` and `docs/design-system/patterns.md`, test wide and phone layouts, and record the exact visual checks.

## Review checklist

- Is every new colour, radius, border, and shadow a documented token or permitted surface rule?
- Does any paragraph, finding, or list have a decorative card behind it? If so, remove it unless it is an actual editing/media/print/device surface.
- Does the selected state use petrol/action tint without turning it into a safety status?
- Are action controls 44px reachable on phone where practical, keyboard focus visible, and labels clear without colour?
- Do the public part/drawing, engineer evidence, and phone operation remain legible at wide and narrow widths?
- Does the UI still distinguish prepared/synthetic evidence, proposals, documented support, conflict, and unknown accurately?
