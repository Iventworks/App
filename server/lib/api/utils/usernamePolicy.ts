import { and, like } from "drizzle-orm";
import { DB } from "../../db";
import type { DrizzleDB } from "../../db/utils";
import { inOrg, OrgContext } from "../../orgs/context";
import type { UsernameMode } from "../../orgs/registry";
import { UsernameSchema } from "../../utils/usernameSchema";

/**
 * How new accounts of the current org get their username: by the org's schema from first and last
 * name, or chosen freely (invitee / admin). Only applies when an account is created — existing
 * usernames are never rewritten. The system org (system admins) always chooses freely: it has no
 * settings page.
 */
export namespace UsernamePolicy {
	export interface Policy {
		mode: UsernameMode;
		/** The org's schema; also set in `free` mode, so switching back keeps it. */
		schema: string;
	}

	export function current(): Policy {
		const org = OrgContext.current();
		if (org.kind === "system") return { mode: "free", schema: org.username_schema };
		return { mode: org.username_mode, schema: org.username_schema };
	}

	/** The schema new accounts follow right now, or null when usernames are chosen freely. */
	export function enforcedSchema(): string | null {
		const policy = current();
		return policy.mode === "schema" ? policy.schema : null;
	}

	/**
	 * The username for a name under `schema`: the generated one, or with a number appended when it
	 * is taken (`max.mueller2`). Null when the name gives no valid username at all. The unique index
	 * still guards against two requests picking the same name at once.
	 */
	export async function assign(
		schema: string,
		firstName: string,
		lastName: string,
		tx: DrizzleDB = DB.instance(),
	): Promise<string | null> {
		const base = UsernameSchema.generate(schema, firstName, lastName);
		if (!base) return null;

		// Long bases are shortened to fit the number, so match on a prefix every candidate shares.
		// `_` in it is a LIKE wildcard: that only widens the match, the check below is exact.
		const prefix = base.slice(0, UsernameSchema.MAX_LENGTH - 4);
		const taken = new Set(
			(
				await tx
					.select({ username: DB.Tables.users.username })
					.from(DB.Tables.users)
					.where(and(inOrg(DB.Tables.users), like(DB.Tables.users.username, `${prefix}%`)))
					.all()
			).map((row) => row.username),
		);

		for (let attempt = 0; attempt < 1000; attempt++) {
			const username = UsernameSchema.candidate(base, attempt);
			if (username && !taken.has(username)) return username;
		}
		return null;
	}
}
