# Style-Guides template issues found while building CMP

Issues in the LeiCraftMC Style-Guides repository (templates, `shared/` and docs) that surfaced while
building CMP. Each one is already solved in CMP. Nothing has been changed in Style-Guides. Use this
list to decide what to fix there.

Checked against Style-Guides commit `2ad5e30`. Paths are relative to the Style-Guides repo.

| # | Issue | Affects | Effort | Recommendation |
| --- | --- | --- | --- | --- |
| 1 | Uploaded files get corrupted | fullstack-nuxt-app | one line | fix |
| 2 | Anyone can lock others out of logging in | fullstack-nuxt-app, backend-service, doc 10 | medium | fix |
| 3 | Foreign keys are not enforced | backend-service, fullstack-nuxt-app | one line | fix |
| 4 | A mistyped current password logs the user out | backend-service, fullstack-nuxt-app | small | fix |
| 5 | An admin can delete or demote themselves | backend-service, fullstack-nuxt-app | small | fix |
| 6 | Admin user edits skip the normal rules | backend-service, fullstack-nuxt-app | small | fix |
| 7 | No sidebar button on phones | shared/frontend, nuxt-app, fullstack-nuxt-app | one line | fix |
| 8 | No `.dockerignore` | all Docker templates | tiny | fix |
| 9 | Containers run as root | backend-service, nuxt-app, fullstack-nuxt-app | small | fix |
| 10 | Admin reset link can be committed to git | fullstack-nuxt-app | tiny | fix |
| 11 | CI config gaps (`GIT_DEPTH`, wrong cache variable) | templates' `.gitlab-ci.yml`, doc 13, shared CI | tiny | fix |
| 12 | Claude Code scans data and config folders | `shared/config/claude-settings.fullstack.json` | tiny | fix |
| 13 | CI tests on an unpinned Bun version | all templates' `testing.yml`, shared CI | tiny | fix |
| 14 | Compose defaults: public docs, port on all interfaces | backend-service, fullstack-nuxt-app | small | optional |
| 15 | OpenAPI server URLs wrong in full-stack | fullstack-nuxt-app | tiny | optional |
| 16 | Biome version mismatch breaks typecheck after auto-fix | all templates' `biome.json` | small | optional |
| 17 | `created_at` has only second precision | backend-service, fullstack-nuxt-app, shared/backend | docs only | document |

---

## Bugs

### 1. Uploaded files get corrupted

- **Where:** `templates/fullstack-nuxt-app/server/routes/api/[...].ts`, line 40:
  `readRawBody(event)`.
- **Problem:** without an encoding argument, h3 decodes the request body as UTF-8 text. Binary
  bodies (PDFs, images, any `multipart/form-data` upload) are mangled before Hono sees them.
- **Impact:** every file upload in a full-stack project is broken. It only shows up once a project
  adds uploads.
- **Fix:** `readRawBody(event, false)` returns the raw bytes. CMP casts the result to `BodyInit`
  for the type checker.
- **In CMP:** `server/routes/api/[...].ts`. A test checks that the downloaded bytes equal the
  uploaded ones.

### 2. Anyone can lock others out of logging in

- **Where:** `templates/fullstack-nuxt-app/server/lib/api/versions/v1/routes/auth/index.ts`
  (`getClientId`, `LOGIN_MAX_GLOBAL_ATTEMPTS = 15`), the same limiter in backend-service, and
  `docs/10-auth.md` line 179.
- **Problem:**
  - In the full-stack shape, the Nitro bridge builds a new `Request` and calls `app.fetch(request)`.
    Hono therefore never sees the socket, `remoteAddr` is always undefined, and every visitor
    lands in one `"unknown"` bucket.
  - The per-username limit (15 failures across all clients) applies in every template. Anyone
    who knows a username, such as `admin`, can keep that account locked out.
  - Doc 10 recommends `getConnInfo(c)` from `hono/bun`. That cannot work in the full-stack shape,
    because there is no Bun server environment behind `app.fetch`.
