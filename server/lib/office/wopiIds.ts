import { createHash } from "node:crypto";
import type { DB } from "../db";
import { OrgContext } from "../orgs/context";

/**
 * A file's id towards the office server (the last segment of WOPISrc). The office server keeps an
 * open document under this id alone — not under the whole WOPISrc — so a bare file id would mix up
 * documents of installations sharing one office server, of a staging copy restored from a backup,
 * or of a database that was reset. The suffix ties it to the org's address and the file's
 * creation: `<file id>-<16 hex>`.
 */
export namespace WopiIds {
	const PATTERN = /^(\d+)-([0-9a-f]{16})$/;

	/** `orgUrl`: the org's address the id is handed out on (default: its current one). */
	export function of(
		file: Pick<DB.Models.File, "id" | "created_at">,
		orgUrl = OrgContext.current().url,
	) {
		const suffix = createHash("sha256")
			.update(`${orgUrl}\n${file.id}\n${file.created_at}`)
			.digest("hex")
			.slice(0, 16);
		return `${file.id}-${suffix}`;
	}

	/** The file id in a WOPI id, or null (check the whole id with `matches` once the file is loaded). */
	export function parse(wopiId: string): number | null {
		const match = PATTERN.exec(wopiId);
		return match ? Number(match[1]) : null;
	}

	/**
	 * `orgUrl`: the address the office server called — the one the id was handed out on, which
	 * may no longer be the org's primary one (a custom domain went live meanwhile).
	 */
	export function matches(
		wopiId: string,
		file: Pick<DB.Models.File, "id" | "created_at">,
		orgUrl: string,
	) {
		return wopiId === of(file, orgUrl);
	}
}
