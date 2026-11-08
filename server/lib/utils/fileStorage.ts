import { mkdir as fs_mkdir, rm as fs_rm } from "fs/promises";
import {
	dirname as path_dirname,
	join as path_join,
	resolve as path_resolve,
	sep as path_sep,
} from "path";
import { LCrypt } from "./crypto/lcrypt";
import { Logger } from "./logger";

/**
 * Blob storage for uploaded documents and receipts on the local disk (`<UPLOAD_DIR>/<key>`).
 * Metadata (name, MIME type, owner, folder) lives in the `files` table; storage keys are random
 * and never derived from user input.
 */
export class FileStorage {
	protected static baseDir: string | null = null;
	protected static maxBytes = 25 * 1024 * 1024;

	static async init(baseDir: string, maxSizeMB: number) {
		this.baseDir = path_resolve(baseDir);
		this.maxBytes = Math.max(1, maxSizeMB) * 1024 * 1024;
		await fs_mkdir(this.baseDir, { recursive: true });
		Logger.info(`File storage at ${this.baseDir} (max ${maxSizeMB} MB per file)`);
	}

	static get maxUploadBytes() {
		return this.maxBytes;
	}

	protected static getBaseDir() {
		if (!this.baseDir) {
			throw new Error("FileStorage not initialized. Call FileStorage.init() first.");
		}
		return this.baseDir;
	}

	protected static resolveKey(storageKey: string) {
		const base = this.getBaseDir();
		const fullPath = path_resolve(path_join(base, storageKey));
		if (!fullPath.startsWith(base + path_sep)) {
			throw new Error("Invalid storage key");
		}
		return fullPath;
	}

	/** Store a blob and return its new storage key and size. */
	static async save(blob: Blob): Promise<{ storageKey: string; size: number }> {
		const now = new Date();
		const storageKey = [
			String(now.getUTCFullYear()),
			String(now.getUTCMonth() + 1).padStart(2, "0"),
			LCrypt.randomBytes(24).toString("hex"),
		].join("/");

		const fullPath = this.resolveKey(storageKey);
		await fs_mkdir(path_dirname(fullPath), { recursive: true });
		const size = await Bun.write(fullPath, blob);

		return { storageKey, size };
	}

	static open(storageKey: string) {
		return Bun.file(this.resolveKey(storageKey));
	}

	static async remove(storageKeys: Iterable<string | null | undefined>) {
		for (const key of storageKeys) {
			if (!key) continue;
			try {
				await fs_rm(this.resolveKey(key), { force: true });
			} catch (error) {
				Logger.error(`Failed to delete stored file ${key}:`, error);
			}
		}
	}
}
