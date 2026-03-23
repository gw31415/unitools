# AGENTS.md

## IMPORTANT

- Use `pnpm` as the package manager. DO NOT use `npm` or `yarn`.
- Use `vite-plus` (`vp`) as the primary toolchain command.

## Technology Stack

- Hono framework
- React
- Cloudflare services
  - D1: Relational Database
  - R2: Object Storage
  - Workers KV: Temporary values; Session IDs, etc.
  - Durable Objects: Document Synchronization
- drizzle-orm
- tailwindcss

## Common commands

```txt
pnpm preview    # build then preview
pnpm cf-typegen # generate CloudflareBindings types

pnpm check      # RUN BEFORE FINISH to check format/lint/type via vite-plus

pnpm deploy     # DO NOT RUN: build then deploy via wrangler
```

## Notes for agents

- Use `pnpm` for installs and scripts.
- Run `pnpm check` before finishing to ensure code quality.
