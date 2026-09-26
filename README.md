# Chappe

Chappe connects design information to the person making a part. A stable per-part QR opens an evolving knowledge base with source files, documented manufacturer capabilities, approved guidance, floor flags, and engineer-approved answers. SkunkWorks is the team and repository name.

## Current implementation: supplied SolidWorks parts and AI prompts

The Next.js app accepts native `.SLDPRT` / `.SLDDRW` pairs as private sources, verifies their bytes, and can recover bounded cached PNG previews without sending files to a conversion service. It also accepts readable drawing PDFs and browser-viewable GLB or STL models. The supplied Engineering Test Block PDF is the source of its pitch facts; its supplied STL is an authorised visual reference only. Neither is present in the active source tree or Vercel deployment. See the [source inventory](docs/product/supplied-parts.md).

The part QR is available before guidance approval and stays stable when approved guidance changes. Signed-in workspace members can ask questions and submit text flags; designers/admins explicitly approve replies. Prewritten versioned prompts cover draft guidance, evidence-grounded questions, and unsent engineer reply suggestions. See the [prompt runbook](docs/ai/prompt-runbook.md).

This source implementation has passed local checks; **it is not a live-AI claim**. The repository is hosted through Vercel, which can run the Next.js server routes. Apply the reviewed migrations, configure its server-only environment, and verify a real signed-in round trip before presenting it as a live workflow. A live supplier profile, authenticated upload, engineer approval, anonymous QR access, and photo writes remain pending.

## Hosting

The connected Vercel deployment is the current hosting target. It serves the Next.js landing, sign-up/sign-in, engineer workspace, manufacturer view, operator phone routes, and server API surface in `src/app/api/`. Configure the exact Vercel project URL in the dashboard and use that URL for live links and QR labels; it is intentionally not hard-coded in this repository.

Authenticated designers can drag/drop or select a GLB or STL model, one or more technical drawing PDFs, and an optional authored bend manifest. Those files go through authorised upload and server hash verification. With a readable PDF and confirmed supplier/machine, the Pitch analysis panel can create cited, non-persistent capability, knowledge-base, phone-preview, and held-triage drafts without a bend manifest. Native CAD remains opaque provenance; the app does not interpret STEP or SLDPRT. A workspace admin can generate a verified-email invitation link for a fabricator, but this is currently workspace access, not a manufacturer-specific signup or automatic facility profile handoff. The invited fabricator must record and confirm a versioned facility profile before a designer can use its facts as evidence.

The old static pitch prototype remains in `site/` as an archived reference only. Its prepared local flow is not deployed, does not publish the supplied PDF/STL, and does not call OpenAI. The GitHub Pages deployment workflow has been removed.

Start with the [current product brief](docs/product/overview.md) and [build status](docs/integration/status.md). For UI/UX work, use the [canonical design system](docs/design-system/README.md) and [product design handoff](docs/product/design-start-here.md). The existing straight-bend sheet-metal example is a technical fallback; Engineering Test Block is the current pitch product.

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

1. Configure the connected **Vercel** project with `NEXT_PUBLIC_SUPABASE_URL=https://lzomgexzwxipbgdkgzbd.supabase.co`, its publishable key, and `SUPABASE_SERVICE_ROLE_KEY` as server-only environment variables. Keep the service key server-only.
2. Add `OPENAI_API_KEY`, `OPENAI_INITIAL_MODEL=gpt-6-astra`, and `OPENAI_FLOOR_MODEL=gpt-6-luna` as **server-only** Vercel environment variables (and in ignored `.env.local` for local tests). Astra is restricted to the initial capability scan and knowledge-base draft. Luna handles the draft phone preview, guide generation, phone Q&A, engineer reply drafts, and floor-issue triage. Never put an OpenAI key in a browser bundle, QR URL, or the archived `site/` prototype.
3. Review and tune the source-grounded instructions in `src/server/ai/prompts.ts`, then verify the response schema and source checks in `src/server/ai/validate-output.ts` against the prepared drawing/manifest packet. Run `npm run check` and a real signed-in generation/review/release round trip before presenting live AI as working.

The server has a [release-scoped question knowledge path](docs/ai/knowledge-base.md): it loads only authorized, hash-checked PDF pages, confirmed facility notes, and persisted engineer responses for the selected release and operation; retrieves bounded citable excerpts; includes the exact approved step as context; and checks model citations. `/api/questions` is member-only until a separate QR visitor exchange is verified. It requires the Vercel-hosted Next.js app and the server-only OpenAI key.
