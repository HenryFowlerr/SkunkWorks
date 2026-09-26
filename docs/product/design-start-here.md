# Chappe UI/UX handoff

Read [the full product brief](overview.md) before making design decisions, then [current build status](../integration/status.md) before assuming a screen works. This page is a compact design map, not a replacement for Henry's walkthrough. Chappe is the product; SkunkWorks is the team. The final demonstration product and visual brand are undecided.

## The five-minute story

An engineer sends a prepared design to a chosen facility. Chappe shows what the facility's documented equipment can support, what conflicts with the design, and what remains unknown. It proposes short visual help for unusually complex operations. The engineer corrects and approves the exact guide before release. A floor operator scans the drawing's QR code, selects the relevant area of a lightweight model, follows only the approved difficult steps, and sends a contextual question or flag. Engineering sees the issue and approves a response or a revised release.

The demo may start with files already uploaded and use prepared visual output. Make a real action visibly different from prepared content. Do not claim a PDF excerpt typed by an engineer was automatically extracted, that a profile proves physical manufacturability, or that AI instructions are correct before review.

## Users and primary decisions

| User | Immediate question | Useful next action |
|---|---|---|
| Engineer/designer | Can this selected facility make the design as described? | Inspect cited facility facts, conflicts, and unknowns; fix the design, setup, or facility choice. |
| Engineer/designer | What should the floor actually see? | Inspect a proposed difficult operation, correct it, include or exclude detailed guidance, and approve a release. |
| Manufacturer lead | What has engineering sent us, and what equipment profile was used? | Confirm the profile and see the job, handoff, and open issues. |
| Floor operator | How do I do this difficult operation right now? | Scan, select the area, view a short approved sequence, ask or flag with context. |
| Engineer handling feedback | What is blocked on the floor? | Read the exact release/operation and issue, approve a clarification or publish a reviewed replacement. |

## Screen map

1. **Public website:** explain the engineering-to-workshop problem and Chappe's solution, show a believable example flow, lead to email sign-up/sign-in. This is the judges' entry URL.
2. **Engineer job list and job view:** show selected facility, source files, check results, generation status, and the current draft/release without burying the next decision.
3. **Engineer review desk:** distinguish proposal from approved content. Show evidence and uncertainty per claim, a short operation list, editable wording, an explicit include/exclude decision for detailed phone guidance, and review state before publication.
4. **Manufacturer desktop:** show a facility/equipment profile and received job context. This can remain modest for the demo, but its data must match the engineer's check.
5. **Print/QR view:** show the exact release version, label preview, and a small QR appropriate for the technical drawing. Older release links must remain distinguishable.
6. **Operator phone:** enter from a camera scan, identify the job/release, show a lightweight model as a navigation aid, select an area or operation directly, then reveal only the approved complex guidance. Keep ask, voice input, and flag actions reachable with large controls.
7. **Engineer issue view and floor response:** preserve the flag's job/release/operation, make a suggested answer visibly provisional, and show the approved answer or replacement release clearly to the operator.

The initial viewer is a straight-bend sheet-metal example with numbered bends. It is a starting implementation, **not** the committed demo part or a requirement that all future products use bends.

## States the design must communicate

- **Facility check:** supported by documented facts; conflict with documented facts; unknown because information or reachability evidence is missing. Never turn unknown into a green pass.
- **Guide:** AI proposal; engineer edited; explicit include/exclude for detailed guidance; reviewed; published immutable release. Routine shop knowledge should not become a long manual.
- **Source/evidence:** identify an attached drawing, verified authored geometry, or workshop profile and show when a claim lacks evidence. A source citation is context, not a safety certificate.
- **Floor feedback:** unsent draft; sent flag/question; awaiting engineer; approved response; acknowledged or revised release. Preserve operation context throughout.
- **System behavior:** loading, empty, unavailable, and permission states should say what happened and what the user can do next. A failed live AI call must not masquerade as a successful check.

## Current design boundaries

Focus on route clarity, hierarchy, and phone ergonomics. Henry's team will provide detailed brand language and output artwork later. The eventual illustrations/report format, final example product, and exact AI model are open decisions. Do not overbuild CAD editing, general collision simulation, enterprise manufacturing management, or a universal assembly manual for this five-minute demonstration.

For implementation-specific API vocabulary, use [architecture and contracts](architecture-and-contracts.md) and `src/contracts/`. For what can currently be clicked through, use [current build status](../integration/status.md); it is updated as work merges.
