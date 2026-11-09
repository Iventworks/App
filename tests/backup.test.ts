import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { BackupCrypto } from "../server/lib/backup/crypto";
import { BackupService, type BackupSettings } from "../server/lib/backup/service";
import { extractTar, tarStream } from "../server/lib/backup/tar";
import {
	type BackupTarget,
	backupName,
	backupTime,
	type StoredBackup,
} from "../server/lib/backup/targets";
import { ConfigHandler, type ParsedConfig } from "../server/lib/utils/config";
import { RequestLimits } from "../server/lib/utils/requestLimits";
import { SecurityHeaders } from "../server/lib/utils/securityHeaders";
import { testOrg } from "./helpers/orgs";

const PASSPHRASE = "correct horse battery staple";
let tmp: string;

async function collect(source: AsyncIterable<Uint8Array>) {
	const parts: Uint8Array[] = [];
	for await (const part of source) parts.push(part);
	return Buffer.concat(parts);
}

/** An S3 stand-in that keeps the uploaded files in memory. */
class FakeTarget implements BackupTarget {
	readonly label = "fake-s3";
	readonly files = new Map<string, Uint8Array>();
	async list(): Promise<StoredBackup[]> {
		return [...this.files.entries()]
			.map(([name, data]) => ({ name, size: data.length, created_at: backupTime(name) ?? 0 }))
			.sort((a, b) => b.created_at - a.created_at);
	}
	async put(name: string, path: string) {
		this.files.set(name, new Uint8Array(await readFile(path)));
	}
	async download(name: string, path: string) {
		await writeFile(path, this.files.get(name)!);
	}
	async remove(name: string) {
		this.files.delete(name);
	}
}

function settings(overrides: Partial<BackupSettings> = {}): BackupSettings {
	const config = ConfigHandler.getConfig()!;
	return {
		...BackupService.settings(config),
		passphrase: PASSPHRASE,
		dir: join(tmp, "backups"),
		...overrides,
	};
}

beforeAll(async () => {
	tmp = await mkdtemp(join(process.cwd(), "tmp-backup-"));
});

afterAll(async () => {
	await rm(tmp, { recursive: true, force: true });
});

describe("tar", () => {
	test("round trip with files from memory and disk, long names", async () => {
		const onDisk = join(tmp, "big.bin");
		const big = new Uint8Array(1_500_000).map((_, i) => i % 251);
		await writeFile(onDisk, big);
		const longName = `uploads/${"a".repeat(80)}/${"b".repeat(90)}.pdf`;

		const target = join(tmp, "tar-out");
		const { names, captured } = await extractTar(
			tarStream([
				{ name: "manifest.json", data: new TextEncoder().encode('{"ok":true}') },
				{ name: "uploads/2026/x.bin", path: onDisk, size: big.length },
				{ name: longName, data: new Uint8Array([1, 2, 3]) },
				{ name: "empty.txt", data: new Uint8Array(0) },
			]),
			target,
			["manifest.json"],
		);

		expect(names).toEqual(["manifest.json", "uploads/2026/x.bin", longName, "empty.txt"]);
		expect(new TextDecoder().decode(captured.get("manifest.json"))).toBe('{"ok":true}');
		expect(Buffer.compare(await readFile(join(target, "uploads/2026/x.bin")), Buffer.from(big))).toBe(
			0,
		);
		expect([...(await readFile(join(target, longName)))]).toEqual([1, 2, 3]);
		expect((await readFile(join(target, "empty.txt"))).length).toBe(0);
	});

	test("refuses paths that leave the target directory", async () => {
		for (const name of ["../evil.txt", "a/../../evil.txt"]) {
			await expect(
				extractTar(tarStream([{ name, data: new Uint8Array([1]) }]), join(tmp, "traversal")),
			).rejects.toThrow(/unsafe path/);
		}
		expect(existsSync(join(tmp, "evil.txt"))).toBe(false);
	});

	test("a truncated archive is an error", async () => {
		const full = await collect(tarStream([{ name: "a.txt", data: new Uint8Array(2000) }]));
		await expect(extractTar(Readable.from([full.subarray(0, 1200)]), null)).rejects.toThrow();
	});
});

