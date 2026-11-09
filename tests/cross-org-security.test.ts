/**
 * Cross-org security: one org (the attacker, an admin of its own org) runs every operation of the
 * API against another org (the victim):
 *
 *  A. reads with the victim's ids in the path — no response may contain the victim's data;
 *  B. writes with the victim's ids in the path — the victim's rows must stay exactly as they were;
 *  C. writes on its own objects with the victim's ids in the body — no row may end up pointing into
 *     the victim org (and the victim's rows stay unchanged);
 *  D. tokens only work on their own org's hosts.
 *
 * The operations come from the OpenAPI spec, so a new route is covered without touching this file.
 * Every text in the victim's data carries a marker; finding it in a response is a leak.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { generateSpecs } from "hono-openapi";
import { API } from "../server/lib/api";
import { APIv1Router } from "../server/lib/api/versions/v1";
import { OrgService } from "../server/lib/orgs/service";
import {
	findCrossOrgReferences,
	type SeededIds,
	type SeededOrg,
	seedOrgData,
	snapshotOrg,
} from "./helpers/crossOrg";
import { hostHeaders } from "./helpers/orgs";

const VICTIM_SLUG = "victim";
const VICTIM_HOST = `${VICTIM_SLUG}.localhost`;
// Its own org, so phase C's writes (name, colour, domains …) don't touch the shared test org.
const ATTACKER_SLUG = "attacker";
const ATTACKER_HOST = `${ATTACKER_SLUG}.localhost`;

type Method = "get" | "post" | "put" | "delete";
interface Operation {
	readonly method: Method;
	readonly path: string;
	readonly bodySchema: any;
	readonly multipart: boolean;
}

let victim: SeededOrg;
let attacker: SeededOrg;
let operations: Operation[] = [];

/** The id for path parameter `param` of `path`, from the given data set. */
function idFor(ids: SeededIds, path: string, param: string): string {
	const pick = (key: string) => String(ids[key]);
	switch (param) {
		case "noteId":
			if (path.startsWith("/notes")) return pick("personalNoteId");
			if (path.includes("/participants/")) return pick("participantNoteId");
			if (path.startsWith("/org/core-team")) return pick("coreNoteId");
			return pick("noteId");
		case "taskId":
			return pick(path.startsWith("/tasks") ? "personalTaskId" : "taskId");
		case "announcementId":
			return pick(path.startsWith("/org/") ? "orgAnnouncementId" : "announcementId");
		case "kind":
			return "logo";
		case "token":
			// The share link token (`/shares/{token}`).
			return pick("shareToken");
		case "filename":
			return "datei.txt";
		case "orgId":
			return String(victim.org.id);
		default:
			if (ids[param] === undefined)
				throw new Error(`No seeded id for path parameter "${param}" (${path})`);
			return pick(param);
	}
}

function fillPath(path: string, ids: SeededIds) {
	return path.replace(/\{(\w+)\}/g, (_, param: string) =>
		encodeURIComponent(idFor(ids, path, param)),
	);
}

/** Ids from the other org for body fields, by field name. */
function bodyIdFor(field: string, ids: SeededIds, userIds: number[]): number | number[] {
	const one = (key: string) => Number(ids[key]);
	const map: Record<string, number> = {
		user_id: one("userId"),
		assignee_id: one("userId"),
		sender_id: one("userId"),
		room_id: one("roomId"),
		group_id: one("groupId"),
		event_id: one("eventId"),
		resource_id: one("resourceId"),
		parent_id: one("fileId"),
		file_id: one("fileId"),
		receipt_file_id: one("fileId"),
		participant_id: one("participantId"),
		program_item_id: one("programItemId"),
	};
	if (field.endsWith("_ids")) {
		if (field.includes("file")) return [one("fileId"), one("eventFileId")];
		if (field.includes("participant")) return [one("participantId")];
		if (field.includes("group")) return [one("groupId")];
		return userIds;
	}
	return map[field] ?? one("userId");
}