- **Impact:** in a full-stack project, five wrong logins by anyone block login for everybody using
  that username for 5 minutes. In every template, the admin account can be kept locked out
  indefinitely.
- **Fix:**
  - The bridge reads the client IP (`getRequestIP`) and passes it to Hono as an env binding
    (`app.fetch(request, { clientIP })`).
  - Behind a trusted reverse proxy, use the last `X-Forwarded-For` entry; the earlier entries are
    client-controlled.
  - Limit per IP plus username and per IP (failures only). Replace the hard per-username lock with
    a short slowdown.
  - Correct the `getConnInfo` advice in doc 10.
- **In CMP:**
  - `server/routes/api/[...].ts`
  - `server/lib/api/utils/clientInfo.ts`
  - `server/lib/api/versions/v1/routes/auth/index.ts`
  - config key `CMP_TRUST_PROXY`
  - a test that failures from one IP don't block another.

### 3. Foreign keys are not enforced

- **Where:** `templates/backend-service/src/db/index.ts` and
  `templates/fullstack-nuxt-app/server/lib/db/index.ts` call `drizzle(path)` and never enable
  foreign keys.
- **Problem:** SQLite ignores `FOREIGN KEY` clauses unless `PRAGMA foreign_keys = ON` is set on
  each connection, and `bun:sqlite` defaults to off. Every `onDelete: "cascade"` and `"set null"`
  in the schema does nothing.
- **Impact:** deleting a parent row leaves orphaned children behind. The templates' explicit
  cleanup in the user-delete routes hides this today; the first project table that relies on
  cascades breaks quietly.
- **Fix:** run `PRAGMA foreign_keys = ON;` right after `drizzle(path)`. CMP also enables
  `journal_mode = WAL`. Add a line to doc 08. Existing projects should check for orphaned rows
  before upgrading, or the pragma will reject later writes that touch them.
- **In CMP:** `server/lib/db/index.ts`. A test checks that deleting an event cascades.

### 4. A mistyped current password logs the user out

- **Where:** `account/index.ts` in backend-service and fullstack-nuxt-app. `PUT /account/password`
  answers a wrong password with `APIResponse.unauthorized` (401), although its own spec documents
  400.
- **Problem:** the frontend `useAPI` treats every 401 as "session expired": it clears the cookie
  and redirects to the login page.
- **Impact:** a typo in the current-password field signs the user out. The OpenAPI spec and the
  runtime also disagree.
- **Fix:** return `APIResponse.badRequest(c, "Current password is incorrect")`. Use the same status
  everywhere a current password is checked.
- **In CMP:** `server/lib/api/versions/v1/routes/account/index.ts` (profile update and password
  change), plus tests.

### 5. An admin can delete or demote themselves

- **Where:** `admin/users/index.ts` (`PUT /:userId` and `DELETE /:userId`) in backend-service and
  fullstack-nuxt-app.
- **Problem:** there is no check that an admin is changing their own account.
- **Impact:** the only admin can remove their own admin role or account. The seed admin is only
  created on an empty `users` table, so recovery means editing the database by hand.
- **Fix:** return 400 when admins delete themselves or remove their own `admin` role.
- **In CMP:** `server/lib/api/versions/v1/routes/admin/users/index.ts`. The admin UI also
  disables those actions for the current user.

### 6. Admin user edits skip the normal rules

- **Where:** `admin/users/model.ts` and `admin/users/index.ts` in backend-service and
  fullstack-nuxt-app.
- **Problem:**
  - `AdminUsersModel.Update.Body` is `createUpdateSchema(DB.Tables.users)` without
    `UserDataPolicies.Username` or `z.email()`, so admins can store invalid usernames and emails.
  - The role update and `changeUserRoleInAuthContexts` are separate writes, not one transaction.
    If the second write fails, the user's sessions keep the old role.
  - Admin-created passwords use `z.string().min(8).max(128)`, while `UserDataPolicies.Password`
    (8–50 characters, mixed classes) applies everywhere else.
