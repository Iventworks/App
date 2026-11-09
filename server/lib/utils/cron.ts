import type { CronJob as BunCronJob } from "bun";
import { DomainService } from "../orgs/domains";
import { OrgRegistry } from "../orgs/registry";
import { Housekeeping } from "./housekeeping";
import { Logger } from "./logger";

class CronJob {
	private _job: BunCronJob | null = null;

	constructor(
		private readonly cronExpression: string,
		private readonly callback: () => Promise<void>,
	) {}

	start() {
		// A rejected Bun.cron callback ends the process, so a failing run is logged instead.
		this._job = Bun.cron(this.cronExpression, async () => {
			try {
				await this.callback();
			} catch (err) {
				Logger.error(`Cron job "${this.cronExpression}" failed:`, err);
			}
		});
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
