import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import type { DrizzleDB } from "../../../../../../db/utils";
import { Logger } from "../../../../../../utils/logger";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { EventAccess, type EventRouterEnv } from "../../../../../utils/eventAccess";
import { FileService } from "../../../../../utils/fileService";
import { Notifier } from "../../../../../utils/notifications";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { EventProgramModel } from "./model";

type ProgramEnv = {
	Variables: EventRouterEnv["Variables"] & { programItem: DB.Models.ProgramItem };
};

export const router = new Hono<ProgramEnv>().basePath("/:eventId/program");

const BAD_REQUEST_MESSAGES =
	"end_at must be after start_at / A responsible person is not a staff member of this event / A linked file does not belong to this event or the organisation library / Syntax or validation error in request";

/** Responsibles must be staff of the event; files event documents or org documents. */
async function validateRefs(
	eventId: number,
	refs: { responsible_user_ids?: number[]; file_ids?: number[] },
): Promise<string | null> {
	const userIds = [...new Set(refs.responsible_user_ids ?? [])];
	if (userIds.length > 0) {
		const members = await DB.instance()
			.select({ user_id: DB.Tables.eventMembers.user_id })
			.from(DB.Tables.eventMembers)
			.where(
				and(
					eq(DB.Tables.eventMembers.event_id, eventId),
					inArray(DB.Tables.eventMembers.user_id, userIds),
				),
			)
			.all();
		if (members.length !== userIds.length) {
			return "A responsible person is not a staff member of this event";
		}
	}

	const fileIds = [...new Set(refs.file_ids ?? [])];
	if (fileIds.length > 0) {
		const files = await DB.instance()
			.select()
			.from(DB.Tables.files)
			.where(inArray(DB.Tables.files.id, fileIds))
			.all();
		const allowed = files.filter(
			(file) =>
				(file.scope === "event" && file.event_id === eventId) ||
				(file.scope === "org" && file.event_id === null),
		);
		if (allowed.length !== fileIds.length) {
			return "A linked file does not belong to this event or the organisation library";
		}
	}

	return null;
}

async function replaceResponsibles(programItemId: number, userIds: number[], tx: DrizzleDB) {
	await tx
		.delete(DB.Tables.programItemResponsibles)
		.where(eq(DB.Tables.programItemResponsibles.program_item_id, programItemId))
		.run();
	const unique = [...new Set(userIds)];
	if (unique.length > 0) {
		await tx
			.insert(DB.Tables.programItemResponsibles)
			.values(unique.map((user_id) => ({ program_item_id: programItemId, user_id })))
			.run();
	}
}

async function replaceFiles(programItemId: number, fileIds: number[], tx: DrizzleDB) {
	await tx
		.delete(DB.Tables.programItemFiles)
		.where(eq(DB.Tables.programItemFiles.program_item_id, programItemId))
		.run();
	const unique = [...new Set(fileIds)];
	if (unique.length > 0) {
		await tx
			.insert(DB.Tables.programItemFiles)
			.values(unique.map((file_id) => ({ program_item_id: programItemId, file_id })))
			.run();
	}
}

async function getResponsibleIds(programItemId: number) {
	const rows = await DB.instance()
		.select({ user_id: DB.Tables.programItemResponsibles.user_id })
		.from(DB.Tables.programItemResponsibles)
		.where(eq(DB.Tables.programItemResponsibles.program_item_id, programItemId))
		.all();
	return rows.map((row) => row.user_id);
}

async function getFileIds(programItemId: number) {
	const rows = await DB.instance()
		.select({ file_id: DB.Tables.programItemFiles.file_id })
		.from(DB.Tables.programItemFiles)
		.where(eq(DB.Tables.programItemFiles.program_item_id, programItemId))
		.all();
	return rows.map((row) => row.file_id);
}

async function toResponse(
	c: Context<ProgramEnv>,
	items: DB.Models.ProgramItem[],
): Promise<EventProgramModel.ProgramItem[]> {
	if (items.length === 0) return [];
	const ids = items.map((item) => item.id);
	const { userId } = c.get("eventAccess");

	const responsibles = await DB.instance()
		.select()
		.from(DB.Tables.programItemResponsibles)
		.where(inArray(DB.Tables.programItemResponsibles.program_item_id, ids))
		.all();

	const fileLinks = await DB.instance()
		.select({
			program_item_id: DB.Tables.programItemFiles.program_item_id,
			file: DB.Tables.files,
		})
		.from(DB.Tables.programItemFiles)
		.innerJoin(DB.Tables.files, eq(DB.Tables.files.id, DB.Tables.programItemFiles.file_id))
		.where(inArray(DB.Tables.programItemFiles.program_item_id, ids))
		.orderBy(asc(DB.Tables.files.kind), asc(DB.Tables.files.name))
		.all();

	const users = await UserSummary.fetchMap(responsibles.map((entry) => entry.user_id));

	return items.map((item) => {
		const responsibleIds = responsibles
			.filter((entry) => entry.program_item_id === item.id)
			.map((entry) => entry.user_id);
		return {
			...item,
			responsible: responsibleIds
				.map((id) => users.get(id))
				.filter((user): user is UserSummary.Schema => Boolean(user))
				.sort((a, b) => a.display_name.localeCompare(b.display_name)),
			files: fileLinks
				.filter((link) => link.program_item_id === item.id)
				.map((link) => FileService.toResponse(link.file)),
			is_mine: responsibleIds.includes(userId),
		};
	});
}

