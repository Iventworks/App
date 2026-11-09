import { Database } from "bun:sqlite";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import type { ParsedConfig } from "../utils/config";
import { AppConstants } from "../utils/constants";
import { Logger } from "../utils/logger";
import { BackupCrypto } from "./crypto";
import { extractTar, type TarEntry, tarStream } from "./tar";
import { type BackupTarget, backupName, LocalTarget, S3Target, type StoredBackup } from "./targets";

/** What a backup contains, stored as `manifest.json` inside the archive. */
export interface BackupManifest {
	readonly format: 1;
	readonly app: string;
	readonly created_at: string;
	readonly multi_org: boolean;
	readonly database: "db.sqlite";
	readonly uploads: { readonly files: number; readonly bytes: number };
}

export interface BackupSettings {
	readonly enabled: boolean;
	readonly schedule: string;
	readonly timezone: string;
	readonly passphrase: string | null;
	readonly dir: string;
	readonly retentionDays: number;
	readonly retentionMinCount: number;
	/** With S3: how many of the newest backups also stay in the local directory. */
	readonly localCopies: number;
	readonly s3: BackupTarget | null;
	readonly dbPath: string;
	readonly uploadDir: string;
	readonly multiOrg: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_PASSPHRASE_LENGTH = 16;

/**
 * Encrypted backups of the database and the uploaded files (inspired by LeiCraft_MC Vault's
 * backup tool): a consistent SQLite snapshot (`VACUUM INTO`, safe while the app writes) and the
 * upload directory go into a tar.gz, which is encrypted with AES-256-GCM (`BackupCrypto`) and
 * kept in the local backup directory and — when configured — in an S3 bucket. Old backups are
 * removed by age, always keeping a minimum number.
 *
 * Runs on the schedule `IVENTWORKS_BACKUP_SCHEDULE` inside the app, or by hand with the
 * `backup` CLI (`scripts/backup.ts`), which also verifies and restores.
 */
export class BackupService {
	private static running: Promise<StoredBackup> | null = null;

	static settings(config: ParsedConfig): BackupSettings {
		const s3Values = [
			config.BACKUP_S3_ENDPOINT,
			config.BACKUP_S3_BUCKET,
			config.BACKUP_S3_ACCESS_KEY_ID,
			config.BACKUP_S3_SECRET_ACCESS_KEY,
		];
		const s3 = s3Values.every(Boolean)
			? new S3Target({
					endpoint: config.BACKUP_S3_ENDPOINT!,
					region: config.BACKUP_S3_REGION,
					bucket: config.BACKUP_S3_BUCKET!,
					accessKeyId: config.BACKUP_S3_ACCESS_KEY_ID!,
					secretAccessKey: config.BACKUP_S3_SECRET_ACCESS_KEY!,
					prefix: config.BACKUP_S3_PREFIX ?? "",
				})
			: null;

		return {
			enabled: config.BACKUP_ENABLED,
			schedule: config.BACKUP_SCHEDULE,
			timezone: config.TIMEZONE,
			passphrase: config.BACKUP_PASSPHRASE || null,
			dir: config.BACKUP_DIR,
			retentionDays: config.BACKUP_RETENTION_DAYS,
			retentionMinCount: config.BACKUP_RETENTION_MIN_COUNT,
			localCopies: config.BACKUP_LOCAL_COPIES,
			s3,
			dbPath: config.DB_PATH,
			uploadDir: config.UPLOAD_DIR,
			multiOrg: config.MULTI_ORG,
		};
	}

	/** Problems with the backup configuration (empty when fine). Checked at startup. */
	static validate(config: ParsedConfig): string[] {
		const errors: string[] = [];
		const s3Values = {
			BACKUP_S3_ENDPOINT: config.BACKUP_S3_ENDPOINT,
			BACKUP_S3_BUCKET: config.BACKUP_S3_BUCKET,
			BACKUP_S3_ACCESS_KEY_ID: config.BACKUP_S3_ACCESS_KEY_ID,
			BACKUP_S3_SECRET_ACCESS_KEY: config.BACKUP_S3_SECRET_ACCESS_KEY,
		};
		const setS3 = Object.entries(s3Values).filter(([, value]) => Boolean(value));
		if (setS3.length > 0 && setS3.length < 4) {
			const missing = Object.entries(s3Values)
				.filter(([, value]) => !value)
				.map(([key]) => `${AppConstants.APP_ENV_PREFIX}_${key}`);
			errors.push(`S3 backups need all four S3 settings; missing: ${missing.join(", ")}`);
		}

		if (!config.BACKUP_ENABLED) return errors;

		if (!config.BACKUP_PASSPHRASE || config.BACKUP_PASSPHRASE.length < MIN_PASSPHRASE_LENGTH) {
			errors.push(
				`${AppConstants.APP_ENV_PREFIX}_BACKUP_PASSPHRASE must be set (at least ${MIN_PASSPHRASE_LENGTH} characters) when backups are enabled`,
			);
		}
		try {
			if (!Bun.cron.parse(config.BACKUP_SCHEDULE, Date.now(), { tz: config.TIMEZONE })) {
				errors.push(
					`${AppConstants.APP_ENV_PREFIX}_BACKUP_SCHEDULE never fires: ${config.BACKUP_SCHEDULE}`,
				);
			}
		} catch (error) {
			errors.push(
				`${AppConstants.APP_ENV_PREFIX}_BACKUP_SCHEDULE is not a valid cron expression: ${config.BACKUP_SCHEDULE} (${(error as Error).message})`,
			);
		}
		if (config.BACKUP_RETENTION_MIN_COUNT < 1) {
			errors.push(`${AppConstants.APP_ENV_PREFIX}_BACKUP_RETENTION_MIN_COUNT must be at least 1`);
		}
		return errors;
	}

