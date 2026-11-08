# CMP — Crossover Management Portal

Planning and running camps ("Freizeiten") and events for one organisation: personal dashboard,
tasks, messaging, calendar and notes for every volunteer; participants, schedule, rooms,
responsibilities, documents and finances per event; finances, statistics, staff planning and
resources across all events for the core team ("Kernteam"); users, invitations and the audit log
for admins.

Full-stack Nuxt app: Nuxt 4 frontend **and** the Hono API in `server/`, mounted at `/api`. Built
on the LeiCraftMC style guide's `fullstack-nuxt-app` template.

## Stack

- Nuxt 4 (`app/` srcDir) + NuxtUI v4 + Tailwind v4 (CSS-first), PWA via `@vite-pwa/nuxt`
- Hono + Zod + `hono-openapi` (Scalar) in `server/`, mounted at `/api` via a catch-all Nitro route
- Drizzle ORM + `bun-sqlite` (foreign keys enforced)
- Bun runtime (Nitro `bun` preset)
- Biome formatter/linter
- AGPL-3.0

## Setup

```bash
bun install
cp example.env .env
bun run dev   # http://localhost:31316
```

The `server/plugins/startup.ts` Nitro plugin initializes the DB, file storage and the Hono `API`
on boot. Endpoints are at `/api/v1/**`, `/api/health`, `/api/docs/v1`. On first start (empty DB) an
`admin` user is created; its one-time password-reset link is logged and written to
`config/initial_admin_password_reset_token.txt`.

Accounts are **invite-only**: admins invite people under *Administration → Einladungen*; the link
(`/auth/accept-invite?token=…`, emailed when SMTP is configured, otherwise copy it from the UI)
lets the invitee choose a username and password.

## Roles and permissions

Organisation roles (`users.role`), highest first:

| Role | Can |
| --- | --- |
| `admin` | Users, invitations, full audit log — plus everything below |
| `core_team` ("Kernteam") | Create/delete events, assign leaders, org documents & news, resources, finances/statistics/staff planning across all events, core-team notes & chat. Acts as **leader in every event** — but sees participants' health data and the team's notes about them only in events they are on the team of. |
| `volunteer` | The portal: own dashboard, tasks, chats, calendar, notes; the events they are staff of |
| `unverified` | Only their own account settings (`/pending` page) |

Event roles (`event_members.role`): `leader` ("Leitung") and `staff` ("Mitarbeiter:in"). Leaders
manage the event (participants, program, rooms, staff, groups, budget, expense review, stats,
audit log); staff see everything operational (incl. participants' medical info), add participant
notes, create tasks/notes, upload documents and submit expenses.

The server is the authority: `server/lib/api/utils/permissions.ts` (`PermissionHelper`) holds both
permission matrices; `GET /events/{eventId}` returns the caller's `permissions` so the UI can hide
controls.

## Frontend

One layout (`app/layouts/dashboard.vue`) with route-switched sidebars:

- **Main** (`/`, `/tasks`, `/messages`, `/calendar`, `/notes`, `/events/**`, `/news`,
  `/documents`): personal space, the event switcher with the selected event's pages, organisation.
- **Settings** (`/settings/**`), **Administration** (`/admin/**`, admins) and **Kernteam**
  (`/core-team/**`, core team): each with a "Zurück zum Portal" link.

Route gates live in `app/middleware/auth.global.ts` (session validation, `/pending` for unverified
accounts, `/admin` and `/core-team` gates). Event pages load the event and the caller's
permissions through `useCurrentEvent()`.

Chats are polled (no WebSocket yet): an open chat syncs new messages, edits and deletions every
4 seconds; unread badges refresh every minute.

## Files

Uploads (documents, receipts) are stored on disk under `CMP_UPLOAD_DIR` (default
`./data/uploads`), metadata in the `files` table. Downloads use short-lived signed links
(`/api/v1/files/download/<token>`, 1 h) so the browser can open them directly. Back up
`data/` (database **and** uploads) together.

## Configuration

All settings are `CMP_*` env vars — see `example.env`. One URL drives both halves:
`CMP_APP_URL` is the public origin (CORS, links in emails, and the browser's API base
`<CMP_APP_URL>/api/v1`). Notable settings:

- `CMP_UPLOAD_DIR`, `CMP_MAX_UPLOAD_SIZE_MB` — file storage
- `CMP_TIMEZONE` (default `Europe/Berlin`) — what "today" means on dashboards
- `CMP_TRUST_PROXY` — behind exactly one reverse proxy, take the client IP for login rate limiting
  from the last `X-Forwarded-For` entry

## Migrating from the standalone CMP-API

The pre-merge CMP-API used `CMP_API_*` env names and its own migrations.

- Env: `CMP_API_<NAME>` is still read as a fallback for `CMP_<NAME>` (with a warning) — rename
  them when convenient.
- Database: the old file cannot be migrated in place. Import the accounts into a fresh database
  **before** the first start: `bun run db:import-legacy <old-db.sqlite> [new-db.sqlite]` (users
  with id, username, display name, email, password hash and role; everybody signs in again).

## API client

The typed client in `app/api-client/` is generated from the API's OpenAPI spec (the script boots
the API in-process, no dev server needed). Never edit it by hand:

