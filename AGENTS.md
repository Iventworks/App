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

- Env prefix `CMP_`, token/cookie prefix `cmp` (`cmp_session_token`), see
  `server/lib/utils/constants.ts`.
- Port **31316** in dev and prod. This deviates from the guide's 12xxx rule (docs/02 › Ports): it is
  the port the pre-merge CMP web app already used.
- Roles: `admin`, `core_team`, `volunteer`, `unverified` (new accounts default to `unverified`).
- `PUT /api/v1/account` deliberately does **not** require `current_password` (unlike the template and
  docs/10), so the existing profile form keeps working.
- All pages render client-side (`routeRules: { "/**": { ssr: false } }`); the PWA service worker
  must never answer `/api/**` (`pwa.workbox.navigateFallbackDenylist`).
- Chat and calendar use Nuxt UI's `UChatMessages` / `UChatPrompt` and `UCalendar`. The `ai`
  devDependency only provides the `UIMessage` types the chat components need.