- **Fix:** reuse the shared policies in the update and create schemas, and wrap the user update
  and the role propagation in one transaction.
- **In CMP:** `server/lib/api/versions/v1/routes/admin/users/{model,index}.ts`, plus tests.

### 7. No sidebar button on phones

- **Where:** `shared/frontend/app/components/dashboard/DashboardPageHeader.vue` and its copies in
  nuxt-app and fullstack-nuxt-app, lines 20–22: `<template #leading><slot name="leading" /></template>`.
- **Problem:** the header always fills `UDashboardNavbar`'s `#leading` slot, even when the page
  passes nothing. That replaces the navbar's default content, the sidebar toggle.
- **Impact:** on narrow screens the collapsed sidebar cannot be opened. Navigation on phones is
  effectively broken.
- **Fix:** `<template v-if="$slots.leading" #leading>`.
- **In CMP:** `app/components/dashboard/DashboardPageHeader.vue`.

## Gaps against the guide's own rules

### 8. No `.dockerignore`

- **Where:** missing from every template. Doc 14 requires one (line 96 and the checklist at
  line 420).
- **Impact:** `docker build .` sends `node_modules/`, `.env` files and local `data/` and
  `config/` folders (including the admin reset link) to the build daemon.
- **Fix:** add a `.dockerignore` listing `data/`, `config/`, `docker/data/`, `docker/config/`,
  `docker/.env`, `.env*`, `node_modules/`, `.nuxt/`, `.nitro/`, `.cache/`, `.git/`,
  `tmp-data-*/`, `coverage/` and `junit.xml`.
- **In CMP:** `.dockerignore`.

### 9. Containers run as root

- **Where:** `docker/Dockerfile` in backend-service, nuxt-app and fullstack-nuxt-app; none has a
  `USER` line.
- **Impact:** the app runs as root inside the container, and bind-mounted data folders end up
  owned by root.
- **Fix:** run `RUN mkdir -p <app>/data <app>/config && chown -R bun:bun <app>` and then
  `USER bun`. Doc 14 then needs a deployment note: before upgrading, the host folders must
  belong to uid 1000 (`chown -R 1000:1000 …`), otherwise the app cannot write its database.
- **In CMP:** `docker/Dockerfile`, plus the deployment section of the README.

### 10. Admin reset link can be committed to git

- **Where:** `templates/fullstack-nuxt-app/docker/docker-compose.yml` mounts `./data` and
  `./config`. The shared `.gitignore` has `config/*`, which only matches at the repo root.
- **Problem:** relative mounts resolve next to the compose file, so the app writes
  `docker/config/initial_admin_password_reset_token.txt`, which git does not ignore. The
  backend-service template already uses absolute paths, and doc 14 says the shapes should match.
- **Fix:** use absolute host paths (`/opt/<org>/<project>/{data,config}`), and add
  `docker/data/` and `docker/config/` to `.gitignore`.
- **In CMP:** `docker/docker-compose.yml` and `.gitignore`. This was fixed in an earlier session.

### 11. CI config gaps

- **Where:**
  - The templates' `.gitlab-ci.yml` lack the `variables:` block that doc 13 shows.
  - Doc 13 (line 99) and `shared/config/gitlab-ci/gitlab-ci.yml` (line 11) set
    `BUN_INSTALL_CACHE`.
- **Problem:** the `variables:` block (`GIT_DEPTH: "20"`) is missing. `BUN_INSTALL_CACHE` is not
  a Bun variable; Bun reads `BUN_INSTALL_CACHE_DIR`, which `testing.yml` already sets. So that
  line does nothing.
- **Fix:** add `variables: GIT_DEPTH: "20"` to the templates, and drop or rename the
  `BUN_INSTALL_CACHE` line in doc 13 and the shared file.
- **In CMP:** `.gitlab-ci.yml` (only `GIT_DEPTH`).

### 12. Claude Code scans data and config folders

- **Where:** `shared/config/claude-settings.fullstack.json` and the fullstack template's
  `.claude/settings.json`, under `fileScan.exclude`.