async function notifyResponsibles(
	event: DB.Models.Event,
	item: DB.Models.ProgramItem,
	userIds: number[],
	actorId: number,
) {
	await Notifier.notify(
		userIds,
		{
			type: "program_assigned",
			title: `Programmpunkt: ${item.title}`,
			body: event.name,
			link: `/events/${event.id}/program`,
		},
		{ excludeUserId: actorId },
	);
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List program items",
		description:
			"List the event's schedule (Programmpunkte) sorted by start time, with responsible staff and linked documents. `from`/`to` (unix ms) limit the range to items overlapping it.",
		tags: [DOCS_TAGS.EVENTS.PROGRAM],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success(
				"Program items retrieved successfully",
				EventProgramModel.GetAll.Response,
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to view the program"),
		),
	}),

	zValidator("query", EventProgramModel.GetAll.Query),

	async (c) => {
		if (!EventAccess.can(c, "program:view")) {
			return APIResponse.forbidden(c, "You are not allowed to view the program");
		}

		const event = c.get("event");
		const { from, to } = c.req.valid("query") as EventProgramModel.GetAll.Query;

		const conditions = [eq(DB.Tables.programItems.event_id, event.id)];
		if (from !== undefined) conditions.push(gt(DB.Tables.programItems.end_at, from));
		if (to !== undefined) conditions.push(lt(DB.Tables.programItems.start_at, to));

		const items = await DB.instance()
			.select()
			.from(DB.Tables.programItems)
			.where(and(...conditions))
			.orderBy(asc(DB.Tables.programItems.start_at), asc(DB.Tables.programItems.id))
			.all();

		return APIResponse.success(c, "Program items retrieved successfully", await toResponse(c, items));
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create program item",
		description:
			"Add a Programmpunkt with responsible staff and linked documents. Requires leader rights.",
		tags: [DOCS_TAGS.EVENTS.PROGRAM],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Program item created successfully", EventProgramModel.Create.Response),
			APIResponseSpec.badRequest(BAD_REQUEST_MESSAGES),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the program"),
		),
	}),

	zValidator("json", EventProgramModel.Create.Body),

	async (c) => {
		if (!EventAccess.can(c, "program:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the program");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const { responsible_user_ids, file_ids, ...body } = c.req.valid(
			"json",
		) as EventProgramModel.Create.Body;

		const refError = await validateRefs(event.id, { responsible_user_ids, file_ids });
		if (refError) return APIResponse.badRequest(c, refError);

		let item: DB.Models.ProgramItem;
		try {
			item = await DB.instance().transaction(async (tx: DrizzleDB) => {
				const created = await tx
					.insert(DB.Tables.programItems)
					.values({ ...body, event_id: event.id, created_by: userId })
					.returning()
					.get();
				await replaceResponsibles(created.id, responsible_user_ids, tx);
				await replaceFiles(created.id, file_ids, tx);
				return created;
			});
		} catch (error: any) {
			Logger.error("Failed to create program item", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to create program item");
		}

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "program_item",
			entityId: item.id,
			summary: `Programmpunkt „${item.title}“ angelegt`,
		});

		await notifyResponsibles(event, item, responsible_user_ids, userId);

		const [result] = await toResponse(c, [item]);
		return APIResponse.created(c, "Program item created successfully", result!);
	},
);

router.use("/:programItemId/*", zValidator("param", EventProgramModel.Params), async (c, next) => {
	const event = c.get("event");
	const programItemId = EventProgramModel.Params.shape.programItemId.safeParse(
		c.req.param("programItemId"),
	);
	if (!programItemId.success) return APIResponse.badRequest(c, "Invalid program item id");

	const programItem = await DB.instance()
		.select()
		.from(DB.Tables.programItems)
		.where(
			and(
				eq(DB.Tables.programItems.id, programItemId.data),
				eq(DB.Tables.programItems.event_id, event.id),
			),
		)
		.get();

	if (!programItem) return APIResponse.notFound(c, "Program item not found");

	c.set("programItem", programItem);
	await next();
});

