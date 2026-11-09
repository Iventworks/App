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

Orgs first: every query on an org table needs `inOrg(table)`, every insert `org_id:
OrgContext.id()` — the tenant guard throws otherwise (AGENTS.md › Orgs). After schema changes run
`bun test tests/cross-org-security.test.ts`.

This is the full-stack shape: Hono lives in `server/lib/api`, mounted at `/api` by
`server/routes/api/[...].ts`, and initialized by `server/plugins/startup.ts`. After changing a
backend route, regenerate the client with `bun run api-client:generate`. Never hand-edit
`app/api-client/*.gen.ts`.

## Frontend conventions

- Route access rules live in `app/middleware/auth.global.ts`. The template is deliberately rich;
  delete unused parts instead of working around them.
- Reference components by their Nuxt auto-import names (`DashboardDataTable`,
  `DashboardPageHeader`, `DashboardSectionCard`, `DashboardStatCard`, `ImgAppLogo`,
  `FormMarkdownEditor`, `FilesBrowser`, …). Don't add explicit imports that only the
  `<template>` uses: Biome can't see template usage, reports them as unused, and an `--unsafe` fix
  would delete them.
- If a `<script>` binding is used as a type there and as a value in the `<template>` (e.g. a Zod
  schema for `UForm :schema`), also reference it as a value in `<script>`
  (`const createSchema = zPostAdminUsersBody`). Otherwise Biome's `useImportType` safe fix turns it
  into `import type` and breaks the page at runtime.
- In `.vue` files, Biome *warnings* about unused variables/imports are expected (template usage).
  Biome *errors* are not.
- Biome ≥ 2.6's safe fix rewrites `// @ts-ignore` to `// @ts-expect-error`. Keep the template's
  `@ts-ignore` where `nuxt typecheck` and the server `tsc` pass disagree (e.g. `c.get(...)` in
  `authHandler.ts`, `Bun?.isStandaloneExecutable`), otherwise one of the two reports an unused
  directive. Re-run `bun run typecheck` after `biome check --write`.
- Per-user stores live in `app/composables/stores/` (`useUserInfoStore`, `useMyEventsStore`) plus
  the event details cache (`clearEventDetails()` in `useCurrentEvent.ts`). Clear them on logout;
  the login page refreshes them for the new session.
- The host's org: `useInstance()` (`kind`: `org` / `system` / `unknown`, the org's branding) and
  `useBrandName()`. System-dashboard pages live under `/admin/orgs`; the layout and
  `auth.global.ts` switch on `kind`.
- Event pages start with `const { event, can } = await useCurrentEvent();` and hide controls with
  `can("participants:manage")` etc. — the API enforces the same permissions.
- Use the theme colour tokens (`primary`, `text-primary-400`, …), never hard-coded `sky-*`.
- `UDashboardToolbar` is only for sub-route navigation
  (`<UNavigationMenu :items="subrouterPathDynamics.links.value" highlight class="-mx-1 flex-1" />`,
  see `app/pages/admin/users/[user_id].vue`). Filters go in `DashboardDataTable`
  `filters`/`#header-left` or `DashboardFilterBar #left`; create buttons in DataTable
  `#header-right`, `DashboardFilterBar #right` or a section card's `#actions` — not in the page
  header (AGENTS.md, "Where page controls go").
- Tab-like filters: `const { value: scope, items: scopeItems } = useQueryFilter("scope", [...])`
  + `<USelect v-model="scope" :items="scopeItems" class="w-full sm:w-44" />` (URL-backed).
- Password and username fields: `newPasswordField()`, `usernameField()`, `PASSWORD_HINT`
  (`app/utils/passwords.ts`) — the German rule-by-rule messages.

## Iventworks-specific notes

Project-wide rules and deviations from the style guide (prefixes, port, roles, SSR/PWA) live in
the "Iventworks-specific rules and exceptions" section of `AGENTS.md`.
