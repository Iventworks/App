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
  (`server/routes/ws/`) require `nitro.experimental.websocket = true` (Bun preset) — it is on for
  the realtime channel.
- Format with Biome before finishing. Conventional Commits.

## Iventworks-specific rules and exceptions

Record every divergence from the style guide here (docs/17: "discuss, record"). The app was called
CMP (Crossover Management Portal) before; the repository still is.

- Env prefix `IVENTWORKS_`, token/cookie prefix `iventworks` (`iventworks_session_token`,
  `iventworks_sess_…`), see `server/lib/utils/constants.ts`. The old `CMP_*` names are read as a
  fallback by `ConfigHandler`; `bun run db:import-legacy` imports pre-merge CMP-API accounts.
- Port **31316** in dev and prod. This deviates from the guide's 12xxx rule (docs/02 › Ports): it is
  the port the pre-merge CMP web app already used.
- **Orgs (tenants) — every change must keep them apart.** All org data carries `org_id`
  (`orgIdColumn()` in the schema); see README › Organisations for single- vs multi-org mode.
  - Every `select`/`update`/`delete` on an org table has `inOrg(<table>)` in its `where`, every
    join on an org table has `inOrg(<joined table>)` (or `eq(<joined>.org_id, <other>.org_id)`) in
    its condition, every insert sets `org_id: OrgContext.id()` — after any spread of a request body,
    so the body can't override it. Request bodies never accept `org_id`.
  - Ids from a request (user ids, room ids, file ids, …) are looked up within the org before they
    are written; with `inOrg` the existing existence checks do that.
  - The **tenant guard** (`server/lib/orgs/guard.ts`) enforces this on every prepared statement:
    a statement on an org table without an org filter bound to `OrgContext.id()` throws (500).
    Only system code may use `OrgContext.unscoped(...)` (registry, migrations, housekeeping, org
    deletion, the system API's org list). Work for one org from outside a request runs in
    `OrgContext.run(org, …)`.
  - The org comes from the host (`X-Iventworks-Host` > `X-Forwarded-Host` > `Host`) via the
    in-memory `OrgRegistry`; `orgMiddlewareV1` runs before auth, so tokens only resolve within the
    host's org. Call `OrgRegistry.reload()` after changing orgs, domains or branding.
  - Links for emails and API responses use `OrgContext.current().url` (the org's primary or default
    domain), never `APP_URL`. `APIResponse.success` strips `org_id` from every response. The
    browser calls the API on its own origin (`useAPIOrigin()` in `updateAPIClient` /
    `useFileURL`) instead of the template's `<appUrl>/api/v1`.
  - Custom domains are active when verified (DNS) and approved (`approved_at`): automatically with
    `IVENTWORKS_CUSTOM_DOMAINS_SELF_SERVICE` or when a system admin adds one, otherwise through the
    system API's approval route after the domain is in the reverse proxy. Only active domains are
    in the registry, can be primary and pass the TLS check.
  - System admins are the users of the internal `system` org (multi-org base domain). The system
    host only serves `/instance`, `/system`, `/auth`, `/account`, `/admin/{users,invitations,
    audit-log}`; their audit entries go to the system org's log.
  - Tests run in multi-org mode against `test.localhost` (`tests/helpers/orgs.ts`); code outside
    requests uses the test org with the guard off. `tests/cross-org-security.test.ts` must stay
    green, and the preload fails the run if any row references a row of another org.
- **Roles / RBAC** (docs/10 › full RBAC): org roles (per org) `admin > core_team > volunteer > unverified`,
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
  - *Invitation* (`/admin/invitations`): email link, the invitee sets their name and password (and
    picks a username in free mode) at `/auth/accept-invite?token=…` (`/auth/invitations/*`).
  - *Direct* (`POST /admin/users`, "Benutzer anlegen"): with a password, or without one — then the
    response carries a one-time link (`PasswordLinks`, 7 days, `/auth/reset-password?token=…`)
    that the admin hands over. Admins can also issue such a link later (`…/password-link`).
- **Usernames** per org (`orgs.username_mode`, *Administration → Organisation*): `schema` (default,
  also for orgs that existed before; `orgs.username_schema`, default `{FIRSTNAME}.{LASTNAME}`)
  builds the username from first and last name — for invitations and direct creation; `free` lets the invitee / admin pick it. Rules live in
  `server/lib/utils/usernameSchema.ts` (pure, also imported by the frontend so previews match):
  `{FIRSTNAME}` is the first of the first names, `{LASTNAME}` the whole last name, umlauts spelled
  out (ä → ae, ß → ss), Cyrillic and Greek transliterated (ICAO), the result follows
  `UserDataPolicies.Username`. A name in another script (Chinese, Arabic, …) gives none: then the
  username is picked as in free mode (`needsChosenUsername`). `UsernamePolicy.resolve`/`assign`
  append a number when taken (`max.mueller2`; too-short names `li001`). They are synchronous: no
  `await` between picking the name and inserting the account, or parallel requests collide on the
  unique index. Only applies when an account is created — existing usernames are never rewritten. Under a schema `PUT /account` refuses username changes (403,
  `username_managed` on `GET /account`); admins can still rename. The system org always chooses
  freely. Tests: the shared test org is in `schema` mode; `setTestOrgUsernameMode` switches it (restore
  it in `afterAll`).
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
  binding `clientIP` (`server/lib/api/utils/clientInfo.ts`); `IVENTWORKS_TRUST_PROXY` uses the last
  `X-Forwarded-For` entry. Counters are keyed per org.
- **Foreign keys are enforced** (`PRAGMA foreign_keys = ON` in `DB.init`) — not in the guide. The
  schema's `onDelete` actions are relied on (e.g. deleting an event cascades to its rows).
  The `created_at` SQL default has second precision — set `created_at: Date.now()` explicitly
  where millisecond ordering matters (chat messages vs. read markers do this).
- **File uploads and contents** (not covered by the guide): blobs on disk under
  `IVENTWORKS_UPLOAD_DIR` via `FileStorage`, metadata in `files`, all access through `FileService`
  / `FileAccess`. Upload routes use
  `zValidator("form", …, undefined, { media: "multipart/form-data" })`. Contents are plain paths
  with an access check on every request (`content_url`, `?download=1`):
  `GET /files/{id}/content/{name}` and `…/versions/{id}/content/{name}` are the only routes that
  accept the session cookie instead of the `Authorization` header (GET/HEAD, SameSite=Lax,
  `COOKIE_AUTH_PATH` in `middleware/auth.ts`), so `<img src>`, links and new tabs work. Uploaded
  MIME types are client-controlled: `FileService.displayAs` decides what the browser may show
  (raster images, text as `text/plain`, PDFs by their first bytes — with `SAMEORIGIN` framing so
  our pages embed the browser's viewer); everything else, notably SVG and HTML, goes out as an
  `application/octet-stream` attachment. Housekeeping deletes blobs no row references.
- **Document libraries**: the org library (`/org/documents`) and event documents
  (`/events/{id}/files`) are one router factory, `createFileLibraryRouter`
  (`server/lib/api/utils/fileLibraryRoutes.ts`, model `FileLibraryModel` in `shared-models/`) —
  unlike the guide's `index.ts` + `model.ts` per resource, like `createOrgDomainRouter`: the two
  only differ in who may do what. Everything on one item (rename, move, delete, contents,
  versions, access, share links, office) is the shared `/files/{fileId}` router. Pages:
  `/documents` is the member view (`view=member`), `/core-team/documents` manages the library;
  see CLAUDE.md for `useDocumentLibrary` / `FilesBrowser`.
- **File page** (`/files/[file_id]`, layout `viewer`, no sidebar): office files open straight in
  the office editor, PDFs in the browser's own viewer (pdf.js only where there is none, loaded
  lazily), text as text (Markdown read-only) — never as HTML. There is no in-app text editing:
  Markdown co-editing was removed (its own sync protocol cost more than it was worth next to notes
  and Office); don't bring it back.
- **Versions** (`file_versions`, `FileVersions`): content changes go through
  `FileService.replaceContent`, which keeps the old blob as a version — the same person at most
  once every ten minutes; an office editing session (it starts with the lock) always keeps what was
  there before it, its own saves at most once every ten minutes; empty contents never. Restoring
  copies the version (it stays) and keeps the current contents. `files.contents_updated_at` is when
  the contents were written (renaming doesn't count). Housekeeping keeps 30 days, the newest ten
  longer, at most 50. Versions are never copied with an event.
- **Papierkorb** (`files.deleted_at`, `FileTrash`): deleting org or event documents (also through
  a share link) moves them there; receipts and attachments are deleted right away. What is in it,
  or below a folder in it, is gone everywhere else — **a new query on `files` for documents must
  skip it** (`FileService.listFolder`, `isInTrash`). Managers see, restore and purge everything,
  others see and restore what they deleted. When the item's folder is in the Papierkorb too, only
  managers restore it: to the top level, with a list that lets only them in (409 for others).
  Deleting is refused while a file in it is locked by the office server
  (`FileLocks.blockingWithin`). Housekeeping purges after 30 days.
- **Office documents** (Nextcloud Office — the production distribution of Euro-Office — over
  WOPI, optional; `IVENTWORKS_OFFICE_URL`, `server/lib/office`, `routes/wopi`, `FilesOfficeFrame`):
  `POST /files/{id}/office` (browser sessions) issues an access token (`wopi_tokens`, hashed, tied
  to the login session) and the editor URL; the browser posts the token to the editor in a frame,
  so the office server's code never runs on our origin (that is why not its document API). The
  office server calls back on the org's public address. Deliberate deviations and rules:
  - WOPI routes answer in WOPI's format (raw JSON, bytes, `X-WOPI-*` headers), not the envelope,
    and are not in the OpenAPI spec. The login middleware skips `/v1/wopi/`.
  - Every call needs the proof signature (`WopiProof`) — never token-only — and the token is
    checked again: session, person, Papierkorb, current rights (`OfficeTokens.resolve`).
  - Files are addressed by `WopiIds` (`<id>-<hash>`): the office server keys open documents by
    that id alone, across installations.
  - The page CSP adds the office origin to `frame-src` / `form-action`; saves (PutFile) may be as
    large as uploads (`RequestLimits.limitFor`, by path).
  - Locks are WOPI's (`FileLocks`, 30 min): no uploads, restores or deletes meanwhile (409).
    Office saves are audited once per version they keep, not when a document is opened.
  - New documents are empty files; the office server fills them with its German template (an
    unlocked PutFile, which only empty files allow).
  - Compose: the optional `office` service (profile `office`), image `:latest`. v9.3.8 needs
    `EO_LIB` (its entrypoint leaves the data folder root-owned, Euro-Office/DocumentServer#578):
    the compose file sets it, the Website docs leave it out on purpose — drop it once a release
    has the fix.
  - Host names: backend services go under `ivb.` (`office.ivb.<org domain>`) — a host of its
    own, never a path or port of the app's. `ivb` is a reserved org slug.
- **Share links** (`file_shares`, `FileShares`): `<org url>/s/<token>` (page `pages/s/[token].vue`,
  layout `public`, API `/shares/{token}/…`) opens a file or a folder for people without an
  account; per link read (off: upload-only), upload, edit, delete, an optional password and expiry.
  - Every request through a link resolves its ids with `FileShares.resolveInShare` (the shared
    item or something below it); the shared item itself is never renamed or deleted through it.
  - Only managers of the library create links, so a link never grants more than its creator has.
    Receipts and chat attachments are never shared.
  - Unknown, expired and disabled links answer 404; `orgs.file_sharing_enabled` switches them all
    off. Changes through a link are audited without a user.
- **Document access lists** (`file_access`, `files.custom_access`, `FileAccess`, `FileAccessLists`):
  - Managers may do everything, including access and links: the Kernteam for org documents, the
    Leitung for event documents (`files:manage_all`, so also the Kernteam). Everyone else gets the
    rights of the nearest list above (read, upload, edit, delete — the share-link presets; files
    only view or edit); without one, the library default (org: Kernteam-only; event: the whole
    team views and uploads). No deny rules. Event lists only name the team, its groups or team
    members; removing someone from the team removes their entries.
  - An item is visible only when every folder above it can be read. Items with their own list are
    renamed, moved or deleted by managers only; a folder that holds one is moved or deleted by
    managers only (`hasCustomAccessBelow`). Own uploads stay theirs while they may upload there.
  - Folders nest at most `FileService.MAX_DEPTH` deep; `getPath` throws rather than return part of
    a chain — the access walk must see every list above an item.
  - What someone may do comes with each item (`permissions`, from the `/files/{fileId}` loader or
    the listing); pages never derive it from roles. Program items only show and link files the
    caller can open (`FileAccess.readableIds`). Receipts follow their expense, not access lists.
  - Migration `0007` kept existing org documents visible ("Alle Mitglieder: ansehen").
- **Org groups** (`org_groups`, *Administration → Gruppen*): admin-managed, used in org access
  lists; deleting a group removes its entries.
- **Time**: dates are `YYYY-MM-DD` strings, instants unix ms; "today" is computed in
  `IVENTWORKS_TIMEZONE` (`server/lib/utils/time.ts`). Wall-clock times (`HH:MM`) become instants
  with `TimeUtils.instantOf`; moving an instant by whole days keeps its time of day across DST
  (`TimeUtils.shiftDays`) — never add `n * 86 400 000`.
- **Recurring events** (`events.type = "recurring"`, "Regeltermin"): the rule is
  `events.recurrence` (JSON, `server/lib/utils/recurrence.ts`: weekly on weekdays / monthly on a
  day or weekday of the month, every n, usual time); `start_date`/`end_date` are the first and last
  day of the series (at most three years, 400 dates). The single dates are rows of
  `event_occurrences`, kept in line with the rule by `Occurrences.syncWithRule` after every change
  to type, dates or rule: future dates the rule no longer has are deleted unless someone worked
  on them (topic, notes, own time/place, duties, cancelled — those become `origin = manual`), past
  dates are history. Dates of the series are cancelled, never deleted (the rule would bring them
  back); only `manual` dates can be moved or deleted. The duty roster ("Dienstplan") is
  `occurrence_duties` (date × responsibility × person); the responsibility's assignees are the
  usual cast that `POST …/occurrences/plan` fills from (all, or in turns).
  - A series takes place on its planned dates, not from `start_date` to `end_date`. Anything that
    asks "does it run today / overlap / clash" goes through `EventSchedule` (dashboard, core team
    overview, staff planning, resource bookings, event overview); the calendar shows the dates.
    Frontend: `eventPhase()` / `eventDateLabel()` in `app/utils/events.ts`.
  - Leaving an event's team takes the person off its upcoming duties (`removeUpcomingDuties`).
- **Copying events** (`POST /events/{id}/copy`, core team, `EventCopier` in
  `server/lib/api/utils/eventCopy.ts`): master data always, the rest per part (`include`). People
  only come along with `team` (and only accounts that can still sign in); program items and due
  dates move with the new start (`TimeUtils.shiftDays`), tasks are open again, participants are
  registered again and unpaid, documents are real copies (`FileStorage.copy`) with their access
  lists (group entries with the groups, people with the team; what can't come along is dropped, so
  a restricted folder stays restricted), resource bookings
  only where the resource is free on the new days. Never copied: expenses, chats, audit log, the
  leaders' notes about staff, notes about participants, the dates of a series (they come from the
  rule). A new event table or column that belongs to an event must be added to `EventCopier` (or
  consciously left out) and to its `summary`.
- **Kleingruppen** (`small_groups`, `routes/events/small-groups/`, page `/events/{id}/small-groups`):
  small groups of participants, each led by one or more people from the event's team
  (`small_group_leaders`, notified with `small_group_assigned`), with an optional meeting point
  ("Treffpunkt"). A participant is in at most one (`participants.small_group_id`, `ON DELETE SET
  NULL`); one person may lead several. Program items can take place in them
  (`program_items.in_small_groups`): the item, the agenda and the PDF then show every group with its
  leaders and meeting point. Permissions `small_groups:view` / `small_groups:manage`. Copied as the
  `small_groups` part (leaders with `team`, members with `participants`).
- **Room responsibles** (`room_responsibles`, `responsible_ids` on the room routes, notified with
  `room_assigned`): optional staff responsible for a room; rooms with participants but nobody
  responsible are flagged "Ohne Verantwortliche" in the UI. Leaving an event's team also ends the
  person's Kleingruppen leadership and room responsibility.
- **Program PDF** (`app/utils/programPdf.ts`, `ProgramExportModal`): built in the browser with jsPDF
  + jspdf-autotable, loaded with dynamic `import()` only when exporting. Layouts "Liste" (A4
  portrait) and "Wochenraster" (A4 landscape, lanes like `WeekGrid`), optional Kleingruppen
  appendix. Standard PDF fonts only (no font files, no requests); never call jsPDF's `.html()` /
  SVG paths — they pull in html2canvas/dompurify/canvg. Printing loads the blob into a hidden frame
  (desktop) or a new tab with auto-print (Safari, touch devices), falling back to a download.
- **Confirmations** use our modals, never `window.confirm`/`alert`: `useConfirmDialog()` (any
  question) and `useUnsavedChangesDialog()` ("Speichern / Verwerfen / Weiter bearbeiten") — both
  return a promise, so route guards can `await` them. `FormMarkdownEditor` only passes changes on
  after the person interacted with it: `UEditor` re-serialises the markdown it is given (trailing
  paragraph after a list, list markers), which would otherwise mark every form as unsaved.
- **Realtime** (`server/lib/realtime/`, the style guide has no spec): one WebSocket per tab at
  `/ws/realtime` (`server/routes/ws/realtime.ts` → `RealtimeGateway`). It only *signals*
  (`conversation` changed, `typing`, `presence`, `notification`); the data always comes from the
  REST API, so access checks stay in one place and polling remains as a slow fallback.
  - Auth: no cookie, no token in the URL — the client gets a one-time ticket with its bearer token
    (`POST /realtime/ticket`, 30 s, bound to the org) and opens `/ws/realtime?ticket=…`. The upgrade
    also checks the host's org and the browser `Origin`. Every minute each socket is checked
    against its session/API key and user (revoked, suspended, unverified → closed with 4401);
    logout, revoking sessions or API keys and demotion close them at once
    (`RealtimeHub.closeFor`, called from `AuthHandler`). Tickets are rate-limited per person.
  - Everything is per org (`RealtimeHub` is keyed by org id). Handlers announce changes with
    `Realtime.conversationChanged(…)` / `Realtime.notificationsChanged(…)` *after* storing them —
    a new chat change that others should see must call it (messages router: `touch()`).
  - Clients may only send `ping` and `typing` (small, rate-limited, typing only reaches the
    people of a chat the sender is in). In production only `/ws/realtime` is upgraded
    (`server/runtime/bun.ts`); in `nuxt dev` Nitro's dev server handles upgrades itself.
  - Frontend: `useRealtime()` (started by the dashboard layout, stopped on logout),
    `useRealtimeEvent()` in components; views poll every 30 s – 5 min while connected and fall
    back to the old intervals without it.
- **Web Push** (`server/lib/push/`): notifications while the app is closed. VAPID keys from
  `IVENTWORKS_WEB_PUSH_*` or generated once into `metadata` (`web_push_vapid` — never change them,
  it invalidates every subscription). `push_subscriptions` are per org, user **and session**
  (`ON DELETE CASCADE`: logout, revoked or expired sessions end a device's pushes); API keys can't
  subscribe. Rules:
  - SSRF: the server POSTs to stored endpoints, so only https URLs of known push services
    (`PushService.KNOWN_HOSTS`, `IVENTWORKS_WEB_PUSH_EXTRA_HOSTS`) are accepted and re-checked
    before every send; no redirects, 10 s timeout. 404/410 delete a subscription, ten failures in a
    row too.
  - `PushTriggers` decide who gets one: chat messages (not the sender, not muted chats) and every
    `Notifier.notify`; never while the person is *active* (visible, focused tab with input in the
    last 3 minutes, reported over the realtime socket as `activity`); per-user settings in
    `user_preferences.notifications` (`push_messages`, `push_notifications`, `push_preview`).
    Sending is queued (`PushService.send`/`track`, `flush()` in tests) and never blocks a request.
  - Frontend: `usePushNotifications()` (opt-in per user in `localStorage`, re-registered after
    every login by the dashboard layout, forgotten on logout), `public/sw-push.js` imported into the
    Workbox worker (`pwa.workbox.importScripts`), `/settings/notifications`. Only in production
    builds (no service worker in `nuxt dev`); iOS only for the installed app.
- **Presence**: online status and `users.last_seen_at` (set when someone connects, disconnects and
  every minute while connected) are shown only for people with `share_presence` on (default);
  switching it off hides both immediately (`Realtime.presenceSharingChanged`) and stops
  `last_seen_at` from being written. The admin users API never shows it.
- **Messaging** is REST + realtime signals: an open chat syncs with
  `GET /conversations/{id}/messages/sync?after=<last id>&since=<server_time>&from=<first id>` when
  the socket says it changed (else every few seconds) and receives new messages plus what changed
  on loaded ones — every change (edit,
  reaction, pin, deletion) bumps `messages.updated_at`, which is what sync reports; messages are
  soft-deleted as tombstones with their text wiped, so deletions can be synced. The same response
  carries the pinned ids and `read_by_all_until` (the read ticks). One sync reports at most 500
  changes; with `truncated: true` the client reloads the chat instead. Read positions shown to
  others are the time of the newest message someone has read, never their exact marker. Rules:
  - Message logic lives in `MessageService` (`server/lib/api/utils/messages.ts`), chat access and
    membership of every chat type in `ConversationAccess`. A message change that others should see
    must go through `touch()` in the messages router.
  - **Attachments** are rows of `files` with `scope = "message"` (`conversation_id`, `message_id`):
    uploaded first (`POST /conversations/{id}/attachments`, visible to the uploader only), then
    sent with a message (`attachment_ids`). `FileAccess` lets everyone in the chat read them through
    the normal content path; they are never renamed, deleted or shared through the file routes.
    Deleting a message deletes its files; rows vanish with their chat (`ON DELETE CASCADE`) and
    housekeeping removes the blobs and uploads that were never sent.
  - `conversation_members` also holds each person's own settings (`pinned_at`, `muted`) and read
    marker; for derived channels (event, group, core team) that row has `is_member = false` — never
    treat a row there as membership. Muted chats are left out of the unread total.
  - Frontend: `components/chat/` (`ConversationPane` orchestrates; `MessageBubble`, `Composer`,
    `MessageListSlideover` for search and pins). Links in messages come from `linkify()` — message
    text is never rendered with `v-html`. Emoji offered in `utils/chat.ts` must pass
    `MessageService.Emoji` (a test checks it).
- **Migrations**: drizzle-kit writes `ALTER TABLE … ADD … REFERENCES t(id)` *without* the
  `ON DELETE` action. Add it by hand in the generated SQL (see `0003_chat_features.sql`), otherwise
  deleting the referenced row fails once foreign keys are on.
- **Transactions** on bun-sqlite: an `async` callback to `DB.instance().transaction()` commits
  after its first statement — later statements run outside it and a `throw` rolls nothing back.
  Where atomicity matters, write the callback synchronously (`.get()` / `.all()` / `.run()`, no
  `await`; see the message send and `EventCopier`) and turn errors into responses outside it.
- All pages render client-side (`routeRules: { "/**": { ssr: false } }`) — the guide's
  "everything behind login" variant. Internal-only app: there is no public `default` layout; pages
  use `definePageMeta({ layout: "dashboard" })` (or `auth`).
- **PWA** (`@vite-pwa/nuxt`) is kept (the guide ships none): it is the only mobile channel — no
  native/TWA builds are shipped. Every org is its own app: the manifest and icons come from the
  API per host (`/api/v1/instance/manifest.webmanifest`, `/icon`, `/favicon`,
  `/apple-touch-icon`); `pwa.manifest` is off. The app is named after the product and the org
  (`Iventworks für <org>`, home-screen label `Iventworks`; `useInstallName()` in the frontend), so
  it is found under the product's name. `/settings/apps` offers the install (`usePwaInstall`, which
  replays the `beforeinstallprompt` event caught by `plugins/pwaInstall.client.ts`) and the
  manual steps per platform, always — also next to the button, as a fallback. That plugin has
  `order: -40` so it runs before every async plugin: Chrome fires the event once per page load.
  The service worker must never answer `/api/**` (`pwa.workbox.navigateFallbackDenylist`).
- UI language is German, informal ("du").
- **Content-Security-Policy** (pages: `server/plugins/csp.ts`, everything else:
  `server/middleware/00.security-headers.ts`): scripts only from our own files plus the page's
  inline scripts by hash, computed per response. So: no inline scripts in `app.head` (use a client
  plugin), nothing that evaluates strings (Zod runs `jitless`), no third-party requests (icons come
  from the local `/api/_nuxt_icon` — `plugins/iconProvider.client.ts` works around @nuxt/icon not
  doing so with @iconify/vue 5). Endpoints that serve files set their own CSP, which replaces the
  default `default-src 'none'` of API responses.
- **Server entry** `server/runtime/bun.ts` replaces the Bun preset's entry (`nitro.entry`, set
  under `$production` only — in `nuxt dev` it would start a second server inside the dev worker):
  it refuses oversized bodies before reading them (uploads: `IVENTWORKS_MAX_UPLOAD_SIZE_MB`, other
  requests 2 MB, `RequestLimits`) and upgrades only `/ws/realtime` to a WebSocket (with frame,
  idle and backpressure limits from `RealtimeLimits`). Keep it in step with nitropack's
  `presets/bun/runtime/bun.mjs`.
- **Backups** (`server/lib/backup/`, README › Backups): encrypted tar.gz of a `VACUUM INTO`
  snapshot plus `uploads/`, scheduled by `CronJobHandler`, CLI `scripts/backup.ts` (bundled to
  `.output/backup.mjs`). New data on disk outside the database or `uploads/` must be added to
  `BackupService` to be backed up. The image declares a third volume, `/opt/iventworks/backups`
  (`IVENTWORKS_BACKUP_DIR`), beside the guide's `data/` + `config/`, so losing the data disk
  doesn't take the local backups along. Otherwise `docker/Dockerfile` is the guide's full-stack
  template (root user, allowlist `.dockerignore`).
- **Branding** per org: name, primary colour (a Tailwind palette from `ORG_PRIMARY_COLORS`, default
  `fuchsia`; `plugins/instance.ts` sets `appConfig.ui.colors.primary` at runtime), logo and icon
  (stored in `org_assets`, type sniffed from the bytes, SVGs only without script/external
  references and served with a sandbox CSP). Use `useBrandName()` / `ImgAppLogo` /
  `ImgAppIcon` instead of hard-coded names; page titles are just the page (`"Aufgaben"`), the
  title template appends the org. Default assets: `public/static/brand/`.
- **Shared components extended** (copies of `shared/frontend`, deliberately changed):
  `DashboardStatCard` takes `to` (the whole card links), `@click` (without `to`: a button over the
  whole card, e.g. the notifications card opening the slideover) and `iconColor: "info"`;
  `DashboardDeleteModal` is German, its confirm word is `LÖSCHEN`, and `requireConfirmText` can
  turn the typing step off for small deletions; `DataTable`/`DateRangePicker` are translated, and
  `DataTable` keeps its actions right-aligned when they wrap below the filters and passes a
  select filter's `icon` as a prop (an empty `#leading` slot reserved icon space).
  Date fields use `FormDatePicker` / `FormDateTimePicker` (Nuxt UI
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
    `DashboardFilterBar` `#left` (our own component with the same card and layout as the DataTable
    header) above content that is not a table. A filter that used to be a tab ("Offen / Meine /
    Alle", role, status, scope) is a `USelect` bound to `useQueryFilter(key, options)`, which keeps
    the value in the query string. Page-wide periods (year, date range) go in a
    `DashboardFilterBar` at the top of the body.
  - Use the DataTable's own filter types, no custom controls in `#header-left` for client-side
    data: option filters are `multi-select` (a pick can be undone), never `select`; a default
    (archived events hidden, open invitations only) is a preset value of that filter via
    `useDataTableInitialFilters`, not a separate switch. Date ranges everywhere use the style
    guide's `FormDateRangePicker` (the DataTable `date` filter), including staff planning and the
    audit log. Only server-side filters (the audit log's) render their own controls there.
  - Create buttons ("Neue Aufgabe", "Anmelden") sit with the list they add to: DataTable
    `#header-right`, `DashboardFilterBar` `#right`, or the `DashboardSectionCard` `#actions` of
    that section. The page header's `#right` keeps only page-level actions (refresh, print,
    settings, edit/delete on a detail page) — never create buttons or filters. Repeating it as
    the empty state's call to action is optional (the style guide's API-key list does).
  - Sidebar links stay highlighted on their sub-pages (`withSubpageActive` in
    `layouts/dashboard.vue`): list and detail pages are sibling routes (`api-keys/index.vue` +
    `api-keys/[api_key_id].vue`), which the router's own active check doesn't connect.
