import { and, desc, eq, like, or } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../db";
import { APIResponse } from "../../../../utils/api-res";
import { getAuthUserId, requireOrgRole } from "../../../../utils/guards";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { PersonalNotesModel } from "./model";

type NotesEnv = { Variables: { note: DB.Models.Note } };

export const router = new Hono<NotesEnv>().basePath("/notes");

router.use("*", requireOrgRole("volunteer"));

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List personal notes",
		description: "List the caller's personal notes, pinned first, then most recently edited.",
		tags: [DOCS_TAGS.PERSONAL.NOTES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Notes retrieved successfully", PersonalNotesModel.GetAll.Response),
		),
	}),

	zValidator("query", PersonalNotesModel.GetAll.Query),

	async (c) => {
		const { search } = c.req.valid("query") as PersonalNotesModel.GetAll.Query;
		const pattern = search ? `%${search}%` : null;

		const notes = await DB.instance()
			.select()
			.from(DB.Tables.notes)
			.where(
				and(
					eq(DB.Tables.notes.scope, "personal"),
					eq(DB.Tables.notes.user_id, getAuthUserId(c)),
					pattern
						? or(like(DB.Tables.notes.title, pattern), like(DB.Tables.notes.content, pattern))
						: undefined,
				),
			)
			.orderBy(desc(DB.Tables.notes.pinned), desc(DB.Tables.notes.updated_at))
			.all();

		return APIResponse.success(c, "Notes retrieved successfully", notes);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create personal note",
		description: "Create a personal note only the caller can see.",
		tags: [DOCS_TAGS.PERSONAL.NOTES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Note created successfully", PersonalNotesModel.Create.Response),
		),
	}),

	zValidator("json", PersonalNotesModel.Create.Body),

	async (c) => {
		const userId = getAuthUserId(c);
		const body = c.req.valid("json") as PersonalNotesModel.Create.Body;

		const note = await DB.instance()
			.insert(DB.Tables.notes)
			.values({
				...body,
				scope: "personal",
				user_id: userId,
				created_by: userId,
				updated_by: userId,
			})
			.returning()
			.get();

		return APIResponse.created(c, "Note created successfully", note);
	},
);

router.use("/:noteId/*", zValidator("param", PersonalNotesModel.Params), async (c, next) => {
	const noteId = PersonalNotesModel.Params.shape.noteId.safeParse(c.req.param("noteId"));
	if (!noteId.success) return APIResponse.badRequest(c, "Invalid note id");

	const note = await DB.instance()
		.select()
		.from(DB.Tables.notes)
		.where(
			and(
				eq(DB.Tables.notes.id, noteId.data),
				eq(DB.Tables.notes.scope, "personal"),
				eq(DB.Tables.notes.user_id, getAuthUserId(c)),
			),
		)
		.get();

	if (!note) return APIResponse.notFound(c, "Note not found");

	c.set("note", note);
	await next();
});

router.get(
	"/:noteId",

	APIRouteSpec.authenticated({
		summary: "Get personal note",
		description: "Retrieve one of the caller's personal notes.",
		tags: [DOCS_TAGS.PERSONAL.NOTES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Note retrieved successfully", PersonalNotesModel.Note),
			APIResponseSpec.notFound("Note not found"),
		),
	}),

	async (c) => {
		return APIResponse.success(c, "Note retrieved successfully", c.get("note"));
	},
);

router.put(
	"/:noteId",

	APIRouteSpec.authenticated({
		summary: "Update personal note",
		description: "Update one of the caller's personal notes.",
		tags: [DOCS_TAGS.PERSONAL.NOTES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Note updated successfully", PersonalNotesModel.Update.Response),
			APIResponseSpec.notFound("Note not found"),
		),
	}),

	zValidator("json", PersonalNotesModel.Update.Body),

	async (c) => {
		const note = c.get("note");
		const body = c.req.valid("json") as PersonalNotesModel.Update.Body;

		const updated = await DB.instance()
			.update(DB.Tables.notes)
			.set({ ...body, updated_by: getAuthUserId(c), updated_at: Date.now() })
			.where(eq(DB.Tables.notes.id, note.id))
			.returning()
			.get();

		return APIResponse.success(c, "Note updated successfully", updated);
	},
);

router.delete(
	"/:noteId",

	APIRouteSpec.authenticated({
		summary: "Delete personal note",
		description: "Delete one of the caller's personal notes.",
		tags: [DOCS_TAGS.PERSONAL.NOTES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Note deleted successfully"),
			APIResponseSpec.notFound("Note not found"),
		),
	}),

	async (c) => {
		await DB.instance()
			.delete(DB.Tables.notes)
			.where(eq(DB.Tables.notes.id, c.get("note").id))
			.run();
		return APIResponse.successNoData(c, "Note deleted successfully");
	},
);