/** A plausible request body from the OpenAPI schema, with every id field set to `ids`. */
function sampleBody(schema: any, ids: SeededIds, userIds: number[], field = ""): unknown {
	if (!schema) return undefined;
	const variants = schema.anyOf ?? schema.oneOf;
	if (variants) {
		const nonNull = variants.find((variant: any) => variant.type !== "null") ?? variants[0];
		return sampleBody(nonNull, ids, userIds, field);
	}
	if (schema.enum) return schema.enum[0];
	if (schema.const !== undefined) return schema.const;

	switch (schema.type) {
		case "object": {
			const result: Record<string, unknown> = {};
			for (const [key, child] of Object.entries<any>(schema.properties ?? {})) {
				result[key] = sampleBody(child, ids, userIds, key);
			}
			return result;
		}
		case "array": {
			const isIds = field.endsWith("_ids") || field.endsWith("ids");
			if (isIds && (schema.items?.type === "integer" || schema.items?.type === "number")) {
				return bodyIdFor(field, ids, userIds);
			}
			const item = sampleBody(schema.items, ids, userIds, field);
			return Array.from({ length: Math.max(1, schema.minItems ?? 1) }, () => item);
		}
		case "integer":
		case "number": {
			if (field === "id" || field.endsWith("_id")) return bodyIdFor(field, ids, userIds);
			const min =
				schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : 1);
			return Math.max(1, Math.min(min, schema.maximum ?? Number.MAX_SAFE_INTEGER));
		}
		case "boolean":
			return false;
		case "string": {
			if (schema.format === "email") return "probe@example.com";
			if (
				schema.format === "date" ||
				/\\d\{4\}/.test(schema.pattern ?? "") ||
				field.endsWith("_date") ||
				field === "spent_on"
			) {
				return "2027-07-02";
			}
			if (field.includes("color")) return "#ff00ff";
			const text = "probe text";
			return text.padEnd(schema.minLength ?? 0, "x").slice(0, schema.maxLength ?? 200);
		}
		default:
			return undefined;
	}
}