router.put(
	"/:programItemId",

	APIRouteSpec.authenticated({
		summary: "Update program item",
		description:
			"Update a Programmpunkt. Drag & drop in the week view sends only `start_at`/`end_at`. `responsible_user_ids` and `file_ids`, when given, replace the current sets.",
		tags: [DOCS_TAGS.EVENTS.PROGRAM],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Program item updated successfully", EventProgramModel.Update.Response),
			APIResponseSpec.badRequest(BAD_REQUEST_MESSAGES),
			APIResponseSpec.notFound("Program item not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the program"),
		),
	}),

	zValidator("json", EventProgramModel.Update.Body),

	async (c) => {
		if (!EventAccess.can(c, "program:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the program");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const item = c.get("programItem");
		const { responsible_user_ids, file_ids, ...body } = c.req.valid(
			"json",
		) as EventProgramModel.Update.Body;

		const startAt = body.start_at ?? item.start_at;
		const endAt = body.end_at ?? item.end_at;
		if (endAt <= startAt) {
			return APIResponse.badRequest(c, "end_at must be after start_at");
		}

		const refError = await validateRefs(event.id, { responsible_user_ids, file_ids });
		if (refError) return APIResponse.badRequest(c, refError);

		const previousResponsibles = await getResponsibleIds(item.id);

		let updated: DB.Models.ProgramItem;
		try {
			updated = await DB.instance().transaction(async (tx: DrizzleDB) => {
				const row = await tx
					.update(DB.Tables.programItems)
					.set({ ...body, updated_at: Date.now() })
					.where(eq(DB.Tables.programItems.id, item.id))
					.returning()
					.get();
				if (responsible_user_ids !== undefined) {
					await replaceResponsibles(item.id, responsible_user_ids, tx);
				}
				if (file_ids !== undefined) {
					await replaceFiles(item.id, file_ids, tx);
				}
				return row;
			});
		} catch (error: any) {
			Logger.error("Failed to update program item", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to update program item");
		}

		const onlyMoved = Object.entries(body).every(
			([key, value]) => key === "start_at" || key === "end_at" || value === undefined,
		);
		const moved = body.start_at !== undefined || body.end_at !== undefined;

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "update",
			entityType: "program_item",
			entityId: item.id,
			summary:
				onlyMoved && moved && responsible_user_ids === undefined && file_ids === undefined
					? `Programmpunkt „${updated.title}“ verschoben`
					: `Programmpunkt „${updated.title}“ bearbeitet`,
			metadata: {
				fields: [
					...Object.keys(body),
					...(responsible_user_ids !== undefined ? ["responsible_user_ids"] : []),
					...(file_ids !== undefined ? ["file_ids"] : []),
				],
			},
		});

		if (responsible_user_ids !== undefined) {
			await notifyResponsibles(
				event,
				updated,
				responsible_user_ids.filter((id) => !previousResponsibles.includes(id)),
				userId,
			);
		}

		const [result] = await toResponse(c, [updated]);
		return APIResponse.success(c, "Program item updated successfully", result!);
	},
);

router.delete(
	"/:programItemId",

	APIRouteSpec.authenticated({
		summary: "Delete program item",
		description:
			"Delete a Programmpunkt. Linked documents stay in the document library. Requires leader rights.",
		tags: [DOCS_TAGS.EVENTS.PROGRAM],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Program item deleted successfully"),
			APIResponseSpec.notFound("Program item not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the program"),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "program:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the program");
		}

		const item = c.get("programItem");

		await DB.instance()
			.delete(DB.Tables.programItems)
			.where(eq(DB.Tables.programItems.id, item.id))
			.run();

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: c.get("event").id,
			action: "delete",
			entityType: "program_item",
			entityId: item.id,
			summary: `Programmpunkt „${item.title}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "Program item deleted successfully");
	},
);

router.post(
	"/:programItemId/duplicate",

	APIRouteSpec.authenticated({
		summary: "Duplicate program item",
		description:
			"Copy a Programmpunkt (incl. responsible staff and linked documents) to a new start time, keeping its duration.",
		tags: [DOCS_TAGS.EVENTS.PROGRAM],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created(
				"Program item duplicated successfully",
				EventProgramModel.Duplicate.Response,
			),
			APIResponseSpec.notFound("Program item not found"),
			APIResponseSpec.forbidden("You are not allowed to manage the program"),
		),
	}),

	zValidator("json", EventProgramModel.Duplicate.Body),

	async (c) => {
		if (!EventAccess.can(c, "program:manage")) {
			return APIResponse.forbidden(c, "You are not allowed to manage the program");
		}

		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const item = c.get("programItem");
		const { start_at } = c.req.valid("json") as EventProgramModel.Duplicate.Body;

		const responsibleIds = await getResponsibleIds(item.id);
		const fileIds = await getFileIds(item.id);

		let copy: DB.Models.ProgramItem;
		try {
			copy = await DB.instance().transaction(async (tx: DrizzleDB) => {
				const created = await tx
					.insert(DB.Tables.programItems)
					.values({
						event_id: event.id,
						title: item.title,
						description: item.description,
						location: item.location,
						category: item.category,
						color: item.color,
						start_at,
						end_at: start_at + (item.end_at - item.start_at),
						created_by: userId,
					})
					.returning()
					.get();
				await replaceResponsibles(created.id, responsibleIds, tx);
				await replaceFiles(created.id, fileIds, tx);
				return created;
			});
		} catch (error: any) {
			Logger.error("Failed to duplicate program item", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to duplicate program item");
		}

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "program_item",
			entityId: copy.id,
			summary: `Programmpunkt „${copy.title}“ dupliziert`,
			metadata: { source_id: item.id },
		});

		await notifyResponsibles(event, copy, responsibleIds, userId);

		const [result] = await toResponse(c, [copy]);
		return APIResponse.created(c, "Program item duplicated successfully", result!);
	},
);
