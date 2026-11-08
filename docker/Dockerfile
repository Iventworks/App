# Production image: the full-stack server bundle (.output/ — Nuxt + the Hono API, Bun preset) on
# the Bun runtime. Build it first (CI does this): `bun run build`. .output/ is self-contained;
# only the Drizzle migrations are copied next to it — DB.init applies them on startup
# (CMP_DB_AUTO_MIGRATE) from CMP_DB_MIGRATION_DIR. Layout: app under app/, data/
# and config/ are volumes beside it.
# Runtime config comes from the prefixed env: one `CMP_APP_URL` drives both the API side
# (CORS, links in emails) and the browser's config — the Nitro banner in nuxt.config.ts maps it
# onto `NUXT_PUBLIC_APP_URL` at server start; NUXT_PUBLIC_* remains a pure override.
FROM oven/bun:1-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /opt/crossover/cmp

COPY ./.output /opt/crossover/cmp/app/.output
COPY ./drizzle/migrations /opt/crossover/cmp/app/drizzle/migrations

EXPOSE 31316/tcp

ENV NODE_ENV=production

ENV NITRO_HOST=::
ENV NITRO_PORT=31316

ENV CMP_DB_PATH=/opt/crossover/cmp/data/db.sqlite
ENV CMP_DB_AUTO_MIGRATE=true
ENV CMP_DB_MIGRATION_DIR=/opt/crossover/cmp/app/drizzle/migrations

ENV CMP_LOG_DIR=/opt/crossover/cmp/data/logs
ENV CMP_CONFIG_BASE_DIR=/opt/crossover/cmp/config


VOLUME /opt/crossover/cmp/data
VOLUME /opt/crossover/cmp/config

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
	CMD curl -f http://localhost:31316/api/health || exit 1

CMD ["bun", "run", "/opt/crossover/cmp/app/.output/server/index.mjs"]
