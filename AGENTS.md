# AGENTS.md

## Project overview

- Vite app targeting Cloudflare Workers (Hono). Deploys with Wrangler.
- Source lives in `src/` and static assets in `public/`.

## Available tools

- Hono framework
- React
- Cloudflare services
  - D1
  - R2
- drizzle-orm
- tailwindcss

## Getting started

```txt
pnpm install
pnpm run dev
```

## Common commands

```txt
pnpm run dev       # local dev server
pnpm run build     # production build
pnpm run preview   # build then preview
npm run cf-typegen # generate CloudflareBindings types
pnpm tsc --noEmit  # typecheck only

pnpm run deploy    # DO NOT RUN: build then deploy via wrangler
```

## Notes for agents

- Use `pnpm` for installs and scripts.
- If you touch Worker bindings or Wrangler config,
  rerun `npm run cf-typegen` and update Hono generics in `src/index.ts` as needed.
- No test runner or lint script is configured; ask before adding new tooling.
