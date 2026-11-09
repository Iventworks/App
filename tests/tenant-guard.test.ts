import { describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { DB } from "../server/lib/db";
import { OrgContext } from "../server/lib/orgs/context";
import { TenantGuard, TenantGuardError } from "../server/lib/orgs/guard";
import { OrgRegistry } from "../server/lib/orgs/registry";
import { OrgService } from "../server/lib/orgs/service";
import { testOrg } from "./helpers/orgs";

const ORG_TABLES = new Set(["events", "users", "event_members"]);

describe("TenantGuard.analyze", () => {
	test("accepts a select filtered by org", () => {
		const result = TenantGuard.analyze(
			'select "id" from "events" where ("events"."org_id" = ? and "events"."id" = ?)',
			ORG_TABLES,
		);
		expect(result.orgParams).toEqual([0]);
	});

	test("rejects a select without org filter", () => {
		expect(() =>
			TenantGuard.analyze('select "id" from "events" where "events"."id" = ?', ORG_TABLES),
		).toThrow(TenantGuardError);
	});

	test("rejects an org filter on another table only", () => {
		expect(() =>
			TenantGuard.analyze(
				'select "id" from "events" left join "users" on "users"."id" = "events"."created_by" where "users"."org_id" = ?',
				ORG_TABLES,
			),
		).toThrow(TenantGuardError);
	});

	test("a join on org_id carries the anchor over", () => {
		const result = TenantGuard.analyze(
			'select "x" from "event_members" inner join "events" on ("events"."org_id" = "event_members"."org_id" and "events"."id" = "event_members"."event_id") where ("event_members"."org_id" = ? and "event_members"."user_id" = ?)',
			ORG_TABLES,
		);
		expect(result.orgParams).toEqual([0]);
	});

	test("two tables only joined to each other are not anchored", () => {
		expect(() =>
			TenantGuard.analyze(
				'select "x" from "event_members" inner join "events" on "events"."org_id" = "event_members"."org_id"',
				ORG_TABLES,
			),
		).toThrow(TenantGuardError);
	});

	test("aliases need their own filter", () => {
		expect(() =>
			TenantGuard.analyze(
				'select "x" from "events" left join "users" "creator" on "creator"."id" = "events"."created_by" where "events"."org_id" = ?',
				ORG_TABLES,
			),
		).toThrow(/users/);
		const ok = TenantGuard.analyze(
			'select "x" from "events" left join "users" "creator" on ("creator"."org_id" = ? and "creator"."id" = "events"."created_by") where "events"."org_id" = ?',
			ORG_TABLES,
		);
		expect([...ok.orgParams].sort()).toEqual([0, 1]);
	});

	test("update and delete need the filter", () => {
		expect(() =>
			TenantGuard.analyze('update "events" set "name" = ? where "events"."id" = ?', ORG_TABLES),
		).toThrow(TenantGuardError);
		expect(() =>
			TenantGuard.analyze('delete from "users" where "users"."id" = ?', ORG_TABLES),
		).toThrow(TenantGuardError);
		expect(
			TenantGuard.analyze(
				'update "events" set "name" = ? where ("events"."org_id" = ? and "events"."id" = ?)',
				ORG_TABLES,
			).orgParams,
		).toEqual([1]);
	});

	test("inserts must bind org_id, in every row", () => {
		expect(() =>
			TenantGuard.analyze('insert into "events" ("id", "name") values (null, ?)', ORG_TABLES),
		).toThrow(/without org_id/);
		expect(
			TenantGuard.analyze(
				'insert into "events" ("id", "org_id", "name", "created_at") values (null, ?, ?, (unixepoch() * 1000)), (null, ?, ?, (unixepoch() * 1000)) returning "id"',
				ORG_TABLES,
			).orgParams,
		).toEqual([0, 2]);
		expect(() =>
			TenantGuard.analyze('insert into "events" ("org_id", "name") values (7, ?)', ORG_TABLES),
		).toThrow(/parameter/);
	});

	test("tables without org_id are not checked", () => {
		expect(
			TenantGuard.analyze('select "key" from "metadata" where "metadata"."key" = ?', ORG_TABLES)
				.orgParams,
		).toEqual([]);
	});
});

describe("TenantGuard on the real connection", () => {
	test("every table with org_id is guarded", () => {
		const names = DB.orgTableNames();
		for (const table of ["users", "events", "participants", "files", "audit_logs", "org_domains"]) {
			expect(names.has(table)).toBe(true);
		}
		expect(names.has("orgs")).toBe(false);
		expect(names.has("metadata")).toBe(false);
	});

	test("an unscoped query fails inside an org context", async () => {
		const org = testOrg();
		await expect(
			OrgContext.run(org, async () => DB.instance().select().from(DB.Tables.events).all()),
		).rejects.toThrow(TenantGuardError);
	});

	test("a query bound to another org's id fails", async () => {
		const other = await OrgService.create({ slug: "guard-other", display_name: "Guard Other" });
		try {
			await expect(
				OrgContext.run(testOrg(), async () =>
					DB.instance()
						.select()
						.from(DB.Tables.events)
						.where(eq(DB.Tables.events.org_id, other.id))
						.all(),
				),
			).rejects.toThrow(/not the current org/);
		} finally {
			await OrgService.delete(other.id);
		}
	});

	test("aliased joins work with inOrg on the alias", async () => {
		const creator = alias(DB.Tables.users, "creator");
		const rows = await OrgContext.run(testOrg(), () =>
			DB.instance()
				.select({ id: DB.Tables.events.id })
				.from(DB.Tables.events)
				.leftJoin(
					creator,
					and(eq(creator.org_id, OrgContext.id()), eq(creator.id, DB.Tables.events.created_by)),
				)
				.where(eq(DB.Tables.events.org_id, OrgContext.id()))
				.all(),
		);
		expect(Array.isArray(rows)).toBe(true);
	});

	test("outside any org a guarded query fails", async () => {
		await expect(
			OrgContext.run(null, async () =>
				DB.instance().select().from(DB.Tables.events).where(eq(DB.Tables.events.org_id, 1)).all(),
			),
		).rejects.toThrow();
	});

	test("registry resolves hosts", () => {
		expect(OrgRegistry.resolveHost("test.localhost").kind).toBe("org");
		expect(OrgRegistry.resolveHost("TEST.localhost:31316").kind).toBe("org");
		expect(OrgRegistry.resolveHost("localhost").kind).toBe("system");
		expect(OrgRegistry.resolveHost("nope.localhost").kind).toBe("unknown");
		expect(OrgRegistry.resolveHost("a.test.localhost").kind).toBe("unknown");
		expect(OrgRegistry.resolveHost("example.org").kind).toBe("unknown");
		expect(OrgRegistry.resolveHost("system.localhost").kind).toBe("unknown");
	});
});
