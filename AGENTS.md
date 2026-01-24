# AGENTS.md

## Project overview

- Vite app targeting Cloudflare Workers (Hono). Deploys with Wrangler.
- Source lives in `src/` and static assets in `public/`.

## Available tools

- Hono framework
- React
- Cloudflare services
  - D1: Relational Database
  - R2: Object Storage
  - Workers KV: Temporary values; Session IDs, etc.
  - Durable Objects: Document Synchronization
- drizzle-orm
- tailwindcss

## Getting started

```txt
pnpm install
pnpm run dev
```

## Common commands

```txt
pnpm run dev        # local dev server
pnpm run build      # production build
pnpm run preview    # build then preview
pnpm run cf-typegen # generate CloudflareBindings types

pnpm run check      # RUN BEFORE FINISH to Check all: types, formatting, linting
pnpm run deploy     # DO NOT RUN: build then deploy via wrangler
```

## Notes for agents

- Use `pnpm` for installs and scripts.
- If you touch Worker bindings or Wrangler config,
  rerun `pnpm run cf-typegen` and update Hono generics in `src/index.ts` as needed.
- Run `pnpm run check` before finishing to ensure code quality.