describe("encryption", () => {
	test("round trip, and the passphrase and every byte matter", async () => {
		const plain = new TextEncoder().encode("Teilnehmende mit Allergien: …".repeat(1000));
		const file = join(tmp, "enc.backup");
		await writeFile(file, await collect(BackupCrypto.encrypt(Readable.from([plain]), PASSPHRASE)));

		expect(
			Buffer.compare(await collect(BackupCrypto.decryptFile(file, PASSPHRASE)), Buffer.from(plain)),
		).toBe(0);
		await expect(collect(BackupCrypto.decryptFile(file, "wrong passphrase!!"))).rejects.toThrow(
			BackupCrypto.DecryptionError,
		);

		const bytes = await readFile(file);
		bytes[BackupCrypto.HEADER_BYTES + 10]! ^= 0xff;
		await writeFile(file, bytes);
		await expect(collect(BackupCrypto.decryptFile(file, PASSPHRASE))).rejects.toThrow(/damaged/);
	});

	test("the plaintext doesn't appear in the file and two backups differ", async () => {
		const plain = new TextEncoder().encode("GEHEIM-1234".repeat(100));
		const a = await collect(BackupCrypto.encrypt(Readable.from([plain]), PASSPHRASE));
		const b = await collect(BackupCrypto.encrypt(Readable.from([plain]), PASSPHRASE));
		expect(a.includes(Buffer.from("GEHEIM"))).toBe(false);
		expect(Buffer.compare(a, b)).not.toBe(0);
	});

	test("other files are rejected", async () => {
		const file = join(tmp, "not-a-backup");
		await writeFile(file, "x".repeat(100));
		await expect(collect(BackupCrypto.decryptFile(file, PASSPHRASE))).rejects.toThrow(
			/Not an Iventworks backup/,
		);
	});
});

describe("BackupService", () => {
	test("backs up the database and uploads; verify and restore give them back", async () => {
		const config = ConfigHandler.getConfig()!;
		await mkdir(join(config.UPLOAD_DIR, "2026"), { recursive: true });
		await writeFile(join(config.UPLOAD_DIR, "2026", "beleg.pdf"), "%PDF-1.4 Beleg");

		const backup = await BackupService.create(settings());
		expect(backup.name).toMatch(/^iventworks-\d{8}-\d{6}\.backup$/);
		const file = join(tmp, "backups", backup.name);
		expect(existsSync(file)).toBe(true);
		expect((await readFile(file)).includes(Buffer.from("%PDF-1.4 Beleg"))).toBe(false);

		const verified = await BackupService.verify(file, PASSPHRASE, join(tmp, "work"));
		expect(verified.files).toBeGreaterThanOrEqual(3);
		expect(verified.manifest?.uploads.files).toBeGreaterThanOrEqual(1);

		const target = join(tmp, "restored");
		await BackupService.restore(file, PASSPHRASE, target, join(tmp, "work"));
		expect(await readFile(join(target, "uploads", "2026", "beleg.pdf"), "utf8")).toBe(
			"%PDF-1.4 Beleg",
		);
		const db = new Database(join(target, "db.sqlite"), { readonly: true });
		try {
			const org = db.query("select slug from orgs where id = ?").get(testOrg().id) as { slug: string };
			expect(org.slug).toBe("test");
		} finally {
			db.close();
		}

		await expect(BackupService.restore(file, PASSPHRASE, target, join(tmp, "work"))).rejects.toThrow(
			/not empty/,
		);
		await expect(
			BackupService.verify(file, "another passphrase", join(tmp, "work")),
		).rejects.toThrow();
	});

	test("with S3: uploaded off-site, only the newest local copies stay", async () => {
		const s3 = new FakeTarget();
		const dir = join(tmp, "backups-s3");
		const first = await BackupService.create(settings({ s3, dir, localCopies: 1 }));
		await Bun.sleep(1100); // names have second precision
		const second = await BackupService.create(settings({ s3, dir, localCopies: 1 }));

		expect([...s3.files.keys()].sort()).toEqual([first.name, second.name].sort());
		const local = await BackupService.list(settings({ s3, dir }));
		expect(local.local.map((b) => b.name)).toEqual([second.name]);

		// A backup that only exists in S3 can still be restored.
		const fetched = await BackupService.fetch(
			settings({ s3, dir }),
			first.name,
			join(tmp, "work-s3"),
		);
		const restored = await BackupService.verify(fetched.path, PASSPHRASE, join(tmp, "work-s3"));
		expect(restored.files).toBeGreaterThan(0);
		await fetched.cleanup();
	});

	test("localCopies 0 keeps nothing locally", async () => {
		const s3 = new FakeTarget();
		const dir = join(tmp, "backups-none");
		await BackupService.create(settings({ s3, dir, localCopies: 0 }));
		expect((await BackupService.list(settings({ s3, dir }))).local).toEqual([]);
		expect(s3.files.size).toBe(1);
	});

	test("retention: older than the limit goes, the newest few always stay", () => {
		const now = Date.UTC(2026, 10, 9);
		const day = 24 * 60 * 60 * 1000;
		const backups = [1, 5, 40, 60, 90].map((age) => {
			const time = new Date(now - age * day);
			return { name: backupName(time), size: 1, created_at: time.getTime() };
		});
		const decision = BackupService.decideRetention(backups, 30, 3, now);
		expect(decision.keep.length).toBe(3);
		expect(decision.remove.map((b) => Math.round((now - b.created_at) / day))).toEqual([60, 90]);

		expect(BackupService.decideRetention(backups, 30, 1, now).keep.length).toBe(2);
		expect(BackupService.decideRetention(backups, 0, 1, now).remove).toEqual([]);
		expect(BackupService.decideRetention(backups.slice(3), 30, 3, now).remove).toEqual([]);
	});

	test("names encode the UTC time", () => {
		const time = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
		expect(backupName(time)).toBe("iventworks-20260102-030405.backup");
		expect(backupTime(backupName(time))).toBe(time.getTime());
		expect(backupTime("something-else.backup")).toBeNull();
	});

	test("configuration is checked", () => {
		const base = ConfigHandler.getConfig()!;
		const check = (changes: Partial<ParsedConfig>) =>
			BackupService.validate({ ...base, ...changes } as ParsedConfig);

		expect(check({ BACKUP_ENABLED: false })).toEqual([]);
		expect(check({ BACKUP_ENABLED: true, BACKUP_PASSPHRASE: undefined })[0]).toContain("PASSPHRASE");
		expect(check({ BACKUP_ENABLED: true, BACKUP_PASSPHRASE: "short" })[0]).toContain("16");
		expect(check({ BACKUP_ENABLED: true, BACKUP_PASSPHRASE: PASSPHRASE })).toEqual([]);
		expect(
			check({ BACKUP_ENABLED: true, BACKUP_PASSPHRASE: PASSPHRASE, BACKUP_SCHEDULE: "not cron" })[0],
		).toContain("SCHEDULE");
		expect(
			check({ BACKUP_S3_ENDPOINT: "https://s3.example.com", BACKUP_S3_BUCKET: "b" })[0],
		).toContain("IVENTWORKS_BACKUP_S3_ACCESS_KEY_ID");
	});
});

