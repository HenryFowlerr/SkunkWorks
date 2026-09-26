# Five-minute pitch: AI-ready handoff

The pitch is staged around a prepared part packet so the presenter never waits for an upload or model response. The public Pages demo labels those results **Prepared pitch analysis**. Its default packet is the supplied Engineering Test Block: `Engineering test block (1).pdf` and `Engineering test block (1).STL`. It does not contain an API key, call OpenAI, publish those source files, or claim that the retained native SolidWorks files were read.

The same response shapes are available in the Next.js server for a real, authenticated run. They are drafts for an engineer to review, never a production release, a safety decision, or proof that a machine can make a part.

## What the presenter shows

1. Open the preloaded part packet and show the drawing/model sources as uploaded.
2. Select a known supplier, or use **Add supplier** to show the invitation/profile entry point.
3. Run the prepared capability check. It reports documented support, direct conflict, or missing supplier/setup evidence with a short code.
4. Reveal the prepared knowledge-base draft: source summary, selected supplier, concise phone steps, 2–5 attention cards, and open engineering questions.
5. Move through engineer review, the printable stable part QR, the phone guide, a floor flag, and the engineer-facing triage draft.

The Engineering Test Block drawing is readable evidence for the pitch route and its STL is a browser-viewable visual reference. The static packet only uses drawing facts that were captured from the PDF: a 60 × 60 × 60 mm envelope, Ø10 mm typical holes, and 15 mm / 30 mm callouts. Its material and finish fields are unresolved. `Ridgeway Precision Machining` is explicitly a prepared CNC profile for the demo, not a real supplier record. `Sensor Mount` remains a labelled synthetic fallback. The manufacturing test sheet still needs a readable drawing export. An API key alone cannot interpret `.SLDPRT` or `.SLDDRW` as trusted drawing evidence.

## Prompt contracts

The contracts are defined in `src/server/ai/pitch.ts`; the server-only adapter is `src/server/ai/pitch-openai.ts`.

| Contract | Produces | Authority boundary |
| --- | --- | --- |
| `capability-scan.v1` | Small supplier comparison rows, a result code, required engineer decisions, and citations | A clear result needs at least one supported row cited to both the readable drawing and confirmed supplier/machine evidence. It is not a claim of safety, collision clearance, setup verification, or production approval. |
| `part-knowledge-base.v1` | Source summary, concise candidate phone steps, up to five attention cards, and open questions | The whole result has `approvalState: "draft"`. Every step and attention card has an exact citation. |
| `floor-issue-triage.v1` | Engineer-facing summary, known/unknown split, severity, required decision, and a short suggested reply | The floor report is an observation. The result cannot resolve the issue, clear a hold, or send a reply. |

All three prompts treat document text, file names, supplier notes, and floor reports as untrusted data. The adapter sends a strict JSON Schema through the Responses API, uses `store: false`, validates output with Zod, and rejects citations whose source key or quoted excerpt does not match the server-selected evidence. This follows OpenAI's [Structured Outputs guidance](https://developers.openai.com/api/docs/guides/structured-outputs); structured shape does not establish engineering truth.

## Authenticated product path

The designer's job review page now exposes **Pitch analysis for readable drawings** whenever the job has a verified drawing PDF plus a selected supplier/machine. It calls the typed `POST /api/jobs/:jobId/pitch` route with one of three server-owned actions:

- `capability` returns a cited supplier-check draft;
- `knowledge_base` first reruns the capability check and returns a knowledge-base draft only when it is clear for engineer review;
- `triage` accepts a short floor observation, rebuilds the trusted source packet on the server, and returns an engineer-facing **hold** draft. It never accepts a browser-provided knowledge base or sends a reply.

The browser contract lives in `src/contracts/pitch.ts`; `api.jobs.pitch` validates both request and response shapes. The result is intentionally non-persistent for the pitch: a refresh cannot turn an AI draft into released guidance. The existing controlled draft/review/publish path remains the only route to an approved QR knowledge base and floor response.

The authenticated manufacturer handoff now displays the selected drawing PDF using a short-lived authorized link, offers an open/download action, and loads a selected GLB or STL as a visual reference. This lets a supplier inspect the Engineering Test Block packet before engineering approves guidance, while the page still labels it as retained source material rather than a manufacturing release.

## Adding the real provider

Configure only the server environment:

```dotenv
OPENAI_API_KEY=...
OPENAI_MODEL=...
OPENAI_TIMEOUT_MS=25000
```

`OPENAI_MODEL` must be a Responses API model enabled for strict structured outputs in the deployment account. Do not copy any of these values into `NEXT_PUBLIC_*`, the static `site/` demo, QR URLs, browser storage, or logs.

The server path must assemble the packet itself after authorizing the job and supplier selection. It must use only hash-checked readable drawing evidence and confirmed supplier profile data. The client must never choose raw source text, citations, machine capabilities, or approval status. A live response remains a draft and needs an explicit engineer review before it becomes phone guidance or an answer to a floor flag.

## Evidence required for a real run

For the current implementation, prepare:

- a readable PDF export of the drawing for each part;
- a browser-viewable GLB or STL if the phone should show a 3D model;
- a confirmed supplier/machine profile with source-backed capabilities;
- the existing bend-manifest data where the geometry-backed generation path is used.

For this supplied part, upload `Engineering test block (1).pdf` as the technical drawing and `Engineering test block (1).STL` as the STL visual reference. Select a confirmed supplier profile and machine before starting pitch analysis. The readable-drawing pitch route does not require the bend manifest; the older bend-guide generation route still does.

The native originals are retained privately for provenance. Cached thumbnails or a filename are not a drawing extraction, a 3D model, a dimension, or a capability assertion. If any evidence is absent or ambiguous, the capability result must ask for supplier or engineer input rather than present a pass.

## Before describing it as live

Apply the STL migration, then run an authenticated server-hosted request with the Engineering Test Block PDF and a real selected supplier profile. Inspect every citation, test both a direct supplier conflict and an unknown setup fact, and confirm that an engineer must still approve the result. Then test a floor flag end to end and verify that the draft triage cannot send a response without the engineer action. The static pitch flow remains useful for rehearsal even when the hosted run is not configured.
