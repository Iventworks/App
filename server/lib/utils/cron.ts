import type { CronJob as BunCronJob } from "bun";
import { BackupService } from "../backup/service";
import { DomainService } from "../orgs/domains";
import { OrgRegistry } from "../orgs/registry";
import { ConfigHandler } from "./config";
import { Housekeeping } from "./housekeeping";
import { Logger } from "./logger";

class CronJob {
	private _job: BunCronJob | null = null;

	constructor(
		private readonly cronExpression: string,
		private readonly callback: () => Promise<void>,
		/** IANA time zone the expression is meant in (default: the server's). */
		private readonly timezone?: string,
	) {}

	start() {
		// A rejected Bun.cron callback ends the process, so a failing run is logged instead.
		this._job = Bun.cron(
			this.cronExpression,
			async () => {
				try {
					await this.callback();
				} catch (err) {
					Logger.error(`Cron job "${this.cronExpression}" failed:`, err);
				}
			},
			this.timezone ? { tz: this.timezone } : undefined,
		);
	}

	async stop() {
		if (this._job) {
			await this._job.stop();
		}
	}
}

export class CronJobHandler {
	private static jobs: CronJob[] = [];
	private static initialized: boolean = false;

	static async init() {
		if (this.initialized) return;
		this.initialized = true;

		this.jobs.push(
			// Nightly at 03:30: drop expired sessions, reset links, invitations and old notifications.
			new CronJob("30 3 * * *", async () => {
				await Housekeeping.run();
			}),
			// Multi-org mode: check pending custom domains, so nobody has to click "Prüfen" after
			// the DNS records propagated.
			new CronJob("*/15 * * * *", async () => {
				if (!OrgRegistry.isMultiOrg()) return;
				const verified = await DomainService.verifyPending();
				if (verified) Logger.info(`Verified ${verified} custom domain(s).`);
			}),
		);

		// Encrypted backups on IVENTWORKS_BACKUP_SCHEDULE, in the org's time zone.
		const config = ConfigHandler.getConfig();
		if (config?.BACKUP_ENABLED) {
			const settings = BackupService.settings(config);
			this.jobs.push(
				new CronJob(settings.schedule, () => BackupService.runScheduled(settings), settings.timezone),
			);
			Logger.info(
				`Backups scheduled: "${settings.schedule}" (${settings.timezone}) to ${settings.dir}${settings.s3 ? ` and ${settings.s3.label}` : ""}.`,
			);
		}
	}

	static async startAll() {
		if (!this.initialized) {
			await this.init();
		}
		for (const job of this.jobs) {
			job.start();
		}
	}

	static async stopAll() {
		for (const job of this.jobs) {
			await job.stop();
		}
	}
}
