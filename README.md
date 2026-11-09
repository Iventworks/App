# Iventworks

Planning and running camps ("Freizeiten") and events for organisations: personal dashboard,
tasks, messaging, calendar and notes for every volunteer; participants, schedule, rooms,
responsibilities, documents and finances per event; finances, statistics, staff planning and
resources across all events for the core team ("Kernteam"); users, invitations and the audit log
for admins. One installation serves one organisation, or — in multi-org mode — many, each with its
own users, data, branding and domains (see [Organisations](#organisations-single--and-multi-org-mode)).

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

The `server/plugins/startup.ts` Nitro plugin initializes the DB, the orgs (`OrgBootstrap`), file
storage and the Hono `API` on boot. Endpoints are at `/api/v1/**`, `/api/health`, `/api/docs/v1`.
On first start an `admin` user is created — in single-org mode for the org, in multi-org mode the
first system admin; its one-time password-reset link is logged and written to
`config/initial_admin_password_reset_token.txt`.

Accounts are **invite-only**: admins invite people under *Administration → Einladungen*; the link
(`/auth/accept-invite?token=…`, emailed when SMTP is configured, otherwise copy it from the UI)
lets the invitee choose a username and password.

## Organisations (single- and multi-org mode)

Every row of org data carries `org_id`; users, roles, events and everything else belong to one
org. `IVENTWORKS_MULTI_ORG` decides how many orgs a host can reach:

- **Single-org (default, `false`)**: one org (`default`) answers on every host name, as before.
  Its admins change its name, colour, logo and icon under *Administration → Organisation*.
- **Multi-org (`true`)**, modelled on Zitadel's virtual instances:
  - The org is resolved per request from `X-Iventworks-Host` > `X-Forwarded-Host` > `Host` through
    an in-memory lookup (`server/lib/orgs/registry.ts`, no query per request).
  - Each org lives at `<slug>.<APP_URL host>` (e.g. `crossover.app.iventworks.de`). The slug never
    changes; name, primary colour (a Tailwind palette, default fuchsia), logo and icon do.
  - Org admins (or system admins) add **custom domains** under *Organisation → Domains*. A domain
    is **verified** once two DNS records exist: `TXT _iventworks-challenge.<domain>` =
    `iventworks-verification=<token>` (ownership) and a `CNAME` to `<slug>.<APP_URL host>`
    (apex domains: ALIAS/flattening to the same addresses). Pending domains are re-checked every
    15 minutes.
  - A domain serves the org once it is verified **and approved**. By default
    (`IVENTWORKS_CUSTOM_DOMAINS_SELF_SERVICE=false`) a system admin adds the domain to the reverse
    proxy and then approves it (*Systemverwaltung → Domains* lists what waits); domains a system
    admin adds are approved right away. With self-service on (for proxies that serve new domains
    by themselves), org admins' domains are approved automatically.
  - The first active domain becomes the **primary domain**: page loads on every other host of the
    org redirect there; the API answers on all of them.
  - The base domain (`APP_URL` itself) shows "no organisation here" with a link to the **system
    admin dashboard** at `<APP_URL>/admin`: create, rename, recolour and delete orgs, invite their
    admins, manage their domains. System admins are the users of the internal `system` org; the
    system API is `/api/v1/system/**` (base domain only; API keys work too).
  - Every org is its own installable app: `/api/v1/instance/manifest.webmanifest` and the icons
    are served per host.
  - Reverse proxy: forward every host (wildcard `*.app.iventworks.de` + custom domains) to the app
    and pass the original host (`X-Forwarded-Host`, or `X-Iventworks-Host`). For on-demand TLS
    (Caddy `ask`), `GET /api/v1/instance/tls-check?domain=…` answers 200 for hosts the app serves.
  - Locally, orgs are reachable at `<slug>.localhost:31316` (browsers resolve `*.localhost`).

**Tenant isolation** is enforced in three layers. Every query filters with `inOrg(table)` and every
insert sets `org_id: OrgContext.id()` (`server/lib/orgs/context.ts`). The **tenant guard**
(`server/lib/orgs/guard.ts`) rejects any SQL statement on an org table without an org filter bound
to the current org, so a missed filter fails with a 500 instead of leaking. Tokens are only looked
up within the host's org. `tests/cross-org-security.test.ts` runs every API operation of the
OpenAPI spec from one org against another (reads, writes, foreign ids in bodies), and after the
whole test run no row may reference a row of another org.

## Roles and permissions

Organisation roles (`users.role`, per org), highest first:

| Role | Can |
| --- | --- |
| `admin` | Users, invitations, full audit log, the org's branding and domains — plus everything below |
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
- **System** (multi-org base domain only): organisations, system admins, their invitations and
  audit log under `/admin/**`.

`plugins/instance.ts` loads the host's org (`GET /api/v1/instance`) before the first navigation and
applies its colour and name. Route gates live in `app/middleware/auth.global.ts` (host kind,
session validation, `/pending` for unverified accounts, `/admin` and `/core-team` gates). Event pages load the event and the caller's
permissions through `useCurrentEvent()`.

Chats are polled (no WebSocket yet): an open chat syncs new messages, edits and deletions every
4 seconds; unread badges refresh every minute.

## Files

Uploads (documents, receipts) are stored on disk under `IVENTWORKS_UPLOAD_DIR` (default
`./data/uploads`), metadata in the `files` table. A file's contents are at
`/api/v1/files/<id>/content/<name>`, checked on every request; the browser's session cookie counts
there, so images and links open directly. Back up `data/` (database **and** uploads) together.

**Share links** let people without an account open a file or folder: *Teilen* in a document's
menu creates `<org address>/s/<token>` with what it allows (view, upload, edit, delete — or an
upload-only drop box), an optional password and an expiry. Only the shared item and what lies
below it are reachable through a link. Org admins see every link under *Administration →
Freigabelinks*, can switch sharing off for the org and set a default expiry.

## Configuration

All settings are `IVENTWORKS_*` env vars — see `example.env`. The names before the rename,
`CMP_*`, are still read as a fallback (with a warning). Notable settings:

- `IVENTWORKS_APP_URL` — the public origin (single-org), or the base URL whose host carries the
  orgs' subdomains (multi-org). Links in emails use the org's own address.
- `IVENTWORKS_MULTI_ORG` — many orgs on one installation (see above)
- `IVENTWORKS_CUSTOM_DOMAINS_SELF_SERVICE` (default `false`) — org admins' custom domains go live
  without a system admin's approval (see above)
- `IVENTWORKS_UPLOAD_DIR`, `IVENTWORKS_MAX_UPLOAD_SIZE_MB` — file storage and the upload limit
- `IVENTWORKS_BACKUP_*` — encrypted backups, optionally to S3 (see Backups)
- `IVENTWORKS_TIMEZONE` (default `Europe/Berlin`) — what "today" means on dashboards
- `IVENTWORKS_TRUST_PROXY` — behind exactly one reverse proxy, take the client IP for login rate
  limiting from the last `X-Forwarded-For` entry

## Backups

Encrypted backups of the database and the uploaded files, modelled on LeiCraft_MC Vault's backup
tool (`server/lib/backup/`):

- A consistent SQLite snapshot (`VACUUM INTO`, safe while the app runs) and `uploads/` go into a
  tar.gz, streamed through AES-256-GCM with a key derived from `IVENTWORKS_BACKUP_PASSPHRASE`
  (scrypt, fresh salt and IV per backup) into `iventworks-YYYYMMDD-HHMMSS.backup` (UTC).
- `IVENTWORKS_BACKUP_ENABLED=true` runs them on `IVENTWORKS_BACKUP_SCHEDULE` (cron, in
  `IVENTWORKS_TIMEZONE`, default daily 03:00). The app refuses to start with an incomplete
  configuration (no or a short passphrase, half an S3 setup, an invalid schedule).
- Stored in `IVENTWORKS_BACKUP_DIR`, and — with the S3 settings — off-site in a bucket (Bun's S3
  client, multipart upload). Backups older than `IVENTWORKS_BACKUP_RETENTION_DAYS` are deleted, the
  newest `IVENTWORKS_BACKUP_RETENTION_MIN_COUNT` always stay. With S3, retention applies there and
  the local directory keeps only the newest `IVENTWORKS_BACKUP_LOCAL_COPIES`.
- By hand: `bun run backup create | list | verify <name> | restore <name> <dir>` (in the image:
  `docker exec iventworks bun /opt/iventworks/app/.output/backup.mjs …`). `restore` takes a local
  file, a name in the backup directory or a name in S3, checks the GCM tag before writing anything,
  and extracts `db.sqlite`, `uploads/` and `manifest.json` into an empty directory. Then stop the
  app, replace the database (and delete its `-wal`/`-shm` files) and the uploads, and start it.
- **Keep the passphrase outside the server.** Without it no backup can be restored.

## Security headers and request limits

- Every response: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and HSTS when `IVENTWORKS_APP_URL` is https
  (`server/middleware/00.security-headers.ts`).
- Pages get a Content-Security-Policy with the hashes of their own inline scripts (no
  `unsafe-inline`/`unsafe-eval` for scripts; `server/plugins/csp.ts`); API responses one that
  allows nothing. Icons come from the local `/api/_nuxt_icon`, never from api.iconify.design.
- Request bodies are checked before they are read (`server/runtime/bun.ts`, the Bun server entry):
  file uploads up to `IVENTWORKS_MAX_UPLOAD_SIZE_MB`, everything else up to 2 MB; larger ones get
  413. Uploads are held in memory while they are processed, so keep the limit in proportion to the
  server's RAM.

## Migrating from the standalone CMP-API

The pre-merge CMP-API had its own migrations; the old file cannot be migrated in place. Import the
accounts into a fresh database **before** the first start:
`bun run db:import-legacy <old-db.sqlite> [new-db.sqlite] [org slug]` (into the org `default`
unless given; users with id, username, display name, email, password hash and role; everybody
signs in again).

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
- `bun run db:import-legacy` — import users from a pre-merge CMP-API database (see above)
- `bun run backup …` — create, list, verify and restore backups (see Backups)
- `bun run check` / `check:ci` / `lint` / `format` — Biome
- `bun run typecheck` — `nuxt typecheck` + `tsc` (includes `server/`)
- `bun test` / `bun run test:ci` — API tests (CI: coverage + JUnit report)

## Deployment

CI (`.gitlab/ci/build.yml`) builds the image from the default branch and pushes
`$CI_REGISTRY_IMAGE:latest`; `docker/docker-compose.yml` runs it.

1. On the host, create the volumes for the image's non-root `bun` user (uid 1000):
   `sudo mkdir -p /opt/iventworks/{data,config} && sudo chown -R 1000:1000 /opt/iventworks`.
2. Put the SMTP credentials into `docker/.env` (gitignored): `IVENTWORKS_SMTP_HOST`,
   `IVENTWORKS_SMTP_USERNAME`, `IVENTWORKS_SMTP_PASSWORD`. Without `IVENTWORKS_SMTP_HOST`, email
   (reset links, invitations) is off and invitation links are shown in the UI instead.
3. Set `IVENTWORKS_APP_URL` (and `IVENTWORKS_MULTI_ORG`) in the compose file, then
   `docker compose -f docker/docker-compose.yml up -d`.
4. The app listens on `127.0.0.1:31316`; point the reverse proxy (TLS) at it, in multi-org mode
   for the wildcard and the custom domains too. With that setup `IVENTWORKS_TRUST_PROXY=true` is
   correct; set it to `false` if the port is ever published directly.
5. First start only: open the reset link from
   `/opt/iventworks/config/initial_admin_password_reset_token.txt` (also in the logs), set the
   `admin` password, then change the admin's email in the profile. Single-org: invite everyone
   else. Multi-org: that is the first system admin; create the orgs at `<APP_URL>/admin`.

`/opt/iventworks/data` holds the database **and** the uploads; the built-in backups (see Backups)
cover both and go to `/opt/iventworks/backups` and optionally S3. Don't copy the live database
file: it may be mid-write (WAL). The API
docs (`/api/docs/v1`) are disabled in the compose file; set `IVENTWORKS_API_DISABLE_DOCS=false` to enable
them. Migrations run automatically on start.

## Structure

See the LeiCraftMC style guide:

- [docs/01-project-structure.md](https://github.com/LeiCraftMC/Style-Guides/blob/main/docs/01-project-structure.md) — the full-stack Nuxt shape
- [docs/04-backend-hono.md](https://github.com/LeiCraftMC/Style-Guides/blob/main/docs/04-backend-hono.md) — Mounting Hono in Nitro
- [docs/06-frontend-nuxt.md](https://github.com/LeiCraftMC/Style-Guides/blob/main/docs/06-frontend-nuxt.md)

## License

AGPL-3.0
