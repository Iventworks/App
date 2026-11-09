# Production image: the full-stack server bundle (.output/ — Nuxt + the Hono API, Bun preset) on
# the Bun runtime. Build it first (CI does this): `bun run build`. .output/ is self-contained;
# only the Drizzle migrations are copied next to it — DB.init applies them on startup
# (IVENTWORKS_DB_AUTO_MIGRATE) from IVENTWORKS_DB_MIGRATION_DIR. Layout: app under app/, data/
# and config/ are volumes beside it.
# Runtime config comes from the prefixed env: one `IVENTWORKS_APP_URL` drives both the API side
# (CORS, links in emails) and the browser's config — the Nitro banner in nuxt.config.ts maps it
# onto `NUXT_PUBLIC_APP_URL` at server start; NUXT_PUBLIC_* remains a pure override.
FROM oven/bun:1-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /opt/iventworks

COPY ./.output /opt/iventworks/app/.output
COPY ./drizzle/migrations /opt/iventworks/app/drizzle/migrations

EXPOSE 31316/tcp

ENV NODE_ENV=production

ENV NITRO_HOST=::
ENV NITRO_PORT=31316

ENV IVENTWORKS_DB_PATH=/opt/iventworks/data/db.sqlite
ENV IVENTWORKS_DB_AUTO_MIGRATE=true
ENV IVENTWORKS_DB_MIGRATION_DIR=/opt/iventworks/app/drizzle/migrations

ENV IVENTWORKS_LOG_DIR=/opt/iventworks/data/logs
ENV IVENTWORKS_CONFIG_BASE_DIR=/opt/iventworks/config
# Uploaded documents and receipts — part of the data volume, back it up together with db.sqlite.
ENV IVENTWORKS_UPLOAD_DIR=/opt/iventworks/data/uploads
# Encrypted backups (IVENTWORKS_BACKUP_ENABLED): their own volume, so a lost data disk doesn't take
# them along. The CLI: `bun /opt/iventworks/app/.output/backup.mjs list|create|verify|restore`.
ENV IVENTWORKS_BACKUP_DIR=/opt/iventworks/backups


# Run as the image's unprivileged `bun` user. On the host, the bind-mounted directories must be
# writable for it: `sudo chown -R 1000:1000 /opt/iventworks/data /opt/iventworks/config`.
RUN mkdir -p /opt/iventworks/data /opt/iventworks/config /opt/iventworks/backups \
	&& chown -R bun:bun /opt/iventworks
USER bun

VOLUME /opt/iventworks/data
VOLUME /opt/iventworks/config
VOLUME /opt/iventworks/backups

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
	CMD curl -f http://localhost:31316/api/health || exit 1

CMD ["bun", "run", "/opt/iventworks/app/.output/server/index.mjs"]
