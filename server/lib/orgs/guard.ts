import type { Database, Statement } from "bun:sqlite";
import { OrgContext } from "./context";

export class TenantGuardError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TenantGuardError";
	}
}

interface Analysis {
	/** Placeholder positions whose bound value must be the current org's id. */
	readonly orgParams: readonly number[];
}

// `from "t"`, `join "t" "alias"`, `update "t"`, `insert into "t"` (Drizzle quotes every identifier).
const TABLE_REF = /\b(from|join|update|into)\s+"(\w+)"(?:\s+(?:as\s+)?"(\w+)")?/gi;
// `"a"."org_id" = "b"."org_id"`: a join on the org columns links two tables.
const ORG_COLUMN_LINK = /"(\w+)"\."org_id" = "(\w+)"\."org_id"/g;

const MAX_CACHED_ANALYSES = 5000;

/**
 * Tenant guard: every statement the app prepares on an org-owned table must carry an org filter,
 * and that filter must be bound to the org of the current {@link OrgContext}.
 *
 * - `select` / `update` / `delete`: each org table (or its alias) needs `"<t>"."org_id" = ?`, or a
 *   join `"<t>"."org_id" = "<u>"."org_id"` to a table that has one.
 * - `insert`: the column list must include `org_id`, bound as a parameter.
 * - When the statement runs, every one of those parameters must equal `OrgContext.id()`.
 *
 * A violation throws {@link TenantGuardError} — the request fails with a 500 instead of reading or
 * writing another org's rows. `OrgContext.unscoped(...)` switches the guard off for system code.
 * Drizzle renders every column qualified (`"events"."org_id"`), which is what makes this check
 * reliable; hand-written SQL has to follow the same shape.
 */
export class TenantGuard {
	private static readonly cache = new Map<string, Analysis>();

	/** Patch `client.prepare` so every statement is checked. Call once per connection. */
	static install(client: Database, orgTables: ReadonlySet<string>) {
		const prepare = client.prepare.bind(client) as Database["prepare"];

		(client as { prepare: Database["prepare"] }).prepare = ((sql: string, ...rest: unknown[]) => {
			const statement = (prepare as (...args: unknown[]) => Statement)(sql, ...rest);
			if (OrgContext.isUnscoped()) return statement;

			const analysis = TenantGuard.analyze(sql, orgTables);
			if (analysis.orgParams.length === 0) return statement;
			return TenantGuard.bindCheck(statement, sql, analysis.orgParams);
		}) as Database["prepare"];
	}

	/** Check one statement's shape; throws {@link TenantGuardError}. Exposed for the tests. */
	static analyze(sql: string, orgTables: ReadonlySet<string>): Analysis {
		const cached = TenantGuard.cache.get(sql);
		if (cached) return cached;

		const orgParams = new Set<number>();
		const anchored = new Set<string>();
		const needed: { name: string; table: string }[] = [];

		for (const match of sql.matchAll(TABLE_REF)) {
			const verb = match[1]!.toLowerCase();
			const table = match[2]!;
			if (!orgTables.has(table)) continue;

			if (verb === "into") {
				for (const index of TenantGuard.insertOrgParams(sql, match.index + match[0].length, table)) {
					orgParams.add(index);
				}
				continue;
			}

			// `from "events" where …` has no alias; the regex only takes a quoted identifier as one.
			const name = match[3] ?? table;
			needed.push({ name, table });

			const column = `"${name}"."org_id" = ?`;
			for (let at = sql.indexOf(column); at !== -1; at = sql.indexOf(column, at + 1)) {
				anchored.add(name);
				orgParams.add(TenantGuard.placeholdersBefore(sql, at + column.length - 1));
			}
		}

		// Tables joined on their org columns inherit the anchor of the other side.
		const links = [...sql.matchAll(ORG_COLUMN_LINK)].map((m) => [m[1]!, m[2]!] as const);
		for (let changed = true; changed; ) {
			changed = false;
			for (const [a, b] of links) {
				if (anchored.has(a) !== anchored.has(b)) {
					anchored.add(a);
					anchored.add(b);
					changed = true;
				}
			}
		}

		const missing = needed.find(({ name }) => !anchored.has(name));
		if (missing) {
			throw new TenantGuardError(
				`Statement on org table "${missing.table}" without an org filter: ${sql}`,
			);
		}

		const analysis: Analysis = { orgParams: [...orgParams] };
		if (TenantGuard.cache.size >= MAX_CACHED_ANALYSES) TenantGuard.cache.clear();
		TenantGuard.cache.set(sql, analysis);
		return analysis;
	}

