import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { open } from "node:fs/promises";

/**
 * Encrypted backup files (format 1):
 *
 *     "IVWBKP" | version 0x01 | kdf 0x01 (scrypt) | salt (16) | iv (12) | ciphertext | GCM tag (16)
 *
 * AES-256-GCM with a key derived from the passphrase by scrypt (N = 2^15, r = 8, p = 1) and a
 * fresh salt and IV per backup. The tag sits at the end so the file can be written in one pass.
 * Like LeiCraft_MC Vault's backups, but with a memory-hard KDF.
 */
export namespace BackupCrypto {
	const MAGIC = new TextEncoder().encode("IVWBKP");
	const VERSION = 1;
	const KDF_SCRYPT = 1;
	const SALT_BYTES = 16;
	const IV_BYTES = 12;
	const TAG_BYTES = 16;
	export const HEADER_BYTES = MAGIC.length + 2 + SALT_BYTES + IV_BYTES;

	const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

	export class DecryptionError extends Error {
		constructor(message: string) {
			super(message);
			this.name = "DecryptionError";
		}
	}

	function deriveKey(passphrase: string, salt: Uint8Array): Promise<Buffer> {
		return new Promise((resolve, reject) =>
			scrypt(passphrase, salt, 32, SCRYPT, (error, key) => (error ? reject(error) : resolve(key))),
		);
	}

	/** Encrypt a stream of plaintext chunks into the backup file format. */
	export async function* encrypt(source: AsyncIterable<Uint8Array>, passphrase: string) {
		const salt = randomBytes(SALT_BYTES);
		const iv = randomBytes(IV_BYTES);
		const cipher = createCipheriv("aes-256-gcm", await deriveKey(passphrase, salt), iv);

		yield new Uint8Array([...MAGIC, VERSION, KDF_SCRYPT, ...salt, ...iv]);
		for await (const chunk of source) {
			const encrypted = cipher.update(chunk);
			if (encrypted.length) yield new Uint8Array(encrypted);
		}
		const last = cipher.final();
		if (last.length) yield new Uint8Array(last);
		yield new Uint8Array(cipher.getAuthTag());
	}

	/**
	 * Decrypt a backup file as a stream. The data is only authentic once the stream ended without
	 * an error (the GCM tag is checked last) — write it somewhere temporary before trusting it.
	 */
	export async function* decryptFile(path: string, passphrase: string) {
		const size = Bun.file(path).size;
		if (size < HEADER_BYTES + TAG_BYTES)
			throw new DecryptionError("Not an Iventworks backup (too short)");

		const handle = await open(path, "r");
		let header: Buffer;
		let tag: Buffer;
		try {
			header = Buffer.alloc(HEADER_BYTES);
			tag = Buffer.alloc(TAG_BYTES);
			await handle.read(header, 0, HEADER_BYTES, 0);
			await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
		} finally {
			await handle.close();
		}

		if (!MAGIC.every((byte, i) => header[i] === byte)) {
			throw new DecryptionError("Not an Iventworks backup");
		}
		if (header[MAGIC.length] !== VERSION || header[MAGIC.length + 1] !== KDF_SCRYPT) {
			throw new DecryptionError(`Unsupported backup format version ${header[MAGIC.length]}`);
		}
		const salt = header.subarray(MAGIC.length + 2, MAGIC.length + 2 + SALT_BYTES);
		const iv = header.subarray(MAGIC.length + 2 + SALT_BYTES, HEADER_BYTES);

		const decipher = createDecipheriv("aes-256-gcm", await deriveKey(passphrase, salt), iv);
		decipher.setAuthTag(tag);

		const body = Bun.file(path).slice(HEADER_BYTES, size - TAG_BYTES);
		for await (const chunk of body.stream()) {
			const plain = decipher.update(chunk);
			if (plain.length) yield new Uint8Array(plain);
		}
		try {
			const last = decipher.final();
			if (last.length) yield new Uint8Array(last);
		} catch {
			throw new DecryptionError("Wrong passphrase, or the backup file is damaged");
		}
	}
}