	static localTarget(settings: BackupSettings) {
		return new LocalTarget(settings.dir);
	}

	/** Create one backup now. Concurrent calls share the run in progress. */
	static create(settings: BackupSettings): Promise<StoredBackup> {
		BackupService.running ??= BackupService.createNow(settings).finally(() => {
			BackupService.running = null;
		});
		return BackupService.running;
	}

	/** The scheduled run: never throws (a failure is logged and the next run tries again). */
	static async runScheduled(settings: BackupSettings) {
		try {
			const backup = await BackupService.create(settings);
			Logger.info(`Backup ${backup.name} created (${formatBytes(backup.size)}).`);
		} catch (error) {
			Logger.error("Scheduled backup failed:", error);
		}
	}

	private static async createNow(settings: BackupSettings): Promise<StoredBackup> {
		if (!settings.passphrase) throw new Error("No backup passphrase configured");
		const started = new Date();
		const name = backupName(started);
		const work = join(settings.dir, `.work-${started.getTime()}`);
		await mkdir(work, { recursive: true });

		try {
			// 1. A consistent copy of the database, taken while the app keeps running.
			const snapshot = join(work, "db.sqlite");
			const db = new Database(settings.dbPath, { readonly: true });
			try {
				db.prepare("VACUUM INTO ?").run(snapshot);
			} finally {
				db.close();
			}

			// 2. The uploaded files.
			const uploads = await listFiles(settings.uploadDir);
			const manifest: BackupManifest = {
				format: 1,
				app: AppConstants.APP_NAME,
				created_at: started.toISOString(),
				multi_org: settings.multiOrg,
				database: "db.sqlite",
				uploads: { files: uploads.length, bytes: uploads.reduce((sum, file) => sum + file.size, 0) },
			};
			const entries: TarEntry[] = [
				{
					name: "manifest.json",
					data: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
				},
				{ name: "db.sqlite", path: snapshot, size: (await stat(snapshot)).size },
				...uploads.map((file) => ({
					name: `uploads/${file.name}`,
					path: file.path,
					size: file.size,
					mtime: file.mtime,
				})),
			];

			// 3. tar → gzip → AES-256-GCM, streamed into one file.
			const encrypted = join(work, name);
			const passphrase = settings.passphrase;
			await pipeline(
				Readable.from(tarStream(entries)),
				createGzip({ level: 6 }),
				async function* (source: AsyncIterable<Uint8Array>) {
					yield* BackupCrypto.encrypt(source, passphrase);
				},
				createWriteStream(encrypted),
			);
			const size = (await stat(encrypted)).size;

			// 4. Store it: locally, and off-site when S3 is configured.
			const local = BackupService.localTarget(settings);
			if (settings.s3) {
				await settings.s3.put(name, encrypted);
				Logger.info(`Backup ${name} uploaded to ${settings.s3.label}.`);
			}
			if (!settings.s3 || settings.localCopies > 0) {
				await local.put(name, encrypted);
			}

			// 5. Retention: S3 is the archive when configured; then the local directory keeps only
			// the newest copies.
			const now = Date.now();
			if (settings.s3) {
				await BackupService.applyRetention(
					settings.s3,
					settings.retentionDays,
					settings.retentionMinCount,
					now,
				);
				await BackupService.keepNewest(local, settings.localCopies);
			} else {
				await BackupService.applyRetention(
					local,
					settings.retentionDays,
					settings.retentionMinCount,
					now,
				);
			}

			return { name, size, created_at: started.getTime() };
		} finally {
			await rm(work, { recursive: true, force: true });
		}
	}

	/**
	 * Which backups to delete: older than `retentionDays` (0 = keep all), but never the newest
	 * `minCount`.
	 */
	static decideRetention(
		backups: StoredBackup[],
		retentionDays: number,
		minCount: number,
		now: number,
	) {
		const sorted = [...backups].sort((a, b) => b.created_at - a.created_at);
		if (retentionDays <= 0) return { keep: sorted, remove: [] as StoredBackup[] };
		const cutoff = now - retentionDays * DAY_MS;
		const keep: StoredBackup[] = [];
		const remove: StoredBackup[] = [];
		sorted.forEach((backup, index) => {
			(index < Math.max(1, minCount) || backup.created_at >= cutoff ? keep : remove).push(backup);
		});
		return { keep, remove };
	}

