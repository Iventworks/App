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
	 * is taken (`max.mueller2`). Null when the name gives no valid username at all.
	 *
	 * Synchronous on purpose: callers store the account right after it, without an `await` in
	 * between, so no other request can take the same name meanwhile (that would hit the unique
	 * index and end in a 500).
	 */
	export function assign(
		schema: string,
		firstName: string,
		lastName: string,
		tx: DrizzleDB.Sync = DB.instance(),
	): string | null {
		const base = UsernameSchema.generate(schema, firstName, lastName);
		if (!base) return null;

		// Long bases are shortened to fit the number, so match on a prefix every candidate shares.
		// `_` in it is a LIKE wildcard: that only widens the match, the check below is exact.
		const prefix = base.slice(0, UsernameSchema.MAX_LENGTH - 4);
		const taken = new Set(
			tx
				.select({ username: DB.Tables.users.username })
				.from(DB.Tables.users)
				.where(and(inOrg(DB.Tables.users), like(DB.Tables.users.username, `${prefix}%`)))
				.all()
				.map((row) => row.username),
		);

		for (let attempt = 0; attempt < 1000; attempt++) {
			const username = UsernameSchema.candidate(base, attempt);
			if (username && !taken.has(username)) return username;
		}
		return null;
	}

	export type Resolved =
		| { username: string }
		| { error: "names_required" | "username_required" | "no_username" };

	/** The API's message for each `resolve` error (status 400). */
	export const RESOLVE_ERRORS = {
		names_required: "First and last name are required",
		username_required: "A username is required",
		no_username: "The name gives no valid username",
	} as const satisfies Record<Exclude<Resolved, { username: string }>["error"], string>;

	/**
	 * The username a new account gets under the current policy: built from the name under a schema
	 * (`assign`), otherwise the `requested` one — in free mode, and under a schema when the name is
	 * written in a script the schema can't spell (`UsernameSchema.needsChosenUsername`). Not checked
	 * for uniqueness when requested. Synchronous like `assign`.
	 */
	export function resolve(
		input: { firstName?: string; lastName?: string; requested?: string },
		tx: DrizzleDB.Sync = DB.instance(),
	): Resolved {
		const schema = enforcedSchema();
		const requested = input.requested
			? { username: input.requested }
			: { error: "username_required" as const };
		if (!schema) return requested;

		const { firstName, lastName } = input;
		if (!firstName || !lastName) return { error: "names_required" };
		if (UsernameSchema.needsChosenUsername(schema, firstName, lastName)) return requested;

		const username = assign(schema, firstName, lastName, tx);
		return username ? { username } : { error: "no_username" };
	}
}