describe("Request limits", () => {
	const MB = 1024 * 1024;

	test("uploads follow IVENTWORKS_MAX_UPLOAD_SIZE_MB, everything else is small", () => {
		const upload = RequestLimits.uploadBytes({ IVENTWORKS_MAX_UPLOAD_SIZE_MB: "200" });
		expect(upload).toBe(201 * MB);
		expect(RequestLimits.uploadBytes({ CMP_MAX_UPLOAD_SIZE_MB: "10" })).toBe(11 * MB);
		expect(RequestLimits.uploadBytes({})).toBe(26 * MB);

		const multipart = new Headers({ "content-type": "multipart/form-data; boundary=x" });
		const json = new Headers({ "content-type": "application/json" });
		expect(RequestLimits.limitFor(multipart, upload)).toBe(upload);
		expect(RequestLimits.limitFor(json, upload)).toBe(RequestLimits.DEFAULT_BYTES);
	});

	test("a declared Content-Length over the limit is refused before reading", async () => {
		const request = new Request("http://x/", {
			method: "POST",
			body: "x".repeat(100),
			headers: { "content-length": "100" },
		});
		expect(await RequestLimits.readBody(request, 50)).toBeNull();
	});

	test("a chunked body is cut off at the limit", async () => {
		const stream = new ReadableStream({
			start(controller) {
				for (let i = 0; i < 10; i++) controller.enqueue(new Uint8Array(1024));
				controller.close();
			},
		});
		const request = new Request("http://x/", { method: "POST", body: stream });
		expect(await RequestLimits.readBody(request, 5000)).toBeNull();

		const small = new Request("http://x/", {
			method: "POST",
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(new Uint8Array(100));
					controller.close();
				},
			}),
		});
		expect((await RequestLimits.readBody(small, 5000))?.byteLength).toBe(100);
	});
});

describe("Security headers", () => {
	test("the page policy allows exactly the page's inline scripts", () => {
		const html =
			'<script>window.__NUXT__={}</script><script type="module" src="/_nuxt/a.js"></script><script type="application/json">{}</script>';
		const csp = SecurityHeaders.pageCsp(html, true);
		const hashes = SecurityHeaders.inlineScriptHashes(html);
		expect(hashes.length).toBe(2);
		for (const hash of hashes) expect(csp).toContain(`'sha256-${hash}'`);
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).toContain("object-src 'none'");
		expect(csp).toContain("upgrade-insecure-requests");
		expect(csp).not.toContain("unsafe-eval");
		expect(SecurityHeaders.pageCsp(html, false)).not.toContain("upgrade-insecure-requests");
	});

	test("HSTS only over https", () => {
		expect(SecurityHeaders.base(true)["Strict-Transport-Security"]).toContain("max-age=");
		expect(SecurityHeaders.base(false)["Strict-Transport-Security"]).toBeUndefined();
	});
});