	/** Placeholder indexes of `org_id` in `insert into "t" (…) values (…), (…)`. */
	private static insertOrgParams(sql: string, from: number, table: string): number[] {
		const columnsStart = sql.indexOf("(", from);
		const columnsEnd = sql.indexOf(")", columnsStart);
		if (columnsStart === -1 || columnsEnd === -1 || sql.slice(from, columnsStart).trim() !== "") {
			throw new TenantGuardError(`Insert into org table "${table}" without a column list: ${sql}`);
		}

		const columns = sql
			.slice(columnsStart + 1, columnsEnd)
			.split(",")
			.map((column) => column.trim());
		const orgColumn = columns.indexOf('"org_id"');
		if (orgColumn === -1) {
			throw new TenantGuardError(`Insert into org table "${table}" without org_id: ${sql}`);
		}

		let at = columnsEnd + 1;
		while (sql[at] === " ") at++;
		// `insert … select …`: the select's own tables are checked as references.
		if (!sql.startsWith("values", at)) return [];
		at += "values".length;

		const params: number[] = [];
		for (;;) {
			while (sql[at] === " " || sql[at] === ",") at++;
			if (sql[at] !== "(") break;

			const items = TenantGuard.tupleItems(sql, at);
			const item = items.positions[orgColumn];
			if (item === undefined || sql[item] !== "?" || items.texts[orgColumn] !== "?") {
				throw new TenantGuardError(`Insert into "${table}" must bind org_id as a parameter: ${sql}`);
			}
			params.push(TenantGuard.placeholdersBefore(sql, item));
			at = items.end;
		}
		return params;
	}

	/** Split the tuple starting at `sql[start] === "("` into its top-level items. */
	private static tupleItems(sql: string, start: number) {
		const positions: number[] = [];
		const texts: string[] = [];
		let depth = 0;
		let itemStart = start + 1;
		let quote: string | null = null;

		for (let i = start; i < sql.length; i++) {
			const ch = sql[i]!;
			if (quote) {
				if (ch === quote) quote = null;
				continue;
			}
			if (ch === "'" || ch === '"') {
				quote = ch;
			} else if (ch === "(") {
				depth++;
			} else if (ch === ")" || (ch === "," && depth === 1)) {
				if (ch === ")") depth--;
				if (depth === 0 || ch === ",") {
					const raw = sql.slice(itemStart, i);
					const offset = raw.length - raw.trimStart().length;
					positions.push(itemStart + offset);
					texts.push(raw.trim());
					itemStart = i + 1;
				}
				if (depth === 0) return { positions, texts, end: i + 1 };
			}
		}
		throw new TenantGuardError(`Unterminated values tuple: ${sql}`);
	}

	/** Number of `?` placeholders before `position` (= the index of the parameter there). */
	private static placeholdersBefore(sql: string, position: number) {
		let count = 0;
		let quote: string | null = null;
		for (let i = 0; i < position; i++) {
			const ch = sql[i];
			if (quote) {
				if (ch === quote) quote = null;
			} else if (ch === "'" || ch === '"') {
				quote = ch;
			} else if (ch === "?") {
				count++;
			}
		}
		return count;
	}

	private static bindCheck(statement: Statement, sql: string, orgParams: readonly number[]) {
		const check = (params: unknown[]) => {
			if (OrgContext.isUnscoped()) return;
			const orgId = OrgContext.id();
			for (const index of orgParams) {
				if (params[index] !== orgId) {
					throw new TenantGuardError(
						`org_id parameter ${index} is ${String(params[index])}, not the current org ${orgId}: ${sql}`,
					);
				}
			}
		};

		return new Proxy(statement, {
			get(target, property, receiver) {
				const value = Reflect.get(target, property, receiver);
				if (typeof value !== "function") return value;
				if (
					property === "all" ||
					property === "get" ||
					property === "run" ||
					property === "values" ||
					property === "iterate"
				) {
					return (...params: unknown[]) => {
						check(params);
						return value.apply(target, params);
					};
				}
				return value.bind(target);
			},
		});
	}
}
