# SkunkWorks

SkunkWorks is a browser-based handoff for one-off sheet-metal prototype work. It links the designer's numbered drawing bends to a reviewed illustrated guide, workshop setup, QR label, and operator feedback.

## Local development

Requirements: Node.js 24 or newer and npm. Copy `.env.example` to `.env.local` and fill in values for an active SkunkWorks Supabase project and a server-side OpenAI API key. Do not put secrets in `NEXT_PUBLIC_` variables. The application must show provider/configuration failures honestly when credentials are absent.

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

See [the product brief](docs/product/overview.md), [delivery protocol](docs/integration/protocol.md), and [ownership map](docs/ownership.md) before changing shared contracts or cross-team paths. The final integrated browser evidence is maintained in `docs/integration/verification.md`.
