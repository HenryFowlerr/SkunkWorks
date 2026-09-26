# Chappe

Chappe is a website for clearer engineering-to-workshop prototype handoffs. Engineers select a facility, review documented capability gaps, approve visual guidance for unusually complex work, and send a QR-linked guide to the floor. Operators can ask or flag a problem in the context of the exact released operation. SkunkWorks is the team and repository name.

Start with the [current product brief](docs/product/overview.md) and [build status](docs/integration/status.md). For UI/UX work, use the [canonical design system](docs/design-system/README.md) and [product design handoff](docs/product/design-start-here.md). The existing straight-bend sheet-metal example is a technical demo asset; the final pitch product is undecided.

## Local development

Requirements: Node.js 24 or newer and npm. Copy `.env.example` to `.env.local` and fill in the Chappe Supabase project values plus a server-side OpenAI API key/model when ready. Do not put secrets in `NEXT_PUBLIC_` variables. The app reports provider/configuration failures when credentials are absent.

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