	static async applyRetention(
		target: BackupTarget,
		retentionDays: number,
		minCount: number,
		now = Date.now(),
	) {
		const { remove } = BackupService.decideRetention(
			await target.list(),
			retentionDays,
			minCount,
			now,
		);
		for (const backup of remove) {
			await target.remove(backup.name);
			Logger.info(`Removed old backup ${backup.name} from ${target.label}.`);
		}
		return remove;
	}

	private static async keepNewest(target: LocalTarget, count: number) {
		const backups = await target.list();
		for (const backup of backups.slice(Math.max(0, count))) {
			await target.remove(backup.name);
		}
	}

	/** Local and (when configured) S3 backups, newest first. */
	static async list(settings: BackupSettings) {
		return {
			local: await BackupService.localTarget(settings).list(),
			s3: settings.s3 ? await settings.s3.list() : null,
		};
	}

	/**
	 * Find a backup by file path or by name (local directory first, then S3) and make it
	 * available as a local file. `cleanup` removes a downloaded copy.
	 */
	static async fetch(settings: BackupSettings, nameOrPath: string, workDir: string) {
		if (existsSync(nameOrPath) && (await stat(nameOrPath)).isFile()) {
			return { path: resolve(nameOrPath), cleanup: async () => {} };
		}
		const local = BackupService.localTarget(settings);
		if (existsSync(local.pathOf(nameOrPath))) {
			return { path: local.pathOf(nameOrPath), cleanup: async () => {} };
		}
		if (settings.s3) {
			await mkdir(workDir, { recursive: true });
			const path = join(workDir, nameOrPath);
			await settings.s3.download(nameOrPath, path);
			return { path, cleanup: () => rm(path, { force: true }) };
		}
		throw new Error(`Backup not found: ${nameOrPath}`);
	}

	/**
	 * Decrypt and check a backup without restoring it: the GCM tag (passphrase and integrity) and
	 * the archive's structure. Returns its manifest and file count.
	 */
	static async verify(path: string, passphrase: string, workDir: string) {
		const archive = await BackupService.decryptToFile(path, passphrase, workDir);
		try {
			const { names, captured } = await extractTar(gunzip(archive), null, ["manifest.json"]);
			return { files: names.length, manifest: parseManifest(captured.get("manifest.json")) };
		} finally {
			await rm(archive, { force: true });
		}
	}

	/**
	 * Decrypt a backup and extract it into `targetDir` (must be empty or missing): `db.sqlite`,
	 * `uploads/` and `manifest.json`. Nothing is written before the backup proved authentic.
	 */
	static async restore(path: string, passphrase: string, targetDir: string, workDir: string) {
		if (existsSync(targetDir) && (await readdir(targetDir)).length > 0) {
			throw new Error(`The target directory is not empty: ${targetDir}`);
		}
		const archive = await BackupService.decryptToFile(path, passphrase, workDir);
		try {
			await mkdir(targetDir, { recursive: true });
			const { names, captured } = await extractTar(gunzip(archive), targetDir, ["manifest.json"]);
			return { files: names.length, manifest: parseManifest(captured.get("manifest.json")) };
		} finally {
			await rm(archive, { force: true });
		}
	}

	/** Decrypt into a temporary tar.gz; only a file whose GCM tag matched is kept. */
	private static async decryptToFile(path: string, passphrase: string, workDir: string) {
		await mkdir(workDir, { recursive: true });
		const archive = join(workDir, `restore-${Date.now()}.tar.gz`);
		try {
			await pipeline(
				Readable.from(BackupCrypto.decryptFile(path, passphrase)),
				createWriteStream(archive),
			);
		} catch (error) {
			await rm(archive, { force: true });
			throw error;
		}
		return archive;
	}
}

function parseManifest(bytes: Uint8Array | undefined): BackupManifest | null {
	if (!bytes) return null;
	try {
		return JSON.parse(new TextDecoder().decode(bytes)) as BackupManifest;
	} catch {
		return null;
	}
}

function gunzip(path: string): AsyncIterable<Uint8Array> {
	return createReadStream(path).pipe(createGunzip());
}

async function listFiles(dir: string) {
	if (!existsSync(dir)) return [];
	const files: { name: string; path: string; size: number; mtime: number }[] = [];
	for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile()) continue;
		const path = join(entry.parentPath, entry.name);
		const info = await stat(path);
		files.push({
			name: relative(dir, path).split(sep).join("/"),
			path,
			size: info.size,
			mtime: info.mtimeMs,
		});
	}
	return files.sort((a, b) => a.name.localeCompare(b.name));
}

export function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
