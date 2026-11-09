import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { inOrg, OrgContext } from "../../../../../../orgs/context";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { EventAccess, type EventRouterEnv } from "../../../../../utils/eventAccess";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { EventNotesModel } from "./model";

type NotesEnv = {
	Variables: EventRouterEnv["Variables"] & { note: DB.Models.Note };
};

export const router = new Hono<NotesEnv>().basePath("/:eventId/notes");

/** Group ids whose notes the caller may see: all groups for leaders, else their own groups. */
async function getVisibleGroupIds(c: Context<NotesEnv>) {
	const event = c.get("event");
	if (EventAccess.can(c, "notes:manage_all")) {
		const rows = await DB.instance()
			.select({ id: DB.Tables.eventGroups.id })
			.from(DB.Tables.eventGroups)
			.where(and(inOrg(DB.Tables.eventGroups), eq(DB.Tables.eventGroups.event_id, event.id)))
			.all();
		return rows.map((row) => row.id);
	}
	return await getMyGroupIds(event.id, c.get("eventAccess").userId);
}

async function getMyGroupIds(eventId: number, userId: number) {
	const rows = await DB.instance()
		.select({ id: DB.Tables.eventGroups.id })
		.from(DB.Tables.eventGroupMembers)
		.innerJoin(
			DB.Tables.eventGroups,
			and(
				inOrg(DB.Tables.eventGroups),
				eq(DB.Tables.eventGroups.id, DB.Tables.eventGroupMembers.group_id),
			),
		)
		.where(
			and(
				inOrg(DB.Tables.eventGroupMembers),
				eq(DB.Tables.eventGroups.event_id, eventId),
				eq(DB.Tables.eventGroupMembers.user_id, userId),
			),
		)
		.all();
	return rows.map((row) => row.id);
}

function canEdit(c: Context<NotesEnv>, note: DB.Models.Note, myGroupIds: number[]) {
	if (EventAccess.can(c, "notes:manage_all")) return true;
	if (note.group_id === null) return EventAccess.can(c, "notes:create");
	return myGroupIds.includes(note.group_id);
}

function canDelete(c: Context<NotesEnv>, note: DB.Models.Note) {
	return EventAccess.can(c, "notes:manage_all") || note.created_by === c.get("eventAccess").userId;
}

async function toResponse(
	c: Context<NotesEnv>,
	notes: DB.Models.Note[],
): Promise<EventNotesModel.Note[]> {
	const users = await UserSummary.fetchMap(
		notes.flatMap((note) => [note.created_by, note.updated_by]),
	);
	const groupIds = [
		...new Set(notes.map((note) => note.group_id).filter((id): id is number => id !== null)),
	];
	const groups = groupIds.length
		? await DB.instance()
				.select({
					id: DB.Tables.eventGroups.id,
					name: DB.Tables.eventGroups.name,
					color: DB.Tables.eventGroups.color,
				})
				.from(DB.Tables.eventGroups)
				.where(and(inOrg(DB.Tables.eventGroups), inArray(DB.Tables.eventGroups.id, groupIds)))
				.all()
		: [];
	const myGroupIds = await getMyGroupIds(c.get("event").id, c.get("eventAccess").userId);

	return notes.map((note) => ({
		...note,
		creator: note.created_by ? (users.get(note.created_by) ?? null) : null,
		updater: note.updated_by ? (users.get(note.updated_by) ?? null) : null,
		group: groups.find((group) => group.id === note.group_id) ?? null,
		can_edit: canEdit(c, note, myGroupIds),
		can_delete: canDelete(c, note),
	}));
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List event notes",
		description:
			"List the event-wide notes and the notes of the groups the caller belongs to (leaders see all group notes). Pass `group_id` to get only one group's notes.",
		tags: [DOCS_TAGS.EVENTS.NOTES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Notes retrieved successfully", EventNotesModel.GetAll.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to view these notes"),
		),
	}),

	zValidator("query", EventNotesModel.GetAll.Query),

	async (c) => {
		if (!EventAccess.can(c, "notes:view")) {
			return APIResponse.forbidden(c, "You are not allowed to view these notes");
		}

		const event = c.get("event");
		const { group_id } = c.req.valid("query") as EventNotesModel.GetAll.Query;
		const visibleGroupIds = await getVisibleGroupIds(c);

		let condition: ReturnType<typeof and>;
		if (group_id !== undefined) {
			if (!visibleGroupIds.includes(group_id)) {
				return APIResponse.forbidden(c, "You are not allowed to view these notes");
			}
			condition = and(
				eq(DB.Tables.notes.event_id, event.id),
				eq(DB.Tables.notes.scope, "group"),
				eq(DB.Tables.notes.group_id, group_id),
			);
		} else {
			const eventWide = and(eq(DB.Tables.notes.scope, "event"), isNull(DB.Tables.notes.group_id));
			condition = and(
				eq(DB.Tables.notes.event_id, event.id),
				visibleGroupIds.length
					? or(
							eventWide,
							and(eq(DB.Tables.notes.scope, "group"), inArray(DB.Tables.notes.group_id, visibleGroupIds)),
						)
					: eventWide,
			);
		}

		const notes = await DB.instance()
			.select()
			.from(DB.Tables.notes)
			.where(and(inOrg(DB.Tables.notes), condition))
			.orderBy(desc(DB.Tables.notes.pinned), desc(DB.Tables.notes.updated_at))
			.all();

		return APIResponse.success(c, "Notes retrieved successfully", await toResponse(c, notes));
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create event note",
		description:
			"Create an event-wide note (visible to all staff) or a group note (`group_id`, visible to the group and leaders).",
		tags: [DOCS_TAGS.EVENTS.NOTES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Note created successfully", EventNotesModel.Create.Response),
			APIResponseSpec.badRequest(
				"The group does not belong to this event / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to create notes here"),
		),
	}),

	zValidator("json", EventNotesModel.Create.Body),

	async (c) => {
		if (!EventAccess.can(c, "notes:create")) {
			return APIResponse.forbidden(c, "You are not allowed to create notes here");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const body = c.req.valid("json") as EventNotesModel.Create.Body;

		let groupName: string | null = null;
		if (body.group_id !== null) {
			const group = await DB.instance()
				.select()
				.from(DB.Tables.eventGroups)
				.where(
					and(
						inOrg(DB.Tables.eventGroups),
						eq(DB.Tables.eventGroups.id, body.group_id),
						eq(DB.Tables.eventGroups.event_id, event.id),
					),
				)
				.get();
			if (!group) {
				return APIResponse.badRequest(c, "The group does not belong to this event");
			}
			const myGroupIds = await getMyGroupIds(event.id, userId);
			if (!EventAccess.can(c, "notes:manage_all") && !myGroupIds.includes(group.id)) {
				return APIResponse.forbidden(c, "You are not allowed to create notes here");
			}
			groupName = group.name;
		}

		const note = await DB.instance()
			.insert(DB.Tables.notes)
			.values({
				org_id: OrgContext.id(),
				scope: body.group_id !== null ? "group" : "event",
				event_id: event.id,
				group_id: body.group_id,
				title: body.title,
				content: body.content,
				pinned: body.pinned,
				created_by: userId,
				updated_by: userId,
			})
			.returning()
			.get();

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "note",
			entityId: note.id,
			summary: groupName
				? `Notiz „${note.title}“ für ${groupName} angelegt`
				: `Notiz „${note.title}“ angelegt`,
		});

		const [result] = await toResponse(c, [note]);
		return APIResponse.created(c, "Note created successfully", result!);
	},
);

