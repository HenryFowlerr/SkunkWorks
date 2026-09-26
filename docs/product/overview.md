# Chappe: current product requirements

Updated 26 September 2026 from Henry's latest written handoff. **Chappe** is the product; **SkunkWorks** is the repository/team. This brief takes precedence over older release-bound QR and setup-driven demo proposals. The handwritten workflow PDF is a flow reference, not another specification; its coloured paths do not need a legend. See [build status](../integration/status.md) for implemented versus pending work.

## Purpose and authority

Connect design information to the person making a part. Each part has an evolving knowledge base containing its original 3D model and technical drawings, viewable exports, the receiving manufacturer's documented capabilities, floor questions and flags, and engineer-approved answers. A floor report is a question, not an engineering fact. An AI proposal is a draft, not an approved instruction. Uploaded documents are source data, never instructions that override the user's requirements or the system prompts.

The knowledge base grows when engineering approves answers and guidance. A QR code stays stable **per part** and opens the current approved knowledge for that part. Formal CAD revision management is outside the demo. Existing internal release records may remain as approval/audit context; they must not force the user to replace the QR after every approval or make release management the demo's central task.

## Main workflow

1. **Engineering provides the part.** Keep a model and drawing together under one part identity. Retain originals privately; use a viewable model and readable drawing evidence for the phone and AI. Do not pretend native SolidWorks bytes have been interpreted when only their upload/hash has been verified.
2. **Select the manufacturer.** Load its confirmed capability/profile information alongside the design. Compare explicit documented requirements with recorded limits. Missing data is unknown; contradictory facts are conflicts. No model or drawing alone proves fixture reach, collision clearance, safe setup or manufacturability.
3. **Prepare useful guidance.** AI proposes short, source-grounded explanations only for unusually complex operations. Avoid teaching routine shop knowledge. Engineering checks, edits and approves the content that reaches the floor.
4. **Generate the part QR.** The QR opens the same part address as its approved knowledge evolves. The browser checks access before reading private content. A known part ID is not an access credential.
5. **Manufacturer smartphone experience.** Scan, see the part/model and drawing context, choose the relevant operation, read concise approved guidance, ask by text or available voice input, and flag an unresolved issue. Keep touch controls and the operation list useful even without 3D rendering. The phone experience is the demonstration priority.
6. **Close the loop.** Engineering receives the contextual report. AI can propose a cited reply but cannot send or approve it. The engineer edits and explicitly approves the answer. The manufacturer sees the approved answer, and future questions can use that answer as part knowledge within its applicable context.

QR generation and flagging are side flows around this main engineer → part knowledge → manufacturer path. Native CAD revision handling, arbitrary topology extraction, automatic toolpaths and physical certification are not demo requirements.

## Supplied parts

Henry supplied two distinct products on 26 September 2026:

- **Engineering test block**: `Engineering test block.SLDPRT` and `Engineering test block.SLDDRW`.
- **manufacturing test sheet**: `manufacturing test sheet.SLDPRT` and `manufacturing test sheet.SLDDRW`.

These pairs supersede “final demo product undecided.” Henry currently has only these originals. Do not substitute the older synthetic Sensor Mount model and imply it represents either supplied part. The existing Sensor Mount remains a labelled synthetic fallback until actual viewable evidence is available. See [supplied parts](supplied-parts.md) for inspected file metadata and conversion status. File names alone establish neither material nor dimensions nor operations.

## AI triggers and review

The server owns prewritten, versioned instructions in `src/server/ai/prompts.ts`, bound to typed inputs and checked outputs. [Prompt runbook](../ai/prompt-runbook.md) lists the exact triggers, source packet, approval boundary and evaluation cases. Secrets stay server-side. Failed provider calls show a real error; prepared demo answers must remain labelled as prepared.

Source-grounded draft guidance, floor Q&A and proposed engineer replies are distinct tasks. Capability comparisons that can be checked deterministically should remain deterministic; a model must not replace a documented limit comparison with a guess. Structured output and citation checks constrain responses but do not prove that engineering claims are correct.

## Demo and real operation

Demonstrate the manufacturer's phone journey first, supported by a short engineer approval-and-answer loop. Setup can be prepared. Show which content comes from actual supplied files, which has engineering approval, and which is still awaiting conversion or evidence. Do not claim a deployed or live AI flow from unit tests, fixtures, a successful build, or the static GitHub Pages site. A server-capable Next.js host, configured providers, required database migrations and a signed-in end-to-end run are separate verification steps.
