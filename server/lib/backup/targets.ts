import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/** Backups are named after their creation time (UTC), which is also how they are sorted. */
export const BACKUP_NAME_PATTERN =
	/^iventworks-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.backup$/;

export function backupName(time: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `iventworks-${time.getUTCFullYear()}${pad(time.getUTCMonth() + 1)}${pad(time.getUTCDate())}-${pad(time.getUTCHours())}${pad(time.getUTCMinutes())}${pad(time.getUTCSeconds())}.backup`;
}

/** Creation time from a backup's name, or null for files that aren't backups. */
export function backupTime(name: string): number | null {
	const match = BACKUP_NAME_PATTERN.exec(name);
	if (!match) return null;
	const [, y, mo, d, h, mi, s] = match.map(Number) as number[];
	return Date.UTC(y!, mo! - 1, d!, h!, mi!, s!);
}

export interface StoredBackup {
	readonly name: string;
	readonly size: number;
	readonly created_at: number;
}

/** Where backup files are kept: the local backup directory or an S3 bucket. */
export interface BackupTarget {
	readonly label: string;
	list(): Promise<StoredBackup[]>;
	/** Store the finished file at `path` under `name`. */
	put(name: string, path: string): Promise<void>;
	/** Copy the backup `name` to the local file `path`. */
	download(name: string, path: string): Promise<void>;
	remove(name: string): Promise<void>;
}

function byNewest(a: StoredBackup, b: StoredBackup) {
	return b.created_at - a.created_at;
}

export class LocalTarget implements BackupTarget {
	readonly label: string;

	constructor(readonly dir: string) {
		this.label = `local (${dir})`;
	}

	pathOf(name: string) {
		return join(this.dir, name);
	}

	async list(): Promise<StoredBackup[]> {
		await mkdir(this.dir, { recursive: true });
		const backups: StoredBackup[] = [];
		for (const name of await readdir(this.dir)) {
			const created = backupTime(name);
			if (created === null) continue;
			backups.push({ name, size: (await stat(this.pathOf(name))).size, created_at: created });
		}
		return backups.sort(byNewest);
	}

	async put(name: string, path: string) {
		await mkdir(this.dir, { recursive: true });
		const target = this.pathOf(name);
		await rename(path, target).catch(async () => {
			// Another file system (the temp dir on its own volume): copy instead.
			await copyFile(path, target);
		});
	}

	async download(name: string, path: string) {
		await copyFile(this.pathOf(name), path);
	}

	async remove(name: string) {
		await rm(this.pathOf(name), { force: true });
	}
}

export interface S3Settings {
	readonly endpoint: string;
	readonly region?: string;
	readonly bucket: string;
	readonly accessKeyId: string;
	readonly secretAccessKey: string;
	/** Folder inside the bucket, e.g. `iventworks/` ("" for the bucket root). */
	readonly prefix: string;
}

/** Off-site copies in an S3-compatible bucket (Bun's built-in client). */
export class S3Target implements BackupTarget {
	readonly label: string;
	private readonly client: Bun.S3Client;
	private readonly prefix: string;

	constructor(settings: S3Settings) {
		this.client = new Bun.S3Client({
			endpoint: settings.endpoint,
			region: settings.region,
			bucket: settings.bucket,
			accessKeyId: settings.accessKeyId,
			secretAccessKey: settings.secretAccessKey,
		});
		const prefix = settings.prefix.replace(/^\/+/, "");
		this.prefix = prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix;
		this.label = `s3://${settings.bucket}/${this.prefix}`;
	}

	async list(): Promise<StoredBackup[]> {
		const backups: StoredBackup[] = [];
		let continuationToken: string | undefined;
		do {
			const page = await this.client.list({ prefix: this.prefix, continuationToken, maxKeys: 1000 });
			for (const object of page.contents ?? []) {
				const name = object.key.slice(this.prefix.length);
				const created = backupTime(name);
				if (created === null) continue;
				backups.push({ name, size: object.size ?? 0, created_at: created });
			}
			continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
		} while (continuationToken);
		return backups.sort(byNewest);
	}

	async put(name: string, path: string) {
		// Multipart upload in parts, so large backups never sit in memory as a whole.
		const writer = this.client.file(this.prefix + name).writer({
			partSize: 16 * 1024 * 1024,
			queueSize: 4,
			retry: 3,
			type: "application/octet-stream",
		});
		for await (const chunk of Bun.file(path).stream()) {
			writer.write(chunk);
			await writer.flush();
		}
		await writer.end();
	}

	async download(name: string, path: string) {
		const writer = Bun.file(path).writer();
		for await (const chunk of this.client.file(this.prefix + name).stream()) {
			writer.write(chunk);
		}
		await writer.end();
	}

	async remove(name: string) {
		await this.client.unlink(this.prefix + name);
	}
}
