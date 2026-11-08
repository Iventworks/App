# CLAUDE.md — Claude Code specifics

Read `AGENTS.md` first. This file adds Claude-Code-specific notes.

## Slash commands

Defined in `.claude/settings.json`:

- `/api-client` — regenerate the typed API client (boots the API in-process; no dev server needed).
- `/db` — run Drizzle migrations.
- `/verify` — typecheck + tests.
- `/typecheck` — `bun run typecheck` (`nuxt typecheck` + `tsc`, includes `server/`).
- `/test` — `bun test`.
- `/dev` — start/inspect the dev setup.

## MCP servers

`mcpServers` in `.claude/settings.json` and `.vscode/mcp.json` both register `nuxt` and `nuxt-ui`.

## Backend in `server/`

This is the full-stack shape: Hono lives in `server/lib/api`, mounted at `/api` by
`server/routes/api/[...].ts`, and initialized by `server/plugins/startup.ts`. After changing a
backend route, regenerate the client with `bun run api-client:generate`. Never hand-edit
`app/api-client/*.gen.ts`.

## Frontend conventions

- Route access rules live in `app/middleware/auth.global.ts`. The template is deliberately rich;
  delete unused parts instead of working around them.
- Reference components by their Nuxt auto-import names (`DashboardDataTable`,
  `DashboardPageHeader`, `FormDateRangePicker`, `CampsStatsCard`, …). Don't add explicit imports that only the
  `<template>` uses: Biome can't see template usage, reports them as unused, and an `--unsafe` fix
  would delete them.
- If a `<script>` binding is used as a type there and as a value in the `<template>` (e.g. a Zod
  schema for `UForm :schema`), also reference it as a value in `<script>`
  (`const createSchema = zPostAdminUsersBody`). Otherwise Biome's `useImportType` safe fix turns it
  into `import type` and breaks the page at runtime.
- In `.vue` files, Biome *warnings* about unused variables/imports are expected (template usage).
  Biome *errors* are not.
- Per-user stores live in `app/composables/stores/` (`useUserInfoStore`).
  Clear them on logout; the login page refreshes them for the new session.

## CMP-specific notes

Project-wide rules and deviations from the style guide (prefixes, port, roles, SSR/PWA) live in
the "CMP-specific rules and exceptions" section of `AGENTS.md`.
