# Five-minute pitch: AI-ready handoff

The pitch is staged around a prepared part packet so the presenter never waits for an upload or model response. The archived static prototype labels its results **Prepared pitch analysis**; the Vercel-hosted app uses the server route described below when its environment is configured. The default packet is the supplied Engineering Test Block: `Engineering test block (1).pdf` and `Engineering test block (1).STL`. No public deployment publishes those source files or claims that the retained native SolidWorks files were read.

The same response shapes are available in the Next.js server for a real, authenticated run. They are drafts for an engineer to review, never a production release, a safety decision, or proof that a machine can make a part.

## What the presenter shows

1. Open the preloaded part packet and show the drawing/model sources as uploaded.
2. Select a known supplier, or use **Add supplier** to show the invitation/profile entry point.
3. Run the prepared capability check. It reports documented support, direct conflict, or missing supplier/setup evidence with a short code.
4. Reveal the prepared knowledge-base draft: source summary, selected supplier, concise phone steps, 2–5 attention cards, and open engineering questions. Use the embedded draft phone preview to ask Luna a question from that exact draft.
5. Move through engineer review, the printable stable part QR, the phone guide, a floor flag, and the engineer-facing triage draft.

The Engineering Test Block drawing is readable evidence for the pitch route and its STL is a browser-viewable visual reference. The static packet only uses drawing facts that were captured from the PDF: a 60 × 60 × 60 mm envelope, Ø10 mm typical holes, and 15 mm / 30 mm callouts. Its material and finish fields are unresolved. `Ridgeway Precision Machining` is explicitly a prepared CNC profile for the demo, not a real supplier record. `Sensor Mount` remains a labelled synthetic fallback. The manufacturing test sheet still needs a readable drawing export. An API key alone cannot interpret `.SLDPRT` or `.SLDDRW` as trusted drawing evidence.

## Prompt contracts

The contracts are defined in `src/server/ai/pitch.ts`; the server-only adapter is `src/server/ai/pitch-openai.ts`.

| Contract | Produces | Authority boundary |
| --- | --- | --- |
| `capability-scan.v1` | Small supplier comparison rows, a result code, required engineer decisions, and citations | A clear result needs at least one supported row cited to both the readable drawing and confirmed supplier/machine evidence. It is not a claim of safety, collision clearance, setup verification, or production approval. |
| `part-knowledge-base.v1` | Source summary, concise candidate phone steps, up to five attention cards, and open questions | The whole result has `approvalState: "draft"`. Every step and attention card has an exact citation. |
| `draft-phone-preview.v1` | A concise Luna answer from the exact server-held draft knowledge base | Engineer-only pitch preview. It cannot become released floor guidance, a QR destination, a flag, or a reply. |
| `floor-issue-triage.v1` | Engineer-facing summary, known/unknown split, severity, required decision, and a short suggested reply | The floor report is an observation. The result cannot resolve the issue, clear a hold, or send a reply. |

All three prompts treat document text, file names, supplier notes, and floor reports as untrusted data. The initial capability call receives the server-authorized, hash-checked drawing PDF as a high-detail `input_file` alongside extracted text/citations. When the selected STL is small and valid, the server also derives a compact four-angle PNG montage and sends that as visual orientation context; raw STL and native CAD bytes never reach the model. The montage is not citable evidence and cannot support a dimension, material, tolerance, process, clearance, feasibility, or equipment-capability claim. Knowledge-base and triage calls use the bounded extracted evidence only, avoiding duplicate document or visual-file cost. The adapter sends a strict JSON Schema through the Responses API, uses `store: false`, validates output with Zod, and rejects citations whose source key or quoted excerpt does not match the server-selected evidence. This follows OpenAI's [Structured Outputs guidance](https://developers.openai.com/api/docs/guides/structured-outputs); structured shape does not establish engineering truth.

## Authenticated product path

The designer's job review page now exposes **Pitch analysis for readable drawings** whenever the job has a verified drawing PDF plus a selected supplier/machine. It calls the typed `POST /api/jobs/:jobId/pitch` route with four server-owned actions:

- `capability` makes one provider call and returns a cited supplier-check draft;
- `knowledge_base` reuses the prior verified capability result held in local server memory and makes one provider call only when it is clear for engineer review;
- `preview_question` sends only that exact short-lived server-held draft to Luna for a clearly labelled engineer-controlled phone preview; it never reads browser-provided content, creates a release, exposes a QR, or sends a floor response;
- `triage` accepts a short floor observation, rebuilds the trusted source packet on the server, and returns an engineer-facing **hold** draft. It never accepts a browser-provided knowledge base or sends a reply.

The browser contract lives in `src/contracts/pitch.ts`; `api.jobs.pitch` validates both request and response shapes. The verified capability cache is scoped to the authenticated actor, job version and server-calculated input fingerprint. It expires with the pitch safety window (ten minutes by default) and disappears on a server restart, at which point the engineer must run capability again. The result is intentionally non-persistent for the pitch: a refresh cannot turn an AI draft into released guidance. The existing controlled draft/review/publish path remains the only route to an approved QR knowledge base and floor response.

The authenticated manufacturer handoff now displays the selected drawing PDF using a short-lived authorized link, offers an open/download action, and loads a selected GLB or STL as a visual reference. This lets a supplier inspect the Engineering Test Block packet before engineering approves guidance, while the page still labels it as retained source material rather than a manufacturing release.

## Adding the real provider

Configure only the server environment:

```dotenv
OPENAI_API_KEY=...
OPENAI_INITIAL_MODEL=gpt-6-astra
OPENAI_FLOOR_MODEL=gpt-6-luna
OPENAI_TIMEOUT_MS=25000
PITCH_AI_MAX_REQUESTS_PER_WINDOW=2
PITCH_AI_REQUEST_WINDOW_MS=600000
PITCH_AI_CAPABILITY_MAX_OUTPUT_TOKENS=1200
PITCH_AI_KNOWLEDGE_BASE_MAX_OUTPUT_TOKENS=1800
PITCH_AI_TRIAGE_MAX_OUTPUT_TOKENS=900
PITCH_AI_PREVIEW_QUESTION_MAX_OUTPUT_TOKENS=750
```

`OPENAI_INITIAL_MODEL` is set to `gpt-6-astra` and is used only for the pitch capability scan and knowledge-base draft. `OPENAI_FLOOR_MODEL` is set to `gpt-6-luna` and is used for the pitch phone preview, pitch issue triage, guide generation, phone Q&A, and engineer reply drafts. The floor setting has no fallback to `OPENAI_MODEL`, so an Astra-only legacy setup fails closed rather than serving the floor with the wrong model. Both must remain Responses API models enabled for strict structured outputs in the deployment account. Do not copy any of these values into `NEXT_PUBLIC_*`, the static `site/` demo, QR URLs, browser storage, or logs. Pitch requests default to two per authenticated actor/job/action over ten minutes; values may be reduced, but cannot exceed three requests or a one-hour window. Output ceilings default to 1,200 / 1,800 / 900 / 750 tokens and cannot exceed 1,600 / 2,400 / 1,200 / 1,000 respectively. A third capability, triage, or phone-preview request returns `429 RATE_LIMITED`, a `Retry-After` header and a clear wait message before the provider is called. Concurrent knowledge-base requests for the exact same verified input share one server-memory provider call and draft. This is a process-local demo guard; a multi-instance production deployment needs a shared rate limiter.

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