router.use("/:noteId/*", zValidator("param", EventNotesModel.Params), async (c, next) => {
	const event = c.get("event");
	const noteId = EventNotesModel.Params.shape.noteId.safeParse(c.req.param("noteId"));
	if (!noteId.success) return APIResponse.badRequest(c, "Invalid note id");

	const note = await DB.instance()
		.select()
		.from(DB.Tables.notes)
		.where(
			and(
				inOrg(DB.Tables.notes),
				eq(DB.Tables.notes.id, noteId.data),
				eq(DB.Tables.notes.event_id, event.id),
				inArray(DB.Tables.notes.scope, ["event", "group"]),
			),
		)
		.get();

	if (!note) return APIResponse.notFound(c, "Note not found");

	// Group notes of groups the caller cannot see do not exist for them.
	if (note.group_id !== null) {
		const visibleGroupIds = await getVisibleGroupIds(c);
		if (!visibleGroupIds.includes(note.group_id)) {
			return APIResponse.notFound(c, "Note not found");
		}
	}

	c.set("note", note);
	await next();
});

router.put(
	"/:noteId",

	APIRouteSpec.authenticated({
		summary: "Update event note",
		description:
			"Update a note. Event-wide notes are editable by all staff, group notes by the group's members; leaders can edit every note.",
		tags: [DOCS_TAGS.EVENTS.NOTES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Note updated successfully", EventNotesModel.Update.Response),
			APIResponseSpec.notFound("Note not found"),
			APIResponseSpec.forbidden("You are not allowed to edit this note"),
		),
	}),

	zValidator("json", EventNotesModel.Update.Body),

	async (c) => {
		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const note = c.get("note");
		const body = c.req.valid("json") as EventNotesModel.Update.Body;

		const myGroupIds = await getMyGroupIds(event.id, userId);
		if (!canEdit(c, note, myGroupIds)) {
			return APIResponse.forbidden(c, "You are not allowed to edit this note");
		}

		const updated = await DB.instance()
			.update(DB.Tables.notes)
			.set({ ...body, updated_by: userId, updated_at: Date.now() })
			.where(and(inOrg(DB.Tables.notes), eq(DB.Tables.notes.id, note.id)))
			.returning()
			.get();

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "update",
			entityType: "note",
			entityId: note.id,
			summary: `Notiz „${updated.title}“ bearbeitet`,
		});

		const [result] = await toResponse(c, [updated]);
		return APIResponse.success(c, "Note updated successfully", result!);
	},
);

router.delete(
	"/:noteId",

	APIRouteSpec.authenticated({
		summary: "Delete event note",
		description: "Delete a note. Allowed for its creator and leaders.",
		tags: [DOCS_TAGS.EVENTS.NOTES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Note deleted successfully"),
			APIResponseSpec.notFound("Note not found"),
			APIResponseSpec.forbidden("You are not allowed to delete this note"),
		),
	}),

	async (c) => {
		const note = c.get("note");
		if (!canDelete(c, note)) {
			return APIResponse.forbidden(c, "You are not allowed to delete this note");
		}

		await DB.instance()
			.delete(DB.Tables.notes)
			.where(and(inOrg(DB.Tables.notes), eq(DB.Tables.notes.id, note.id)))
			.run();

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: c.get("event").id,
			action: "delete",
			entityType: "note",
			entityId: note.id,
			summary: `Notiz „${note.title}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "Note deleted successfully");
	},
);
