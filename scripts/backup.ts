/**
 * Backups by hand — the same as the scheduled ones (server/lib/backup), using the app's env.
 *
 *   bun run backup create                      create a backup now
 *   bun run backup list                        local and S3 backups
 *   bun run backup verify <name|file>          decrypt and check a backup
 *   bun run backup restore <name|file> <dir>   decrypt and extract into an empty directory
 *
 * In the Docker image: `docker exec iventworks bun /opt/iventworks/app/.output/backup.mjs list`.
 * Needs IVENTWORKS_BACKUP_PASSPHRASE (and the S3 settings for backups that only live in S3).
 */
import { join } from "node:path";
import { BackupService, formatBytes } from "../server/lib/backup/service";
import { ConfigHandler } from "../server/lib/utils/config";
import { AppConstants } from "../server/lib/utils/constants";

const USAGE = `Usage:
  backup create
  backup list
  backup verify <name|file>
  backup restore <name|file> <target-dir>`;

const [command, ...args] = process.argv.slice(2);

const config = await ConfigHandler.loadConfig();
const settings = BackupService.settings(config);
const workDir = join(settings.dir, `.cli-${Date.now()}`);

function requirePassphrase(): string {
	if (!settings.passphrase) {
		console.error(`Set ${AppConstants.APP_ENV_PREFIX}_BACKUP_PASSPHRASE first.`);
		process.exit(1);
	}
	return settings.passphrase;
}

function printBackups(label: string, backups: { name: string; size: number }[]) {
	console.log(`${label}:`);
	if (backups.length === 0) console.log("  (none)");
	for (const backup of backups) console.log(`  ${backup.name}  ${formatBytes(backup.size)}`);
}

try {
	switch (command) {
		case "create": {
			const problems = BackupService.validate({ ...config, BACKUP_ENABLED: true });
			if (problems.length) throw new Error(problems.join("\n"));
			const backup = await BackupService.create(settings);
			console.log(`Created ${backup.name} (${formatBytes(backup.size)}).`);
			break;
		}
		case "list": {
			const { local, s3 } = await BackupService.list(settings);
			printBackups(`Local (${settings.dir})`, local);
			if (s3) printBackups(settings.s3!.label, s3);
			break;
		}
		case "verify": {
			if (!args[0]) throw new Error(USAGE);
			const passphrase = requirePassphrase();
			const source = await BackupService.fetch(settings, args[0], workDir);
			try {
				const result = await BackupService.verify(source.path, passphrase, workDir);
				console.log(`OK: ${result.files} files, created ${result.manifest?.created_at ?? "?"}.`);
			} finally {
				await source.cleanup();
			}
			break;
		}
		case "restore": {
			if (!args[0] || !args[1]) throw new Error(USAGE);
			const passphrase = requirePassphrase();
			const source = await BackupService.fetch(settings, args[0], workDir);
			try {
				const result = await BackupService.restore(source.path, passphrase, args[1], workDir);
				console.log(
					`Restored ${result.files} files into ${args[1]} (backup of ${result.manifest?.created_at ?? "?"}).`,
				);
				console.log(
					[
						"To use it:",
						"  1. Stop the app.",
						`  2. Replace ${config.DB_PATH} with db.sqlite from the restore and delete ${config.DB_PATH}-wal and -shm.`,
						`  3. Replace ${config.UPLOAD_DIR} with the restored uploads/ directory.`,
						"  4. Start the app.",
					].join("\n"),
				);
			} finally {
				await source.cleanup();
			}
			break;
		}
		default:
			console.log(USAGE);
			process.exit(command ? 1 : 0);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	const { rm } = await import("node:fs/promises");
	await rm(workDir, { recursive: true, force: true });
}