async function call(
	method: Method,
	path: string,
	token: string,
	host: string,
	body?: unknown,
): Promise<{ status: number; text: string }> {
	const res = await API.getApp().request(`/v1${path}`, {
		method: method.toUpperCase(),
		headers: {
			Authorization: `Bearer ${token}`,
			...hostHeaders(host),
			...(body !== undefined ? { "Content-Type": "application/json" } : {}),
		},
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	return { status: res.status, text: await res.text() };
}

// Would end the attacker's own session or account, which the later phases still need.
/** Paths that name one of the other org's objects (not just `{kind}` or a download `{token}`). */
function namesAnObject(path: string) {
	return [...path.matchAll(/\{(\w+)\}/g)].some(
		([, param]) => param !== "kind" && param !== "filename",
	);
}

const SELF_DESTRUCTIVE = [
	"post /auth/logout",
	"delete /account",
	"put /account/password",
	"delete /account/sessions",
	"delete /account/sessions/{sessionId}",
];

beforeAll(async () => {
	const victimOrg = await OrgService.create({ slug: VICTIM_SLUG, display_name: "Opfer-Org" });
	victim = await seedOrgData(victimOrg, "VICTIMLEAK7f3a");
	const attackerOrg = await OrgService.create({
		slug: ATTACKER_SLUG,
		display_name: "Angreifer-Org",
	});
	attacker = await seedOrgData(attackerOrg, "ATTACKERf00d");

	// From the router itself: another test file may have switched the docs route off.
	const v1 = new APIv1Router();
	const spec = (await generateSpecs(v1.router as any, v1.openAPIConfig)) as any;
	for (const [path, item] of Object.entries<any>(spec.paths)) {
		for (const method of ["get", "post", "put", "delete"] as const) {
			const op = item[method];
			if (!op) continue;
			const content = op.requestBody?.content ?? {};
			operations.push({
				method,
				path,
				bodySchema: content["application/json"]?.schema,
				multipart: Boolean(content["multipart/form-data"]),
			});
		}
	}
	operations = operations.filter((op) => !op.path.startsWith("/system"));
}, 60_000);

describe("Cross-org security", () => {
	test("the spec lists the API", () => {
		expect(operations.length).toBeGreaterThan(150);
	});

	test("A: reads with the other org's ids never return its data", async () => {
		const leaks: string[] = [];
		const errors: string[] = [];
		const answered: string[] = [];

		for (const op of operations.filter((o) => o.method === "get")) {
			const path = fillPath(op.path, victim.ids);
			const res = await call("get", path, attacker.adminToken, ATTACKER_HOST);
			if (res.text.includes(victim.marker)) leaks.push(`GET ${op.path} (${res.status})`);
			if (res.status >= 500) errors.push(`GET ${op.path} → ${res.status}`);
			// Paths that name one of the victim's objects must not succeed.
			if (namesAnObject(op.path) && res.status < 300) {
				answered.push(`GET ${op.path} → ${res.status}`);
			}
		}

		expect(leaks).toEqual([]);
		expect(errors).toEqual([]);
		expect(answered).toEqual([]);
	}, 300_000);

	test("B: writes with the other org's ids change nothing there", async () => {
		const before = await snapshotOrg(victim.org.id);
		const succeeded: string[] = [];
		const leaks: string[] = [];
		const errors: string[] = [];

		const writes = operations.filter(
			(o) =>
				o.method !== "get" &&
				namesAnObject(o.path) &&
				!SELF_DESTRUCTIVE.includes(`${o.method} ${o.path}`),
		);
		for (const op of writes) {
			const body = op.multipart
				? undefined
				: (sampleBody(op.bodySchema, victim.ids, victim.userIds) ?? undefined);
			const res = await call(
				op.method,
				fillPath(op.path, victim.ids),
				attacker.adminToken,
				ATTACKER_HOST,
				body,
			);
			if (res.status < 300) succeeded.push(`${op.method.toUpperCase()} ${op.path} → ${res.status}`);
			if (res.status >= 500) errors.push(`${op.method.toUpperCase()} ${op.path} → ${res.status}`);
			if (res.text.includes(victim.marker)) leaks.push(`${op.method.toUpperCase()} ${op.path}`);
		}

		expect(await snapshotOrg(victim.org.id)).toEqual(before);
		expect(leaks).toEqual([]);
		expect(errors).toEqual([]);
		expect(succeeded).toEqual([]);
	}, 300_000);

	test("C: writes on its own objects can't reference the other org", async () => {
		const before = await snapshotOrg(victim.org.id);
		const errors: string[] = [];
		const leaks: string[] = [];
		const accepted: string[] = [];

		// Creates and updates first; deletes would remove the objects later calls need.
		const writes = operations
			.filter(
				(o) =>
					(o.method === "post" || o.method === "put") &&
					!SELF_DESTRUCTIVE.includes(`${o.method} ${o.path}`),
			)
			.filter((o) => !o.multipart);
		for (const op of writes) {
			const body = sampleBody(op.bodySchema, victim.ids, victim.userIds);
			const res = await call(
				op.method,
				fillPath(op.path, attacker.ids),
				attacker.adminToken,
				ATTACKER_HOST,
				body,
			);
			if (res.status >= 500)
				errors.push(`${op.method.toUpperCase()} ${op.path} → ${res.status}: ${res.text.slice(0, 120)}`);
			if (res.text.includes(victim.marker)) leaks.push(`${op.method.toUpperCase()} ${op.path}`);
			if (res.status < 300) accepted.push(`${op.method.toUpperCase()} ${op.path}`);
		}
		// How many writes got past validation (and so reached the code that has to reject or ignore
		// the foreign ids) — printed to keep an eye on the probe's coverage.
		console.log(`Phase C: ${accepted.length} of ${writes.length} writes accepted`);

		expect(findCrossOrgReferences()).toEqual([]);
		expect(await snapshotOrg(victim.org.id)).toEqual(before);
		expect(leaks).toEqual([]);
		expect(errors).toEqual([]);
	}, 300_000);

	test("D: tokens only work on their own org's host", async () => {
		expect((await call("get", "/account", victim.adminToken, ATTACKER_HOST)).status).toBe(401);
		expect((await call("get", "/account", attacker.adminToken, VICTIM_HOST)).status).toBe(401);
		expect((await call("get", "/account", victim.adminToken, VICTIM_HOST)).status).toBe(200);
		// The system host doesn't accept org tokens either.
		expect((await call("get", "/account", victim.adminToken, "localhost")).status).toBe(401);
	});

	test("the victim still works on its own host", async () => {
		const res = await call("get", `/events/${victim.ids.eventId}`, victim.adminToken, VICTIM_HOST);
		expect(res.status).toBe(200);
		expect(res.text).toContain(victim.marker);
		expect(res.text).not.toContain("org_id");
	});
});
