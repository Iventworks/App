import { AsyncLocalStorage } from "node:async_hooks";
import { eq, type SQL } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { OrgInfo } from "./registry";

interface OrgStore {
	readonly org: OrgInfo | null;
	/** Set by {@link OrgContext.unscoped}: the tenant guard lets cross-org statements through. */
	readonly unscoped: boolean;
}

const storage = new AsyncLocalStorage<OrgStore>();

// Tests only (`OrgContext.useTestFallback`): the store outside of any request, so seeding code can
// query the DB directly. Requests still run in their own, guarded context.
let testFallback: OrgStore | undefined;

function currentStore(): OrgStore | undefined {
	return storage.getStore() ?? testFallback;
}

export class OrgContextError extends Error {
	constructor(message = "No organisation in the current context") {
		super(message);
		this.name = "OrgContextError";
	}
}

/**
 * The org the current request (or background job) works in. The API's org middleware resolves it
 * from the host and runs the rest of the request inside {@link OrgContext.run}; every query on an
 * org-owned table filters with {@link inOrg} and every insert sets `org_id: OrgContext.id()`.
 */
export class OrgContext {
	/** Run `fn` as `org` (or as "no org" for unknown hosts). Clears an outer `unscoped`. */
	static run<T>(org: OrgInfo | null, fn: () => T): T {
		return storage.run({ org, unscoped: false }, fn);
	}

	/**
	 * Run `fn` with the tenant guard switched off — only for system code that has to work across
	 * orgs (migrations, the org registry, housekeeping, the system API's org list and deletion).
	 * Never wrap request handling of an org in it.
	 */
	static unscoped<T>(fn: () => T): T {
		return storage.run({ org: currentStore()?.org ?? null, unscoped: true }, fn);
	}

	static isUnscoped(): boolean {
		return currentStore()?.unscoped === true;
	}

	static maybeCurrent(): OrgInfo | null {
		return currentStore()?.org ?? null;
	}

	static current(): OrgInfo {
		const org = currentStore()?.org;
		if (!org) throw new OrgContextError();
		return org;
	}

	static id(): number {
		return OrgContext.current().id;
	}

	/**
	 * Tests only: code outside a request (seeding, assertions on the DB) runs as `org`, with the
	 * tenant guard off. API requests made by the tests still resolve their org from the host.
	 */
	static useTestFallback(org: OrgInfo | null) {
		testFallback = org ? { org, unscoped: true } : undefined;
	}
}

/** `<table>.org_id = <current org>`: add it to the `where` (and join `on`) of every org table. */
export function inOrg(table: { org_id: AnySQLiteColumn }): SQL {
	return eq(table.org_id, OrgContext.id());
}
