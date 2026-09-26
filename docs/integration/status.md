# Current build status

Updated 27 September 2026. This is the concise handoff for new SkunkWorks/Chappe coding or design work. Read [the product brief](../product/overview.md) first. Older `AGENT_HANDOFF.md` and `docs/coordination/team-*.md` record stopped workstreams and are not current instructions.

## Current Vercel-ready workflow

- **Editorial interface refresh, 27 September:** The deployed Next landing now uses an original paper/ink/blue desktop story with an illustrative part visual, explicit evidence boundaries, and direct Engineering and Manufacturing entry points. The signed-in Engineering index presents projects as a truthful source/facility/handoff table; Manufacturing uses matching handoff and facility-evidence tables. This is presentational only: API routes, session behaviour, source privacy, and approval rules are unchanged.
- **Part knowledge and inputs:** Native SolidWorks part/drawing pairs are retained privately and byte-verified. Readable drawing PDFs supply cited technical evidence; GLB/STL models are authorised visual references only. The supplied Engineering Test Block PDF is the pitch evidence packet and its STL is visual-only. Both source files are excluded from the active source tree and Vercel deployment.
- **Stable QR:** A QR identifies the part, not a formal CAD revision. Current approved knowledge can evolve behind that stable part address. Internal release records remain approval/audit context. Access checks still apply; a known part ID is not an access credential.
- **AI roles:** Astra is limited to the initial capability scan and knowledge-base draft. Luna handles floor Q&A, guide/phone drafts, floor-issue triage, and concise engineer-report drafts. All prompts are versioned server code with typed inputs, source/citation checks, and explicit engineer approval boundaries.
- **Floor loop:** The secured Next `OperatorFloor` displays an authorised GLB/STL visual reference with the selected released step and a compact **Quick assist** dock. It sends the exact published release and selected operation to `/api/questions` (Luna). Any answer can become a prefilled, release-scoped flag. The engineer desk prepares the concise Luna report for human review; it does not automatically send an engineering response or clear a hold.
- **QR visitor access:** Visitor-token exchange is not wired yet. The server routes currently require an authenticated member session. Configure the provider environment, apply migrations, and run an authenticated end-to-end path before implementing and presenting anonymous QR access.

## PR #24 audit

PR [#24](https://github.com/HenryFowlerr/SkunkWorks/pull/24) was a static prototype, not the live knowledge-base integration. Its 3D floor chat and report were browser templates backed by the separate `chappe-demo` Edge Function; they did not call `/api/questions`, `/api/flags`, the Astra pitch route, or Luna. Its `site/assets` PDF and STL were byte-for-byte copies of the supplied Engineering Test Block inputs. Those source assets, the static floor renderer, and the Pages workflow have been removed from the active tree; do not reintroduce or deploy them. The Vercel-ready Next flow above is the integration point.

## Hosting

- Vercel is the active hosting target. It runs the Next.js app and same-origin API routes. Configure the exact deployment URL, server-only Supabase/OpenAI environment variables, and production domain settings in the connected Vercel project.
- The GitHub Pages deployment workflow has been removed from this repository. `site/` is an archived local/static prototype only; it is not the Vercel application and must not receive source files or provider keys. If repository settings still serve an old Pages artifact, disable Pages there as well.

## Validation on this workstream

`npm run check` passed TypeScript, ESLint, **380 Vitest tests in 63 files**, and a Next production build. `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/skunkworks-playwright-browsers npm run test:e2e` passed **10/10** desktop/mobile checks, including an authorised private-GLB fixture, the Quick assist request, the prefilled contextual flag, and the internal `/demo` redirect. Static JavaScript syntax and diff checks also passed.

These are local and fixture-backed checks. They are not a live account, provider, database, supplier, or QR visitor run.

## Required before a live pitch claim

1. Apply the reviewed native-source, member-feedback, and STL migrations to the intended Supabase project.
2. Configure server-only Supabase and OpenAI variables in Vercel. Keep the service-role and OpenAI keys out of browser bundles, QR URLs, and `site/`.
3. Upload the supplied PDF/STL through an authenticated workspace, create and confirm the actual supplier profile, then inspect capability citations and the engineering approval step.
4. Run a real signed-in generation, release, floor-question, flag, engineer-reply, and phone-read round trip. Implement QR visitor exchange separately before using it with unauthenticated floor devices.

## Historical context

The repository retains earlier GitHub Pages/Sensor Mount work, old deployment records, and previous migration notes in Git history and older coordination documents. They are historical reference only. The static prototype is not a current product deployment, does not use OpenAI, and must not be used to publish supplied source material.

## Working rules

- Treat [the product brief](../product/overview.md) as the current scope.
- Keep provider secrets server-side and source files private.
- Surface documented conflicts and unknowns. Do not claim arbitrary manufacturability or AI instruction accuracy.
- Engineers explicitly review and approve guidance and replies before the floor receives them.
