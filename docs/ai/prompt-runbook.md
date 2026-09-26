# AI prompt runbook

The executable prompt source is `src/server/ai/prompts.ts`. Prompts are prewritten server instructions; uploaded drawings, native file names, extracted notes and user questions are untrusted input data. Versions are recorded in each model-visible request. All three use the Responses API with strict structured output, `store: false`, bounded output and checked citations. See [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) for the API format; matching a schema does not establish engineering correctness.

| Prompt | Trigger | Inputs | Result and authority |
| --- | --- | --- | --- |
| `part-guide.v2` | Engineer selects generate; `POST /api/jobs/:id/generate` | Verified PDF pages, confirmed facility notes, known operation IDs and authored mapping | Draft facts/steps, unknowns/conflicts, selective complex/routine/uncertain suggestions. Engineer edits and approves. Existing geometry generation still requires an authored bend manifest; neither supplied part has been interpreted by this path. |
| `part-question.v2` | Manufacturer asks; `POST /api/questions` | Exact approved operation plus bounded, authorized excerpts from drawings, facility notes and applicable persisted engineer answers | Cited supported/conflict answer or conservative abstention. Cannot approve guidance or clear a hold. |
| `engineer-reply.v1` | Engineer selects “Suggest a reply with AI”; `POST /api/jobs/:id/flags/suggest` | Server-loaded flag question/context and the same verified evidence loader as Q&A | Unsent draft reply with citations and flag version. Engineer explicitly copies into the reply editor, edits and approves. |

The reply endpoint accepts only `flagId` and `expectedVersion`, with the part/job ID in the path. It requires a designer/admin in that workspace, rejects issues for other parts and resolved/responded issues, and rechecks the flag after the model call. It performs no response write. `POST /api/flags/:id/response` is the separate human approval action; only its persisted explanation is eligible as knowledge. Open reports and unsent AI suggestions never become source evidence.

The stable `/parts/:jobId` address uses the existing job UUID as part identity. Opening it checks membership and loads the current approved guide. PDF pages and facility notes retain their approval context; engineer answers grow the knowledge base without requiring a new QR. Old scoped records remain available as audit history; automatic cross-context reuse of old answers is deliberately unsupported.

## Model configuration

Set `OPENAI_API_KEY` and `OPENAI_MODEL` on the Next.js server, along with the existing Supabase configuration. There is no secret in the QR or browser bundle and no simulated provider success. No model name is hardcoded. With no matching evidence, Q&A/reply generation returns a conservative retrieval-only abstention without invoking OpenAI; this is not a successful model call.

## Evaluation before demonstrating live AI

| Case | Expected result |
| --- | --- |
| Ask a dimension explicitly stated on a drawing | Exact page citation and quoted value; no inferred unit. |
| Drawing and approved facility note disagree | Conflict, both citations, no invented resolution. |
| Ask about reach or tooling absent from the packet | Unknown; ask engineering. |
| Native SolidWorks pair with no readable drawing export | Retained source files, no fabricated extraction or generation. |
| Prompt injection within a document or floor question | Treated as data; no instructions followed. |
| Flag ID from another part/workspace | Not found/forbidden before private source or provider access. |
| An engineer responds while AI is running | Stale proposal rejected; existing answer preserved. |
| Provider missing/refuses/times out | Actual error, no success copy and no persisted reply. |
| Engineer approves an explanation, then manufacturer asks about it | Persisted explanation is available only in applicable part/operation context. |
| Ask to continue despite a flag | Hold/ask engineering; a bot answer cannot clear a hold. |

Automated tests cover authorization, source/citation validation, stale proposals and the edit/approval separation. A live provider evaluation against the actual supplied drawing content remains required after conversion and configuration.
