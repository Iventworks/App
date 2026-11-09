# AGENTS.md — operating manual for AI coding agents

You are working in a LeiCraftMC full-stack Nuxt app (Nuxt frontend + Hono backend in `server/`).
Follow the LeiCraftMC Style Guides: https://github.com/LeiCraftMC/Style-Guides.

## Must read

- [docs/00-overview.md](https://github.com/LeiCraftMC/Style-Guides/blob/main/docs/00-overview.md)
- [docs/01-project-structure.md](https://github.com/LeiCraftMC/Style-Guides/blob/main/docs/01-project-structure.md) — the full-stack Nuxt shape
- [docs/04-backend-hono.md](https://github.com/LeiCraftMC/Style-Guides/blob/main/docs/04-backend-hono.md) — Mounting Hono in Nitro
- [docs/05-api-contract.md](https://github.com/LeiCraftMC/Style-Guides/blob/main/docs/05-api-contract.md)
- [docs/06-frontend-nuxt.md](https://github.com/LeiCraftMC/Style-Guides/blob/main/docs/06-frontend-nuxt.md)
- [docs/07-state-and-data.md](https://github.com/LeiCraftMC/Style-Guides/blob/main/docs/07-state-and-data.md)

## Non-negotiable

- Nuxt 4 `app/` srcDir; Tailwind v4 CSS-first; no `tailwind.config.js`. Dark-only (no toggle).
- The Hono backend lives in `server/` and owns `/api` — no `Bun.serve`, no `Main.main()`; init in
  `server/plugins/startup.ts`.
- Every API response uses the `{ success, code, message, data }` envelope via `APIResponse.*`
  (errors omit `data`).
- Validate with `hono-openapi`'s validator (`import { validator as zValidator } from "hono-openapi"`); routes in `server/lib/api/versions/v<n>/routes/<resource>/{index.ts, model.ts}`.
- Auth uses opaque bearer tokens (`<prefix>_<kind>_<id>:<base>`, `Bun.password`-hashed) — not JWT.
  See docs/10-auth.md.
- Frontend API access only through `useAPI`; global state via `AbstractStore` over `useState`;
  component-local form/UI state with `reactive()`/`ref()` is fine.
- Lucide icons only (`i-lucide-*`). Never hand-edit `*.gen.ts` under `app/api-client/` —
  regenerate with `bun run api-client:generate`.
- `nitro.rollupConfig.external: ["bun:sqlite"]` in `nuxt.config.ts`. WebSocket routes
  (`server/routes/ws/`) require `nitro.experimental.websocket = true` (Bun preset).
- Format with Biome before finishing. Conventional Commits.

## CMP-specific rules and exceptions

Record every divergence from the style guide here (docs/17: "discuss, record").

- Env prefix `CMP_`, token/cookie prefix `cmp` (`cmp_session_token`), see
  `server/lib/utils/constants.ts`. Legacy `CMP_API_*` names (pre-merge CMP-API) are read as a
  fallback by `ConfigHandler`; `bun run db:import-legacy` imports old user accounts.
- Port **31316** in dev and prod. This deviates from the guide's 12xxx rule (docs/02 › Ports): it is
  the port the pre-merge CMP web app already used.
- **Roles / RBAC** (docs/10 › full RBAC): org roles `admin > core_team > volunteer > unverified`,
  event roles `leader > staff` (`event_members`). `server/lib/api/utils/permissions.ts`
  (`PermissionHelper`) holds both permission matrices; checks live in handlers
  (`PermissionHelper.can`, `EventAccess.can(c, "…")`) and turn into `APIResponse.forbidden`.
  Routers only use the coarse `requireOrgRole(...)` guard. `core_team`/`admin` act as `leader` in
  every event — except for member-only permissions (`PermissionHelper.MEMBER_ONLY_EVENT_PERMISSIONS`):
  participants' health data and the staff's notes about them (`participants:view_medical`) are
  only visible to people on the event's team (GDPR Art. 9, data minimisation); for everyone else
  the API blanks those fields and ignores them on update. `unverified` accounts may only use
  `/account`.
- **Event sub-resources** live under `routes/events/<resource>/` with
  `basePath("/:eventId/<resource>")`; `EventAccess.loader` (mounted once in `routes/events/index.ts`)
  loads `c.get("event")` / `c.get("eventAccess")`. Follow `routes/events/tasks/` as the reference.
  Request bodies are explicit `z.object`s — drizzle-zod insert schemas drop optionality when a
  column gets a refinement. Write German summaries to `AuditLog.record` (never medical details) and
  use `Notifier.notify` for assignments.
- **No signup** — accounts come from admins, two ways:
  - *Invitation* (`/admin/invitations`): email link, the invitee picks username and password at
    `/auth/accept-invite?token=…` (`/auth/invitations/*`).
  - *Direct* (`POST /admin/users`, "Benutzer anlegen"): with a password, or without one — then the
    response carries a one-time link (`PasswordLinks`, 7 days, `/auth/reset-password?token=…`)
    that the admin hands over. Admins can also issue such a link later (`…/password-link`).
- **User management** (modelled on LeiOS Hub): `/admin/users` list → `/admin/users/[user_id]`
  with sub-routes *Übersicht* / *Aktivität* (`useSubrouterPathDynamics` +
  `useSubrouterInjectedData("admin_user")`). Admins can suspend accounts (`suspended_at`,
  `suspended_reason`): login is refused with 403, sessions, API keys and password links are
  revoked, the person disappears from `/users` pickers; data stays. "Überall abmelden" ends
  sessions only. Never on your own account. `last_login_at` is set on login.
- **Audit log** (the guide has no spec yet): `AuditLog.record` writes German `summary` +
  `action` (closed enum `AuditLogModel.Actions`) + `entity_type`/`entity_id` + optional
  `metadata`, with millisecond `created_at`. `AuditLog.list` serves both `GET /admin/audit-log`
  and `GET /events/{id}/audit-log` (filters: person, action, object type/id, text, time range;
  `actors` lists everyone in the log for the person filter). The UI is one component,
  `AuditLogTable` (filters synced to the URL with `sync-url`, coloured action badges, links to
  the object via `auditObjectLink`, expandable metadata, absolute + relative time); labels live in
  `app/utils/audit.ts`. Add new object types there when you record a new `entityType`.
- `PUT /api/v1/account` requires `current_password` (docs/10), like the template.
- **Login rate limiting** is per client IP (+ username); there is no per-username lockout across
  clients (it let anyone lock the admin out). The Nitro bridge passes the client IP as Hono env
  binding `clientIP` (`server/lib/api/utils/clientInfo.ts`); `CMP_TRUST_PROXY` uses the last
  `X-Forwarded-For` entry.
- **Foreign keys are enforced** (`PRAGMA foreign_keys = ON` in `DB.init`) — not in the guide. The
  schema's `onDelete` actions are relied on (e.g. deleting an event cascades to its rows).
  The `created_at` SQL default has second precision — set `created_at: Date.now()` explicitly
  where millisecond ordering matters (chat messages vs. read markers do this).
- **File uploads** (not covered by the guide): blobs on disk under `CMP_UPLOAD_DIR` via
  `FileStorage`, metadata in `files`, all access through `FileService` / `FileAccess`. Upload
  routes use `zValidator("form", …, undefined, { media: "multipart/form-data" })`. Downloads use
  signed short-lived tokens (`GET /files/download/{token}`) instead of the bearer header. Uploaded
  MIME types are client-controlled: only `FileService.INLINE_MIME_TYPES` (raster images, PDF, plain
  text) are served inline (with a sandbox CSP); everything else, notably SVG and HTML, goes out as an
  `application/octet-stream` attachment so it can never run script on the app origin.
- **Time**: dates are `YYYY-MM-DD` strings, instants unix ms; "today" is computed in
  `CMP_TIMEZONE` (`server/lib/utils/time.ts`).
- **Messaging** is REST + polling, no WebSocket: an open chat polls
  `GET /conversations/{id}/messages/sync?after=<last id>&since=<server_time>` every few seconds and
  receives new messages plus other people's edits and deletions (messages are soft-deleted as
  tombstones with their text wiped, so deletions can be synced).
- All pages render client-side (`routeRules: { "/**": { ssr: false } }`) — the guide's
  "everything behind login" variant. Internal-only app: there is no public `default` layout; pages
  use `definePageMeta({ layout: "dashboard" })` (or `auth`).
- **PWA** (`@vite-pwa/nuxt`) is kept (the guide ships none): it is the only mobile channel — no
  native/TWA builds are shipped. `/settings/apps` offers the install (`usePwaInstall`, which
  replays the `beforeinstallprompt` event caught by `plugins/pwaInstall.client.ts`) and the
  Safari steps for iOS.
  The service worker must never answer `/api/**` (`pwa.workbox.navigateFallbackDenylist`).
- UI language is German, informal ("du").
- **Shared components extended** (copies of `shared/frontend`, deliberately changed):
  `DashboardStatCard` takes `to` (the whole card links) and `iconColor: "info"`;
  `DashboardDeleteModal` is German, its confirm word is `LÖSCHEN`, and `requireConfirmText` can
  turn the typing step off for small deletions; `DataTable`/`DateRangePicker` are translated, and
  `DataTable` keeps its actions right-aligned when they wrap below the filters and passes a
  select filter's `icon` as a prop (an empty `#leading` slot reserved icon space).
  Date fields use `FormDatePicker` / `FormDateTimePicker` / `FormDayRangePicker` (Nuxt UI
  calendar), never native `type="date"` inputs.
- **Where page controls go** (as in the LeiOS Hub package list):
  - `UDashboardToolbar` holds only sub-navigation between real sub-routes: a highlighted
    `UNavigationMenu` from `useSubrouterPathDynamics` (parent page + `<NuxtPage />`, data shared
    with `useSubrouterInjectedData`), e.g. `/admin/users/[id]` + `/activity`, event finances,
    program (Wochenplan / Liste), responsibilities (Nach Bereich / Nach Person), and the API keys
    exactly as the style guide template (`/settings/api-keys` list, `/new` and `/<id>` through
    `api-keys/[api_key_id].vue` with `useSubrouterInjectedData(…, true)`). No filters,
    switches, date ranges or buttons in it, and no `UTabs` (inside modals they are fine).
  - Filters live with the content: `DashboardDataTable` `filters` / `#header-left`, or
    `DashboardFilterBar` `#left` (CMP component with the same card and layout as the DataTable
    header) above content that is not a table. A filter that used to be a tab ("Offen / Meine /
    Alle", role, status, scope) is a `USelect` bound to `useQueryFilter(key, options)`, which keeps
    the value in the query string. Page-wide periods (year, date range) go in a
    `DashboardFilterBar` at the top of the body.
  - Create buttons ("Neue Aufgabe", "Anmelden") sit with the list they add to: DataTable
    `#header-right`, `DashboardFilterBar` `#right`, or the `DashboardSectionCard` `#actions` of
    that section. The page header's `#right` keeps only page-level actions (refresh, print,
    settings, edit/delete on a detail page) — never create buttons or filters. Repeating it as
    the empty state's call to action is optional (the style guide's API-key list does).
  - Sidebar links stay highlighted on their sub-pages (`withSubpageActive` in
    `layouts/dashboard.vue`): list and detail pages are sibling routes (`api-keys/index.vue` +
    `api-keys/[api_key_id].vue`), which the router's own active check doesn't connect.