```bash
bun run api-client:generate
```

## Scripts

- `bun run dev` — dev server on port 31316 (frontend + API)
- `bun run build` — production build (single `.output/`, Bun preset)
- `bun run start` — run the built server
- `docker/` — production image: `.output/` + `drizzle/migrations` on `oven/bun`
- `bun run db:generate` / `db:migrate` — Drizzle migrations (`drizzle/migrations/`, committed)
- `bun run db:import-legacy` — import users from a CMP-API database (see above)
- `bun run check` / `check:ci` / `lint` / `format` — Biome
- `bun run typecheck` — `nuxt typecheck` + `tsc` (includes `server/`)
- `bun test` / `bun run test:ci` — API tests (CI: coverage + JUnit report)

## Deployment

CI (`.gitlab/ci/build.yml`) builds the image from the default branch and pushes
`$CI_REGISTRY_IMAGE:latest`; `docker/docker-compose.yml` runs it.

1. On the host, create the volumes for the image's non-root `bun` user (uid 1000):
   `sudo mkdir -p /opt/crossover/cmp/{data,config} && sudo chown -R 1000:1000 /opt/crossover/cmp`.
2. Put the SMTP credentials into `docker/.env` (gitignored): `CMP_SMTP_HOST`, `CMP_SMTP_USERNAME`,
   `CMP_SMTP_PASSWORD`. Without `CMP_SMTP_HOST`, email (reset links, invitations) is off and
   invitation links are shown in the admin UI instead.
3. Set `CMP_APP_URL` in the compose file to the public origin, then `docker compose -f
   docker/docker-compose.yml up -d`.
4. The app listens on `127.0.0.1:31316`; point the reverse proxy (TLS) at it. With that setup
   `CMP_TRUST_PROXY=true` is correct; set it to `false` if the port is ever published directly.
5. First start only: open the reset link from
   `/opt/crossover/cmp/config/initial_admin_password_reset_token.txt` (also in the logs), set the
   `admin` password, then change the admin's email in the profile and invite everyone else.

`/opt/crossover/cmp/data` holds the database **and** the uploads — back it up as a whole. The API
docs (`/api/docs/v1`) are disabled in the compose file; set `CMP_API_DISABLE_DOCS=false` to enable
them. Migrations run automatically on start.

## Structure

See the LeiCraftMC style guide:

- [docs/01-project-structure.md](https://github.com/LeiCraftMC/Style-Guides/blob/main/docs/01-project-structure.md) — the full-stack Nuxt shape
- [docs/04-backend-hono.md](https://github.com/LeiCraftMC/Style-Guides/blob/main/docs/04-backend-hono.md) — Mounting Hono in Nitro
- [docs/06-frontend-nuxt.md](https://github.com/LeiCraftMC/Style-Guides/blob/main/docs/06-frontend-nuxt.md)

## License

AGPL-3.0
