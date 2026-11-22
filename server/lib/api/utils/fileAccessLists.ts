import { and, asc, count, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";
import { DB } from "../../db";
import { inOrg, OrgContext } from "../../orgs/context";
import type { FileService } from "./fileService";
import { PermissionHelper } from "./permissions";
import type { FileAccessModel } from "./shared-models/fileAccess";
import { UserSummary } from "./shared-models/userSummary";

const PRINCIPALS_BY_SCOPE: Record<"org" | "event", readonly FileAccessModel.Principal[]> = {
	org: ["members", "org_group", "user"],
	event: ["team", "event_group", "user"],
};

const PRINCIPAL_ORDER: Record<FileAccessModel.Principal, number> = {
	members: 0,
	team: 0,
	org_group: 1,
	event_group: 1,
	user: 2,
};

const MEMBERS_LABEL = "Alle Mitglieder";
const TEAM_LABEL = "Alle im Team";

type NewEntry = Omit<typeof DB.Tables.fileAccess.$inferInsert, "org_id" | "file_id">;

/**
 * Org roles that always have full access (the Kernteam, admins) — never listed. A function: the
 * role ranks are read when it is called, not while modules load.
 */
function managerRoles() {
	return (Object.keys(PermissionHelper.ORG_ROLE_RANK) as DB.Models.User["role"][]).filter((role) =>
		PermissionHelper.hasOrgRole(role, "core_team"),
	);
}

/**
 * Access lists of org and event documents (`file_access`): labels for the UI, the library
 * defaults, validating and replacing a list, and who can be added. The evaluation lives in
 * `FileAccess`.
 */
export namespace FileAccessLists {
	export function rightsOf(row: DB.Models.FileAccessEntry): FileAccessModel.Rights {
		return { read: row.can_read, upload: row.can_upload, edit: row.can_edit, delete: row.can_delete };
	}

	/**
	 * Rights that make sense for the item: files can only be viewed or edited (like share links);
	 * a folder entry that allows changing things also allows looking at them.
	 */
	export function normalize(
		kind: DB.Models.File["kind"],
		rights: FileAccessModel.Rights,
	): FileAccessModel.Rights {
		if (kind === "file") return { read: true, upload: false, edit: rights.edit, delete: false };
		const result = { ...rights };
		if (result.edit || result.delete || (!result.read && !result.upload)) result.read = true;
		return result;
	}

	/** The access a library has without any access list on the way. */
	export function defaultEntries(location: FileService.Location): FileAccessModel.Entry[] {
		if (location.scope !== "event") return [];
		return [
			{
				principal: "team",
				id: null,
				label: TEAM_LABEL,
				color: null,
				permissions: { read: true, upload: true, edit: false, delete: false },
			},
		];
	}

	/** Labelled entries per item id, in display order. Entries whose group or person is gone are left out. */
	export async function toEntries(
		rows: readonly DB.Models.FileAccessEntry[],
	): Promise<Map<number, FileAccessModel.Entry[]>> {
		const ids = (key: "org_group_id" | "event_group_id" | "user_id") =>
			[...new Set(rows.map((row) => row[key]))].filter((id): id is number => id !== null);

		const orgGroupIds = ids("org_group_id");
		const eventGroupIds = ids("event_group_id");
		const [orgGroups, eventGroups, users] = await Promise.all([
			orgGroupIds.length
				? DB.instance()
						.select()
						.from(DB.Tables.orgGroups)
						.where(and(inOrg(DB.Tables.orgGroups), inArray(DB.Tables.orgGroups.id, orgGroupIds)))
						.all()
				: [],
			eventGroupIds.length
				? DB.instance()
						.select()
						.from(DB.Tables.eventGroups)
						.where(and(inOrg(DB.Tables.eventGroups), inArray(DB.Tables.eventGroups.id, eventGroupIds)))
						.all()
				: [],
			UserSummary.fetchMap(ids("user_id")),
		]);
		const orgGroupMap = new Map(orgGroups.map((group) => [group.id, group]));
		const eventGroupMap = new Map(eventGroups.map((group) => [group.id, group]));

		const result = new Map<number, FileAccessModel.Entry[]>();
		for (const row of rows) {
			const permissions = rightsOf(row);
			let entry: FileAccessModel.Entry | null = null;
			switch (row.principal) {
				case "members":
					entry = { principal: "members", id: null, label: MEMBERS_LABEL, color: null, permissions };
					break;
				case "team":
					entry = { principal: "team", id: null, label: TEAM_LABEL, color: null, permissions };
					break;
				case "org_group": {
					const group = row.org_group_id !== null ? orgGroupMap.get(row.org_group_id) : undefined;
					if (group) {
						entry = {
							principal: "org_group",
							id: group.id,
							label: group.name,
							color: group.color,
							permissions,
						};
					}
					break;
				}
				case "event_group": {
					const group = row.event_group_id !== null ? eventGroupMap.get(row.event_group_id) : undefined;
					if (group) {
						entry = {
							principal: "event_group",
							id: group.id,
							label: group.name,
							color: group.color,
							permissions,
						};
					}
					break;
				}
				case "user": {
					const user = row.user_id !== null ? users.get(row.user_id) : undefined;
					if (user) {
						entry = {
							principal: "user",
							id: user.id,
							label: user.display_name,
							color: null,
							permissions,
						};
					}
					break;
				}
			}
			if (!entry) continue;
			const list = result.get(row.file_id) ?? [];
			list.push(entry);
			result.set(row.file_id, list);
		}
		for (const list of result.values()) {
			list.sort(
				(a, b) =>
					PRINCIPAL_ORDER[a.principal] - PRINCIPAL_ORDER[b.principal] ||
					a.label.localeCompare(b.label, "de"),
			);
		}
		return result;
	}

	/**
	 * Who has access to the last item of `path` (root → item; empty = the root itself), where that
	 * comes from, and what would apply if it inherited. `entries`: the access lists already loaded
	 * for the path.
	 */
	export async function describe(
		location: FileService.Location,
		path: readonly DB.Models.File[],
		entries: Map<number, DB.Models.FileAccessEntry[]>,
	): Promise<FileAccessModel.View> {
		const item = path.at(-1) ?? null;
		const custom = item?.custom_access ?? false;
		// The nearest folder above with its own list.
		const source = path.slice(0, -1).findLast((file) => file.custom_access);
		const labelled = await toEntries([
			...(source ? (entries.get(source.id) ?? []) : []),
			...(item && custom ? (entries.get(item.id) ?? []) : []),
		]);
		const inherits = {
			from: source ? { id: source.id, name: source.name } : null,
			entries: source ? (labelled.get(source.id) ?? []) : defaultEntries(location),
		};
		if (!item || !custom) {
			return { custom: false, inherited_from: inherits.from, entries: inherits.entries, inherits };
		}
		return { custom: true, inherited_from: null, entries: labelled.get(item.id) ?? [], inherits };
	}

	/** German summary of a list for the audit log. */
	export function summary(entries: readonly FileAccessModel.Entry[], scope: "org" | "event") {
		if (entries.length === 0) return scope === "org" ? "nur Kernteam" : "nur Leitung";
		return entries.map((entry) => `${entry.label} (${rightsLabel(entry.permissions)})`).join(", ");
	}

	export function rightsLabel(rights: FileAccessModel.Rights) {
		if (!rights.read) return "nur hochladen";
		return [
			"ansehen",
			rights.upload ? "hochladen" : null,
			rights.edit ? "bearbeiten" : null,
			rights.delete ? "löschen" : null,
		]
			.filter(Boolean)
			.join(", ");
	}

	/**
	 * Check a requested list for an item: principals that fit its library, groups and people from
	 * this org (and this event), each only once. Returns the rows to store.
	 */
	export async function validate(
		file: DB.Models.File,
		inputs: readonly FileAccessModel.EntryInput[],
	): Promise<{ ok: true; entries: NewEntry[] } | { ok: false; message: string }> {
		if (file.scope !== "org" && file.scope !== "event") {
			return { ok: false, message: "Only documents have access lists" };
		}
		const allowed = PRINCIPALS_BY_SCOPE[file.scope];
		const seen = new Set<string>();
		for (const input of inputs) {
			if (!allowed.includes(input.principal)) {
				return { ok: false, message: `"${input.principal}" cannot be used here` };
			}
			const needsId = input.principal !== "members" && input.principal !== "team";
			if (needsId !== (typeof input.id === "number")) {
				return {
					ok: false,
					message: needsId ? `"${input.principal}" needs an id` : `"${input.principal}" takes no id`,
				};
			}
			const key = `${input.principal}:${input.id ?? ""}`;
			if (seen.has(key)) return { ok: false, message: "Each group or person may only be listed once" };
			seen.add(key);
		}

		const idsOf = (principal: FileAccessModel.Principal) =>
			inputs.filter((input) => input.principal === principal).map((input) => input.id as number);

		const orgGroupIds = idsOf("org_group");
		if (orgGroupIds.length) {
			const found = await DB.instance()
				.select({ id: DB.Tables.orgGroups.id })
				.from(DB.Tables.orgGroups)
				.where(and(inOrg(DB.Tables.orgGroups), inArray(DB.Tables.orgGroups.id, orgGroupIds)))
				.all();
			if (found.length !== orgGroupIds.length) return { ok: false, message: "Group not found" };
		}

		const eventGroupIds = idsOf("event_group");
		if (eventGroupIds.length) {
			const found = await DB.instance()
				.select({ id: DB.Tables.eventGroups.id })
				.from(DB.Tables.eventGroups)
				.where(
					and(
						inOrg(DB.Tables.eventGroups),
						inArray(DB.Tables.eventGroups.id, eventGroupIds),
						eq(DB.Tables.eventGroups.event_id, file.event_id ?? -1),
					),
				)
				.all();
			if (found.length !== eventGroupIds.length) return { ok: false, message: "Group not found" };
		}

		// The same people `candidates` offers: active accounts, not the managers (they always have
		// full access); in an event only its staff.
		const userIds = idsOf("user");
		if (userIds.length) {
			const listable = and(
				inOrg(DB.Tables.users),
				inArray(DB.Tables.users.id, userIds),
				ne(DB.Tables.users.role, "unverified"),
				notInArray(DB.Tables.users.role, managerRoles()),
				isNull(DB.Tables.users.suspended_at),
			);
			const found =
				file.scope === "event"
					? await DB.instance()
							.select({ id: DB.Tables.users.id })
							.from(DB.Tables.eventMembers)
							.innerJoin(
								DB.Tables.users,
								and(inOrg(DB.Tables.users), eq(DB.Tables.users.id, DB.Tables.eventMembers.user_id)),
							)
							.where(
								and(
									inOrg(DB.Tables.eventMembers),
									eq(DB.Tables.eventMembers.event_id, file.event_id ?? -1),
									eq(DB.Tables.eventMembers.role, "staff"),
									listable,
								),
							)
							.all()
					: await DB.instance()
							.select({ id: DB.Tables.users.id })
							.from(DB.Tables.users)
							.where(listable)
							.all();
			if (found.length !== userIds.length) {
				return {
					ok: false,
					message:
						file.scope === "event"
							? "Only people on the event's team can be added (the Leitung always has full access)"
							: "User not found (or always has full access as Kernteam)",
				};
			}
		}

		return {
			ok: true,
			entries: inputs.map((input) => {
				const rights = normalize(file.kind, input.permissions);
				return {
					principal: input.principal,
					org_group_id: input.principal === "org_group" ? (input.id as number) : null,
					event_group_id: input.principal === "event_group" ? (input.id as number) : null,
					user_id: input.principal === "user" ? (input.id as number) : null,
					can_read: rights.read,
					can_upload: rights.upload,
					can_edit: rights.edit,
					can_delete: rights.delete,
				};
			}),
		};
	}

	/**
	 * Give `file` its own list (`custom`) or let it inherit again. Synchronous transaction: the
	 * flag and the rows change together.
	 */
	export function replace(file: DB.Models.File, custom: boolean, entries: readonly NewEntry[]) {
		const org_id = OrgContext.id();
		DB.instance().transaction((tx) => {
			tx
				.update(DB.Tables.files)
				.set({ custom_access: custom })
				.where(and(inOrg(DB.Tables.files), eq(DB.Tables.files.id, file.id)))
				.run();
			tx
				.delete(DB.Tables.fileAccess)
				.where(and(inOrg(DB.Tables.fileAccess), eq(DB.Tables.fileAccess.file_id, file.id)))
				.run();
			if (custom && entries.length) {
				tx
					.insert(DB.Tables.fileAccess)
					.values(entries.map((entry) => ({ ...entry, org_id, file_id: file.id })))
					.run();
			}
		});
	}

	/**
	 * Who can be added to an access list in `location`. Kernteam (org) and Leitung (event) are left
	 * out: they always have full access.
	 */
	export async function candidates(
		location: FileService.Location,
	): Promise<FileAccessModel.Candidate[]> {
		const managers = managerRoles();
		const plural = (n: number) => `${n} ${n === 1 ? "Person" : "Personen"}`;

		if (location.scope === "event" && location.eventId !== null) {
			const eventId = location.eventId;
			const groups = await DB.instance()
				.select({
					id: DB.Tables.eventGroups.id,
					name: DB.Tables.eventGroups.name,
					color: DB.Tables.eventGroups.color,
					members: count(DB.Tables.eventGroupMembers.user_id),
				})
				.from(DB.Tables.eventGroups)
				.leftJoin(
					DB.Tables.eventGroupMembers,
					and(
						inOrg(DB.Tables.eventGroupMembers),
						eq(DB.Tables.eventGroupMembers.group_id, DB.Tables.eventGroups.id),
					),
				)
				.where(and(inOrg(DB.Tables.eventGroups), eq(DB.Tables.eventGroups.event_id, eventId)))
				.groupBy(DB.Tables.eventGroups.id)
				.orderBy(asc(DB.Tables.eventGroups.name))
				.all();
			const staff = await DB.instance()
				.select({ user: DB.Tables.users, position: DB.Tables.eventMembers.position })
				.from(DB.Tables.eventMembers)
				.innerJoin(
					DB.Tables.users,
					and(inOrg(DB.Tables.users), eq(DB.Tables.users.id, DB.Tables.eventMembers.user_id)),
				)
				.where(
					and(
						inOrg(DB.Tables.eventMembers),
						eq(DB.Tables.eventMembers.event_id, eventId),
						eq(DB.Tables.eventMembers.role, "staff"),
						isNull(DB.Tables.users.suspended_at),
					),
				)
				.all();

			return [
				{
					principal: "team",
					id: null,
					label: TEAM_LABEL,
					description: "Alle Personen im Team",
					color: null,
				},
				...groups.map((group) => ({
					principal: "event_group" as const,
					id: group.id,
					label: group.name,
					description: plural(group.members),
					color: group.color,
				})),
				...staff
					.filter((row) => !managers.includes(row.user.role))
					.map((row) => ({
						principal: "user" as const,
						id: row.user.id,
						label: row.user.display_name,
						description: row.position,
						color: null,
					}))
					.sort((a, b) => a.label.localeCompare(b.label, "de")),
			];
		}

		const groups = await DB.instance()
			.select({
				id: DB.Tables.orgGroups.id,
				name: DB.Tables.orgGroups.name,
				color: DB.Tables.orgGroups.color,
				members: count(DB.Tables.orgGroupMembers.user_id),
			})
			.from(DB.Tables.orgGroups)
			.leftJoin(
				DB.Tables.orgGroupMembers,
				and(
					inOrg(DB.Tables.orgGroupMembers),
					eq(DB.Tables.orgGroupMembers.group_id, DB.Tables.orgGroups.id),
				),
			)
			.where(inOrg(DB.Tables.orgGroups))
			.groupBy(DB.Tables.orgGroups.id)
			.orderBy(asc(DB.Tables.orgGroups.name))
			.all();
		const users = await DB.instance()
			.select()
			.from(DB.Tables.users)
			.where(
				and(
					inOrg(DB.Tables.users),
					eq(DB.Tables.users.role, "volunteer"),
					isNull(DB.Tables.users.suspended_at),
				),
			)
			.orderBy(asc(DB.Tables.users.display_name))
			.all();

		return [
			{
				principal: "members",
				id: null,
				label: MEMBERS_LABEL,
				description: "Alle Personen der Organisation",
				color: null,
			},
			...groups.map((group) => ({
				principal: "org_group" as const,
				id: group.id,
				label: group.name,
				description: plural(group.members),
				color: group.color,
			})),
			...users.map((user) => ({
				principal: "user" as const,
				id: user.id,
				label: user.display_name,
				description: `@${user.username}`,
				color: null,
			})),
		];
	}
}