- **Problem:** the list excludes build output but not `data/` (database, uploads), `config/`
  (admin reset link) or `coverage/`. Doc 16 says Nuxt variants exclude build folders instead of
  `data/`, but the full-stack shape has both. The backend variant should be checked the same way.
- **Fix:** add `data/**`, `config/**`, `coverage/**` and `tmp-data-*/**`.
- **In CMP:** `.claude/settings.json`.

### 13. CI tests on an unpinned Bun version

- **Where:** `.gitlab/ci/testing.yml` in every template and in `shared/config/gitlab-ci/`:
  `image: oven/bun`.
- **Problem:** tests run on the newest Bun, while the production image is `oven/bun:1-slim`. The
  versions can drift apart, so CI can pass on a Bun that production doesn't run.
- **Fix:** pin the image, for example `oven/bun:1`, matching the major version of the runtime
  image.
- **In CMP:** not changed. It is listed because it is a template-wide issue.

## Judgement calls

### 14. Compose defaults: public docs, port on all interfaces

- **Where:** `docker/docker-compose.yml` in backend-service and fullstack-nuxt-app:
  `API_DISABLE_DOCS: false` and `ports: "12520:12520"`.
- **Problem:** the API reference and full OpenAPI spec are public in production, and the port
  listens on every interface. Doc 14 (line 137) itself recommends `127.0.0.1:<port>:<port>` when
  the reverse proxy runs on the same host.
- **Fix:** default to a loopback binding and docs off, with comments on when to change them. With
  a loopback binding, trusting the proxy's `X-Forwarded-For` (issue 2) becomes safe.
- **In CMP:** `docker/docker-compose.yml` (`127.0.0.1:31316:31316`, `CMP_API_DISABLE_DOCS: true`,
  `CMP_TRUST_PROXY: true`).

### 15. OpenAPI server URLs wrong in full-stack

- **Where:** `templates/fullstack-nuxt-app/server/lib/api/versions/v1/index.ts` lines 42 and 46,
  and `server/lib/utils/constants.ts` line 10.
- **Problem:** the URLs use the backend's shape (`http://localhost:<port>/v1` and
  `https://api.<name>.is-on.net/v1`). In the full-stack shape the API lives at `<app>/api/v1`;
  doc 04 says so itself.
- **Impact:** only the "Try it" servers on the docs page are wrong. The app sets its own base URL.
- **Fix:** `http://localhost:<port>/api/v1` and `<app url>/api/v1`.
- **In CMP:** already correct (it predates the template).

### 16. Biome version mismatch breaks typecheck after auto-fix

- **Where:** every template's `biome.json` targets the 2.5.9 schema. Installs resolve Biome 2.6.x.
- **Problem:**
  - Every Biome run prints a version notice.
  - Biome 2.6's safe fix rewrites `// @ts-ignore` to `// @ts-expect-error`.
  - The templates use `@ts-ignore` where the two type checks disagree, for example `c.get(...)` in
    `authHandler.ts` and `Bun?.isStandaloneExecutable`. After `biome check --write`, one of the
    two checks reports an unused directive and `bun run typecheck` fails.
- **Fix:** run `biome migrate` in the templates. Then either replace those `@ts-ignore`s with typed
  code or document the behaviour.
- **In CMP:** documented in `CLAUDE.md`.

## Document only

### 17. `created_at` has only second precision

- **Where:** `SQLUtils.getCreatedAtColumn` in backend-service, fullstack-nuxt-app and
  `shared/backend` uses the SQL default `(unixepoch() * 1000)`.
- **Problem:** values look like milliseconds but only change once per second. Comparisons such as
  "messages newer than the read marker" go wrong within the same second. Adding `$defaultFn`
  does not help, because Drizzle prefers the SQL default. Changing the default expression would
  make existing projects rebuild every table.
- **Fix:** add a doc 08 note: set `created_at: Date.now()` explicitly where millisecond ordering
  matters.
- **In CMP:** documented in `AGENTS.md`; chat messages set the time explicitly.
