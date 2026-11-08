import { inArray } from "drizzle-orm";
import { z } from "zod";
import { DB } from "../../../db";
import type { DrizzleDB } from "../../../db/utils";
import { UserAccountSettings } from "./accountData";

/** The public face of a user inside the organisation (lists, assignees, chat senders). */
export namespace UserSummary {
	export const Schema = z.object({
		id: z.number(),
		username: z.string(),
		display_name: z.string(),
		email: z.string(),
		phone: z.string().nullable(),
		role: UserAccountSettings.Role,
	});
	export type Schema = z.infer<typeof Schema>;

	export function from(user: DB.Models.User): Schema {
		return {
			id: user.id,
			username: user.username,
			display_name: user.display_name,
			email: user.email,
			phone: user.phone,
			role: user.role,
		};
	}

	/** Load summaries for a set of ids in one query. Unknown ids are skipped. */
	export async function fetchMap(
		ids: Iterable<number | null | undefined>,
		tx: DrizzleDB = DB.instance(),
	): Promise<Map<number, Schema>> {
		const unique = [...new Set(ids)].filter((id): id is number => typeof id === "number");
		if (unique.length === 0) return new Map();

		const rows = await tx
			.select()
			.from(DB.Tables.users)
			.where(inArray(DB.Tables.users.id, unique))
			.all();

		return new Map(rows.map((row) => [row.id, from(row)]));
	}
}
