# CMP — Crossover Management Portal

Full-stack Nuxt app: Nuxt 4 frontend **and** the Hono API in `server/`, mounted at `/api`. Built
on the LeiCraftMC style guide's `fullstack-nuxt-app` template.

## Stack

- Nuxt 4 (`app/` srcDir) + NuxtUI v4 + Tailwind v4 (CSS-first), PWA via `@vite-pwa/nuxt`
- Hono + Zod + `hono-openapi` (Scalar) in `server/`, mounted at `/api` via a catch-all Nitro route
- Drizzle ORM + `bun-sqlite`
- Bun runtime (Nitro `bun` preset)
- Biome formatter/linter
- AGPL-3.0

## Setup

```bash
bun install
cp example.env .env
bun run dev   # http://localhost:31316
```

The `server/plugins/startup.ts` Nitro plugin initializes the DB and the Hono `API` on boot.
Endpoints are at `/api/v1/**`, `/api/health`, `/api/docs/v1`. On first start (empty DB) an `admin`
user is created; its one-time password-reset link is logged and written to
`config/initial_admin_password_reset_token.txt`.

## Configuration

All settings are `CMP_*` env vars — see `example.env`. One URL drives both halves:
`CMP_APP_URL` is the public origin (CORS, reset links, and the browser's API base
`<CMP_APP_URL>/api/v1`). `CMP_ENABLE_SIGNUP=true` shows the signup page.

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
- `bun run check` / `check:ci` / `format` — Biome
- `bun run typecheck` — `nuxt typecheck` + `tsc` (includes `server/`)
- `bun test` — API tests

## Structure

See the LeiCraftMC style guide:

- [docs/01-project-structure.md](https://github.com/LeiCraftMC/Style-Guides/blob/main/docs/01-project-structure.md) — the full-stack Nuxt shape
- [docs/04-backend-hono.md](https://github.com/LeiCraftMC/Style-Guides/blob/main/docs/04-backend-hono.md) — Mounting Hono in Nitro
- [docs/06-frontend-nuxt.md](https://github.com/LeiCraftMC/Style-Guides/blob/main/docs/06-frontend-nuxt.md)

## License

AGPL-3.0
