import { type entityKind, sql } from "drizzle-orm";
import type { drizzle as drizzle_bun } from "drizzle-orm/bun-sqlite";
import type { drizzle as drizzle_d1 } from "drizzle-orm/d1";
import { BaseSQLiteDatabase, integer } from "drizzle-orm/sqlite-core";

export declare class DrizzleDB extends BaseSQLiteDatabase<
	"async" | "sync",
	void,
	Record<string, unknown>
> {
	static readonly [entityKind]: string;
	$client?: any;
	batch?: any;
}

export namespace DrizzleDB {
	export type BunSQLite = ReturnType<typeof drizzle_bun>;
	export type D1 = ReturnType<typeof drizzle_d1>;
}

export class SQLUtils {
	/**
	 * `created_at` column: unix-epoch milliseconds, non-null, defaulted to now. The SQL default only
	 * has second precision (and Drizzle prefers it over `$defaultFn`): set the value explicitly
	 * (`Date.now()`) where millisecond ordering matters, e.g. chat messages vs. read markers.
	 */
	static getCreatedAtColumn(name: string = "created_at") {
		return integer(name, { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`);
	}

	/** Auto-incrementing integer primary key. */
	static primaryKeyIntAutoIncrement(name: string = "id") {
		return integer(name).primaryKey({ autoIncrement: true });
	}
}
