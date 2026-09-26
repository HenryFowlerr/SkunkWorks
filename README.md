# Chappe

Chappe is a website for clearer engineering-to-workshop prototype handoffs. Engineers select a facility, review documented capability gaps, approve visual guidance for unusually complex work, and send a QR-linked guide to the floor. Operators can ask or flag a problem in the context of the exact released operation. SkunkWorks is the team and repository name.

## Live website

**[Open the Chappe demo](https://henryfowlerr.github.io/SkunkWorks/)**. Follow the prepared Sensor Mount `SKW-SM-104` journey: choose the receiving facility, inspect documented support/conflict/unknown, approve the focused B2 guide, open its QR-linked phone view, flag a concern, and answer it from the engineer view. The live demo session, guide approval, issue, hold decision, and response are stored in the existing **Chappe** Supabase project. The drawing, authored bend manifest, illustrative model, facility profiles, and proposed guide are **prepared synthetic demo data**. The site labels that scope throughout.

For a phone scan without setting up an engineer session, use the permanent QR on the landing page or open the [read-only phone preview](https://henryfowlerr.github.io/SkunkWorks/#/phone-preview). This preview shows prepared, approved example content and makes no Supabase writes. For the interactive flag-and-response pitch, create a session in the engineer journey and scan its session-specific QR instead.

The public engineer and manufacturer pages are separate task views. Engineering opens to a jobs overview with the prepared Sensor Mount job and a file drop area. A new job draft saves only a project name, selected file names, and manufacturer choice in that browser; file contents are not uploaded or interpreted. Opening Sensor Mount leads to its separate prepared review journey. A new manufacturer can be added to the local list and given a preview link or email draft. The recipient can fill an equipment/limits draft in their own browser, but this Pages preview does not create an account, send the email, or sync that draft back to the engineer. The authenticated Next.js intake and workshop APIs are the path toward that full flow.

In the unhosted Next.js app, authenticated designers can drag/drop or select a GLB model export, one or more technical drawing PDFs, and an optional authored bend manifest. Those files go through the existing authorized upload and server hash verification flow. Native CAD files still need a viewable GLB export; the app does not interpret STEP or SLDPRT. A workspace admin can generate a verified-email invitation link for a fabricator, but this is currently workspace access, not a manufacturer-specific signup or automatic facility profile handoff. The invited fabricator must record and confirm a versioned facility profile before a designer can use its facts as evidence.

GitHub Pages hosts this static pitch journey from `site/`; it cannot run the Next.js server routes in `src/app/api/`. The Next.js landing, sign-up/sign-in, engineer workspace, manufacturer view, and operator phone routes remain in this repository and pass local build checks, but are **not hosted by Pages**. Production job uploads, authenticated release publication, and QR visitor feedback are not claimed as deployed flows. The public demo uses a separate, time-limited Supabase Edge Function and demo-only tables.

Start with the [current product brief](docs/product/overview.md) and [build status](docs/integration/status.md). For UI/UX work, use the [canonical design system](docs/design-system/README.md) and [product design handoff](docs/product/design-start-here.md). The existing straight-bend sheet-metal example is a technical demo asset; the final pitch product is undecided.

## Local development

Requirements: Node.js 24 or newer and npm. Copy `.env.example` to `.env.local` and fill in the existing Chappe project URL, publishable key, and server-only service-role key. Do not commit `.env.local`. The app reports provider/configuration failures when credentials are absent.

```sh
npm ci
npm run dev
```

Useful checks:

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run check
```

For API and data-model details, see [architecture and contracts](docs/product/architecture-and-contracts.md) and the current `src/contracts` schemas. Treat the older team coordination documents as historical context.

## Next phase: OpenAI-backed generation

1. Deploy the **Next.js app** to a host that runs server routes, with `NEXT_PUBLIC_SUPABASE_URL=https://lzomgexzwxipbgdkgzbd.supabase.co`, its publishable key, and `SUPABASE_SERVICE_ROLE_KEY` set in the host's environment. Keep the service key server-only.
2. Add `OPENAI_API_KEY` and `OPENAI_MODEL` as **server-only** environment variables on that host (and in ignored `.env.local` for local tests). No OpenAI key is used by GitHub Pages or `site/config.js`.
3. Review and tune the source-grounded instructions in `src/server/ai/prompts.ts`, then verify the response schema and source checks in `src/server/ai/validate-output.ts` against the prepared drawing/manifest packet. Run `npm run check` and a real signed-in generation/review/release round trip before presenting live AI as working.

The server now has a [release-scoped question knowledge path](docs/ai/knowledge-base.md): it loads only authorized, hash-checked PDF pages, confirmed facility notes, and persisted engineer responses for the selected release and operation; retrieves bounded citable excerpts; includes the exact approved step as context; and checks model citations. `/api/questions` is member-only until a separate QR visitor exchange is verified. It requires a server-capable Next.js host and the OpenAI key; the Pages phone demo does not call it.

The Pages journey deliberately uses prepared guide text and a human-written engineer response while model and prompt tuning remain for this next phase.
