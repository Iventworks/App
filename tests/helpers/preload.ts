/// <reference types="bun-types" />

import { afterAll, beforeAll } from "bun:test";
import fs from "fs/promises";
import path from "path";
import { API } from "../../server/lib/api";
import { DB } from "../../server/lib/db";
import { OrgBootstrap } from "../../server/lib/orgs/bootstrap";
import { OrgContext } from "../../server/lib/orgs/context";
import { OrgService } from "../../server/lib/orgs/service";
import { ConfigHandler, type ENVConfigLike } from "../../server/lib/utils/config";
import { FileStorage } from "../../server/lib/utils/fileStorage";
import { findCrossOrgReferences } from "./crossOrg";
import { TEST_ORG_SLUG } from "./orgs";

function setTestEnv(rootDir: string) {
	const envVars = {
		IVENTWORKS_LOG_LEVEL: "debug",

		IVENTWORKS_API_DISABLE_DOCS: false,

		IVENTWORKS_DB_PATH: path.join(rootDir, "db.sqlite"),
		IVENTWORKS_DB_AUTO_MIGRATE: true,
		IVENTWORKS_DB_MIGRATION_DIR: "./drizzle/migrations",

		IVENTWORKS_LOG_DIR: path.join(rootDir, "logs"),
		IVENTWORKS_CONFIG_BASE_DIR: rootDir,

		IVENTWORKS_UPLOAD_DIR: path.join(rootDir, "uploads"),
		IVENTWORKS_MAX_UPLOAD_SIZE_MB: 5,
		IVENTWORKS_TRUST_PROXY: false,

		IVENTWORKS_APP_URL: "http://localhost:31316",
		// The tests run in multi-org mode: requests go to the "test" org (tests/helpers/orgs.ts),
		// and the cross-org tests add more orgs.
		IVENTWORKS_MULTI_ORG: true,
		// The default; tests that need org admins to activate domains themselves switch it on.
		IVENTWORKS_CUSTOM_DOMAINS_SELF_SERVICE: false,
		IVENTWORKS_TIMEZONE: "Europe/Berlin",

		IVENTWORKS_SMTP_HOST: "127.0.0.1",
		IVENTWORKS_SMTP_PORT: 12587,
		IVENTWORKS_SMTP_USERNAME: "",
		IVENTWORKS_SMTP_PASSWORD: "",
		IVENTWORKS_SMTP_FROM: '"App Test" <test@app.local>',
		IVENTWORKS_SMTP_SECURE: false,
	} as const satisfies ENVConfigLike;

	for (const [key, value] of Object.entries(envVars)) {
		process.env[key] = String(value);
	}
}

async function createIsolatedDataDir(): Promise<string> {
	const root = await fs.mkdtemp(path.join(process.cwd(), "tmp-data-"));
	return root;
}

async function runCommand(cmd: string[]) {
	const process = Bun.spawn({
		cmd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		process.stdout ? new Response(process.stdout).text() : Promise.resolve(""),
		process.stderr ? new Response(process.stderr).text() : Promise.resolve(""),
		process.exited,
	]);

	if (exitCode !== 0) {
		throw new Error(`Command failed: ${cmd.join(" ")}\n${stderr || stdout}`.trim());
	}
}

/**
 * On Windows, file handles (e.g. the SQLite DB file) can take a moment to be
 * released after closing, making an immediate recursive removal flaky (EBUSY).
 * Retries manually since Bun's `fs.rm` doesn't reliably honor `maxRetries`/`retryDelay`.
 */
async function removeDirWithRetry(dir: string, attempts = 10, delayMs = 300) {
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			await fs.rm(dir, { recursive: true, force: true });
			return;
		} catch (err: any) {
			if (
				attempt === attempts ||
				(err?.code !== "EBUSY" && err?.code !== "ENOTEMPTY" && err?.code !== "EPERM")
			) {
				console.error(`Failed to remove directory ${dir} on attempt ${attempt}:`, err);
			}
			await Bun.sleep(delayMs);
		}
	}
}

let TMP_ROOT: string | null = null;

beforeAll(async () => {
	TMP_ROOT = await createIsolatedDataDir();

	setTestEnv(TMP_ROOT);

	const config = await ConfigHandler.loadConfig();

	await DB.init(path.join(TMP_ROOT, "db.sqlite"), true, TMP_ROOT, "./drizzle/migrations");
	await OrgBootstrap.run(TMP_ROOT);

	// Seeding code outside requests works in the test org; requests resolve it from TEST_HOST.
	const testOrg = await OrgService.create({ slug: TEST_ORG_SLUG, display_name: "Test-Org" });
	OrgContext.useTestFallback(testOrg);

	await FileStorage.init(config.UPLOAD_DIR, config.MAX_UPLOAD_SIZE_MB);

	// EmailService is NOT initialised here — tests that need it call
	// EmailService.init(mockTransport) in their own beforeAll.

	await API.init([config.APP_URL], false);

	// await API.start(12521, "::");
});

afterAll(async () => {
	// Whatever the test file did: no row may point at a row of another org.
	const crossOrg = findCrossOrgReferences();

	await API.stop();

	await DB.close();

	if (TMP_ROOT) {
		await removeDirWithRetry(TMP_ROOT);
	}

	if (crossOrg.length) {
		throw new Error(`Cross-org references in the test DB: ${crossOrg.join("; ")}`);
	}
});
