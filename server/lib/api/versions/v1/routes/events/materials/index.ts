import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { Inventory, MaterialPeriod } from "../../../../../../materials/inventory";
import { MaterialService, type MaterialViewer } from "../../../../../../materials/service";
import { inOrg, OrgContext } from "../../../../../../orgs/context";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { EventAccess, type EventRouterEnv } from "../../../../../utils/eventAccess";
import { Notifier } from "../../../../../utils/notifications";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { EventMaterialsModel } from "./model";

type MaterialsEnv = {
	Variables: EventRouterEnv["Variables"] & {
		material: DB.Models.EventMaterial;
		request: DB.Models.MaterialRequest;
	};
};

/**
 * An event's material list ("Material"): inventory the Leitung books, things to buy, things team
 * members bring, where things are and where they are used, the packing list — and the requests
 * of team members who don't see the inventory.
 */
export const router = new Hono<MaterialsEnv>().basePath("/:eventId/materials");

const T = DB.Tables;
const tags = [DOCS_TAGS.EVENTS.MATERIALS];

const FORBIDDEN_VIEW = "You are not allowed to see the material of this event";
const FORBIDDEN_MANAGE = "Only the event's leaders can do this";
const FORBIDDEN_CONTRIBUTE = "You are not allowed to add material to this event";
const NOT_ENOUGH = "Not enough units available";

function viewer(c: Context<MaterialsEnv>): MaterialViewer {
	return { userId: c.get("eventAccess").userId, manage: EventAccess.can(c, "materials:manage") };
}

async function one(c: Context<MaterialsEnv>, id: number) {
	const [material] = await MaterialService.list(c.get("event"), viewer(c), [id]);
	return material!;
}

async function oneRequest(c: Context<MaterialsEnv>, id: number) {
	const [request] = await MaterialService.requests(c.get("event"), viewer(c), [id]);
	return request!;
}

function quantityLabel(name: string, quantity: number) {
	return quantity === 1 ? `„${name}“` : `„${name}“ (${quantity}×)`;
}

async function loadResource(id: number) {
	return await DB.instance()
		.select()
		.from(T.orgResources)
		.where(and(inOrg(T.orgResources), eq(T.orgResources.id, id)))
		.get();
}

async function loadProgramItem(eventId: number, id: number) {
	return await DB.instance()
		.select()
		.from(T.programItems)
		.where(
			and(inOrg(T.programItems), eq(T.programItems.id, id), eq(T.programItems.event_id, eventId)),
		)
		.get();
}

/** Link an entry to a program item or date (or change the quantity of an existing link). */
async function upsertLink(
	materialId: number,
	target: { program_item_id: number | null; occurrence_id: number | null },
	quantity: number | null,
) {
	const existing = await DB.instance()
		.select()
		.from(T.materialLinks)
		.where(
			and(
				inOrg(T.materialLinks),
				eq(T.materialLinks.material_id, materialId),
				target.program_item_id !== null
					? eq(T.materialLinks.program_item_id, target.program_item_id)
					: eq(T.materialLinks.occurrence_id, target.occurrence_id!),
			),
		)
		.get();
	if (existing) {
		await DB.instance()
			.update(T.materialLinks)
			.set({ quantity })
			.where(and(inOrg(T.materialLinks), eq(T.materialLinks.id, existing.id)))
			.run();
		return;
	}
	await DB.instance()
		.insert(T.materialLinks)
		.values({ ...target, material_id: materialId, quantity, org_id: OrgContext.id() })
		.run();
}

/** Tell who asked how their request was answered (not when they answered it themselves). */
async function notifyAnswer(
	c: Context<MaterialsEnv>,
	request: DB.Models.MaterialRequest,
	text: string,
) {
	await Notifier.notify(
		[request.requested_by],
		{
			type: "material_answered",
			title: `Deine Anfrage „${request.name}“: ${text}`,
			body: c.get("event").name,
			link: `/events/${c.get("event").id}/materials/requests`,
		},
		{ excludeUserId: c.get("eventAccess").userId },
	);
}

// --- list, catalog, period ----------------------------------------------------------------------

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List event material",
		description:
			"The event's material list (inventory bookings, things to buy, things team members bring) and the requests. The whole team sees it; inventory items show their details, never other events' bookings.",
		tags,

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Material retrieved successfully", EventMaterialsModel.GetAll.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden(FORBIDDEN_VIEW),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "materials:view")) return APIResponse.forbidden(c, FORBIDDEN_VIEW);
		const event = c.get("event");

		return APIResponse.success(c, "Material retrieved successfully", {
			period: MaterialService.period(event),
			items: await MaterialService.list(event, viewer(c)),
			requests: await MaterialService.requests(event, viewer(c)),
		} satisfies EventMaterialsModel.GetAll.Response);
	},
);

router.get(
	"/catalog",

	APIRouteSpec.authenticated({
		summary: "Inventory for this event",
		description:
			"The organisation's inventory with how many units this event can still book on the days of its material period (Leitung). Other events' bookings only count, they are not named.",
		tags,

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Inventory retrieved successfully",
				EventMaterialsModel.Catalog.Response,
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden(FORBIDDEN_MANAGE),
		),
	}),

	async (c) => {
		if (!EventAccess.can(c, "materials:manage")) return APIResponse.forbidden(c, FORBIDDEN_MANAGE);
		const event = c.get("event");

		const resources = await DB.instance()
			.select()
			.from(T.orgResources)
			.where(inOrg(T.orgResources))
			.orderBy(T.orgResources.category, T.orgResources.name)
			.all();
		const taken = await Inventory.takenByOthers(event);
		const booked = await Inventory.bookedBy(event.id);
		const onOrder = await Inventory.onOrder();

		return APIResponse.success(
			c,
			"Inventory retrieved successfully",
			resources.map((resource) => {
				const others = taken.get(resource.id) ?? 0;
				const here = booked.get(resource.id) ?? 0;
				return {
					id: resource.id,
					name: resource.name,
					category: resource.category,
					brand: resource.brand,
					size: resource.size,
					condition: resource.condition,
					consumable: resource.consumable,
					location: resource.location,
					notes: resource.notes,
					quantity: resource.quantity,
					taken: others,
					booked_here: here,
					free: Math.max(0, resource.quantity - others - here),
					on_order: onOrder.get(resource.id) ?? 0,
				};
			}) satisfies EventMaterialsModel.Catalog.Response,
		);
	},
);

router.put(
	"/period",

	APIRouteSpec.authenticated({
		summary: "Set the material period",
		description: `Days the material is needed before the start and after the end (at most ${MaterialPeriod.MAX_EXTRA_DAYS} each); bookings hold the inventory for that longer period. Not for recurring events. Fails with 409 when the inventory isn't free on the added days.`,
		tags,

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Period updated successfully", EventMaterialsModel.SetPeriod.Response),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden(FORBIDDEN_MANAGE),
			APIResponseSpec.conflict("Not enough units available on the added days: …"),
		),
	}),

	zValidator("json", EventMaterialsModel.SetPeriod.Body),

	async (c) => {
		if (!EventAccess.can(c, "materials:manage")) return APIResponse.forbidden(c, FORBIDDEN_MANAGE);
		const event = c.get("event");
		const body = c.req.valid("json") as EventMaterialsModel.SetPeriod.Body;
		if (event.type === "recurring") {
			return APIResponse.badRequest(c, "A recurring event holds material on its dates only");
		}

		const widened =
			body.days_before > event.material_days_before || body.days_after > event.material_days_after;
		if (widened) {
			const booked = await Inventory.bookedBy(event.id);
			const taken = await Inventory.takenByOthers(event, [...booked.keys()], {
				material_days_before: body.days_before,
				material_days_after: body.days_after,
			});
			const short: string[] = [];
			for (const [resourceId, units] of booked) {
				const resource = await loadResource(resourceId);
				if (resource && (taken.get(resourceId) ?? 0) + units > resource.quantity)
					short.push(resource.name);
			}
			if (short.length) {
				return APIResponse.conflict(
					c,
					`Not enough units available on the added days: ${short.join(", ")}`,
				);
			}
		}

		const updated = await DB.instance()
			.update(T.events)
			.set({
				material_days_before: body.days_before,
				material_days_after: body.days_after,
				updated_at: Date.now(),
			})
			.where(and(inOrg(T.events), eq(T.events.id, event.id)))
			.returning()
			.get();

		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: event.id,
			action: "update",
			entityType: "material",
			summary: `Materialzeitraum: ${body.days_before} Tag(e) vorher, ${body.days_after} Tag(e) danach`,
		});

		return APIResponse.success(c, "Period updated successfully", MaterialService.period(updated)!);
	},
);

// --- requests -------------------------------------------------------------------------------------

router.post(
	"/requests",

	APIRouteSpec.authenticated({
		summary: "Ask for material",
		description:
			"Ask the Leitung for something by name (anyone on the team; the inventory stays hidden). The event's leaders are notified.",
		tags,

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created(
				"Request created successfully",
				EventMaterialsModel.CreateRequest.Response,
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden(FORBIDDEN_CONTRIBUTE),
		),
	}),

	zValidator("json", EventMaterialsModel.CreateRequest.Body),

	async (c) => {
		if (!EventAccess.can(c, "materials:contribute"))
			return APIResponse.forbidden(c, FORBIDDEN_CONTRIBUTE);
		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const body = c.req.valid("json") as EventMaterialsModel.CreateRequest.Body;

		if (body.program_item_id && !(await loadProgramItem(event.id, body.program_item_id))) {
			return APIResponse.badRequest(c, "The program item does not belong to this event");
		}

		const request = await DB.instance()
			.insert(T.materialRequests)
			.values({ ...body, event_id: event.id, requested_by: userId, org_id: OrgContext.id() })
			.returning()
			.get();

		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "material_request",
			entityId: request.id,
			summary: `${quantityLabel(request.name, request.quantity)} angefragt`,
		});

		await Notifier.notify(
			await MaterialService.leaderIds(event.id),
			{
				type: "material_requested",
				title: `Material angefragt: ${request.quantity === 1 ? request.name : `${request.quantity}× ${request.name}`}`,
				body: event.name,
				link: `/events/${event.id}/materials/requests`,
			},
			{ excludeUserId: userId },
		);

		return APIResponse.created(c, "Request created successfully", await oneRequest(c, request.id));
	},
);

router.use(
	"/requests/:requestId/*",
	zValidator("param", EventMaterialsModel.RequestParams),
	async (c, next) => {
		const requestId = EventMaterialsModel.RequestParams.shape.requestId.safeParse(
			c.req.param("requestId"),
		);
		if (!requestId.success) return APIResponse.badRequest(c, "Invalid request id");
		if (!EventAccess.can(c, "materials:view")) return APIResponse.forbidden(c, FORBIDDEN_VIEW);

		const request = await DB.instance()
			.select()
			.from(T.materialRequests)
			.where(
				and(
					inOrg(T.materialRequests),
					eq(T.materialRequests.id, requestId.data),
					eq(T.materialRequests.event_id, c.get("event").id),
				),
			)
			.get();
		if (!request) return APIResponse.notFound(c, "Request not found");

		c.set("request", request);
		await next();
	},
);

router.put(
	"/requests/:requestId",

	APIRouteSpec.authenticated({
		summary: "Update a material request",
		description:
			"Who asked may change it while it is open. The Leitung may change everything and decides: `done` (settled), `rejected` (with `answer`), or `open` again; who asked is notified. A request is also done by itself once its answers cover the quantity.",
		tags,

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success(
				"Request updated successfully",
				EventMaterialsModel.UpdateRequest.Response,
			),
			APIResponseSpec.notFound("Request not found"),
			APIResponseSpec.forbidden("You are not allowed to change this request"),
		),
	}),

	zValidator("json", EventMaterialsModel.UpdateRequest.Body),

	async (c) => {
		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const request = c.get("request");
		const body = c.req.valid("json") as EventMaterialsModel.UpdateRequest.Body;
		const manage = EventAccess.can(c, "materials:manage");

		const mine = request.requested_by === userId && request.status === "open";
		const decides = body.status !== undefined || body.answer !== undefined;
		if (!manage && (!mine || decides || !EventAccess.can(c, "materials:contribute"))) {
			return APIResponse.forbidden(c, "You are not allowed to change this request");
		}
		if (body.program_item_id && !(await loadProgramItem(event.id, body.program_item_id))) {
			return APIResponse.badRequest(c, "The program item does not belong to this event");
		}

		const statusChanged = body.status !== undefined && body.status !== request.status;
		await DB.instance()
			.update(T.materialRequests)
			.set({
				...body,
				...(statusChanged
					? {
							decided_by: body.status === "open" ? null : userId,
							decided_at: body.status === "open" ? null : Date.now(),
						}
					: {}),
				updated_at: Date.now(),
			})
			.where(and(inOrg(T.materialRequests), eq(T.materialRequests.id, request.id)))
			.returning()
			.get();
		// A changed quantity can settle it (or open it again).
		const updated = (await MaterialService.settle(request.id))!;

		const STATUS_TEXT = { open: "wieder offen", done: "erledigt", rejected: "abgelehnt" } as const;
		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "update",
			entityType: "material_request",
			entityId: request.id,
			summary: statusChanged
				? `Anfrage ${quantityLabel(updated.name, updated.quantity)} ${STATUS_TEXT[updated.status]}`
				: `Anfrage ${quantityLabel(updated.name, updated.quantity)} bearbeitet`,
		});
		if (statusChanged && updated.status !== "open") {
			await notifyAnswer(
				c,
				updated,
				updated.status === "rejected"
					? `abgelehnt${updated.answer ? ` – ${updated.answer}` : ""}`
					: `erledigt${updated.answer ? ` – ${updated.answer}` : ""}`,
			);
		}

		return APIResponse.success(c, "Request updated successfully", await oneRequest(c, request.id));
	},
);

router.delete(
	"/requests/:requestId",

	APIRouteSpec.authenticated({
		summary: "Delete a material request",
		description:
			"Who asked (while it is open) or the Leitung. Entries that answered it stay on the list.",
		tags,

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Request deleted successfully"),
			APIResponseSpec.notFound("Request not found"),
			APIResponseSpec.forbidden("You are not allowed to delete this request"),
		),
	}),

	async (c) => {
		const { userId } = c.get("eventAccess");
		const request = c.get("request");
		const mine =
			request.requested_by === userId &&
			request.status === "open" &&
			EventAccess.can(c, "materials:contribute");
		if (!EventAccess.can(c, "materials:manage") && !mine) {
			return APIResponse.forbidden(c, "You are not allowed to delete this request");
		}

		await DB.instance()
			.delete(T.materialRequests)
			.where(and(inOrg(T.materialRequests), eq(T.materialRequests.id, request.id)))
			.run();

		await AuditLog.record({
			userId,
			eventId: c.get("event").id,
			action: "delete",
			entityType: "material_request",
			entityId: request.id,
			summary: `Anfrage ${quantityLabel(request.name, request.quantity)} gelöscht`,
		});

		return APIResponse.successNoData(c, "Request deleted successfully");
	},
);

// --- entries --------------------------------------------------------------------------------------

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Add material",
		description:
			"`inventory` (Leitung): book units of an inventory item for the material period — 409 when other events on the same days leave too few. `purchase` (Leitung): something to buy, with an optional estimate and buyer from the team. `own` (anyone on the team): something you bring; the Leitung may name another team member. With `request_id` it answers that open request: linked to its program item, who asked is notified, and the request is done once the answers cover it.",
		tags,

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Material added successfully", EventMaterialsModel.Create.Response),
			APIResponseSpec.badRequest(
				"Inventory item not found / A name is required / … is not on the event's team / The request is not open / Syntax or validation error in request",
			),
			APIResponseSpec.notFound("Event not found"),
			APIResponseSpec.forbidden(FORBIDDEN_MANAGE),
			APIResponseSpec.conflict(NOT_ENOUGH),
		),
	}),

	zValidator("json", EventMaterialsModel.Create.Body),

	async (c) => {
		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const body = c.req.valid("json") as EventMaterialsModel.Create.Body;
		const manage = EventAccess.can(c, "materials:manage");

		if (body.kind === "own" ? !EventAccess.can(c, "materials:contribute") : !manage) {
			return APIResponse.forbidden(c, body.kind === "own" ? FORBIDDEN_CONTRIBUTE : FORBIDDEN_MANAGE);
		}

		let resource: DB.Models.OrgResource | undefined;
		if (body.kind === "inventory") {
			if (!body.resource_id) return APIResponse.badRequest(c, "Inventory item not found");
			resource = await loadResource(body.resource_id);
			if (!resource) return APIResponse.badRequest(c, "Inventory item not found");
			if (!(await Inventory.fits(event, resource, body.quantity))) {
				return APIResponse.conflict(c, NOT_ENOUGH);
			}
		} else if (!body.name) {
			return APIResponse.badRequest(c, "A name is required");
		}

		const ownerId = body.kind === "own" ? (manage ? (body.owner_id ?? userId) : userId) : null;
		if (
			ownerId !== null &&
			ownerId !== userId &&
			!(await MaterialService.isTeamMember(event.id, ownerId))
		) {
			return APIResponse.badRequest(c, "The person who brings it is not on the event's team");
		}
		const buyerId = body.kind === "purchase" ? body.buyer_id : null;
		if (buyerId && !(await MaterialService.isTeamMember(event.id, buyerId))) {
			return APIResponse.badRequest(c, "The buyer is not on the event's team");
		}

		let request: DB.Models.MaterialRequest | undefined;
		if (body.request_id) {
			request = await DB.instance()
				.select()
				.from(T.materialRequests)
				.where(
					and(
						inOrg(T.materialRequests),
						eq(T.materialRequests.id, body.request_id),
						eq(T.materialRequests.event_id, event.id),
					),
				)
				.get();
			if (!request || request.status !== "open")
				return APIResponse.badRequest(c, "The request is not open");
		}

		const material = await DB.instance()
			.insert(T.eventMaterials)
			.values({
				event_id: event.id,
				kind: body.kind,
				resource_id: resource?.id ?? null,
				name: resource ? null : body.name,
				quantity: body.quantity,
				location: body.location,
				notes: body.notes,
				owner_id: ownerId,
				request_id: request?.id ?? null,
				estimated_cents: body.kind === "purchase" ? body.estimated_cents : null,
				buyer_id: buyerId,
				created_by: userId,
				org_id: OrgContext.id(),
			})
			.returning()
			.get();

		const name = resource?.name ?? material.name!;
		const KIND_TEXT = {
			inventory: "aus dem Lager gebucht",
			purchase: "zum Kaufen vorgemerkt",
			own: "wird mitgebracht",
		} as const;
		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "create",
			entityType: "material",
			entityId: material.id,
			summary: `${quantityLabel(name, material.quantity)} ${KIND_TEXT[material.kind]}`,
		});

		if (ownerId !== null && ownerId !== userId) {
			await Notifier.notify([ownerId], {
				type: "material_assigned",
				title: `Du bringst mit: ${quantityLabel(name, material.quantity)}`,
				body: event.name,
				link: `/events/${event.id}/materials`,
			});
		}
		if (buyerId && buyerId !== userId) {
			await Notifier.notify([buyerId], {
				type: "material_assigned",
				title: `Du kaufst ein: ${quantityLabel(name, material.quantity)}`,
				body: event.name,
				link: `/events/${event.id}/materials`,
			});
		}

		if (request) {
			if (request.program_item_id) {
				await upsertLink(
					material.id,
					{ program_item_id: request.program_item_id, occurrence_id: null },
					Math.min(material.quantity, request.quantity),
				);
			}
			await MaterialService.settle(request.id);
			const owner = ownerId === null ? null : (await UserSummary.fetchMap([ownerId])).get(ownerId);
			await notifyAnswer(
				c,
				request,
				material.kind === "inventory"
					? `kommt aus dem Lager (${material.quantity}×)`
					: material.kind === "purchase"
						? `wird gekauft (${material.quantity}×)`
						: `${owner?.display_name ?? "jemand"} bringt es mit (${material.quantity}×)`,
			);
		}

		return APIResponse.created(c, "Material added successfully", await one(c, material.id));
	},
);

router.use("/:materialId/*", zValidator("param", EventMaterialsModel.Params), async (c, next) => {
	const materialId = EventMaterialsModel.Params.shape.materialId.safeParse(
		c.req.param("materialId"),
	);
	if (!materialId.success) return APIResponse.badRequest(c, "Invalid material id");
	if (!EventAccess.can(c, "materials:view")) return APIResponse.forbidden(c, FORBIDDEN_VIEW);

	const material = await DB.instance()
		.select()
		.from(T.eventMaterials)
		.where(
			and(
				inOrg(T.eventMaterials),
				eq(T.eventMaterials.id, materialId.data),
				eq(T.eventMaterials.event_id, c.get("event").id),
			),
		)
		.get();
	if (!material) return APIResponse.notFound(c, "Material not found");

	c.set("material", material);
	await next();
});

router.put(
	"/:materialId",

	APIRouteSpec.authenticated({
		summary: "Update material",
		description:
			"Anyone on the team: `location` and the packing list (`packed`, `returned`). The Leitung, and who brings an `own` entry: name, quantity, notes. The Leitung: estimate and buyer of a purchase, and `used_quantity` of a consumable inventory item (the difference comes off or back on the stock). A larger inventory quantity must be free (409).",
		tags,

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Material updated successfully", EventMaterialsModel.Update.Response),
			APIResponseSpec.notFound("Material not found"),
			APIResponseSpec.forbidden("You are not allowed to change this"),
			APIResponseSpec.conflict(NOT_ENOUGH),
		),
	}),

	zValidator("json", EventMaterialsModel.Update.Body),

	async (c) => {
		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const material = c.get("material");
		const body = c.req.valid("json") as EventMaterialsModel.Update.Body;
		const manage = EventAccess.can(c, "materials:manage");
		const contribute = EventAccess.can(c, "materials:contribute");
		const isOwner = material.kind === "own" && material.owner_id === userId;
		const forbidden = () => APIResponse.forbidden(c, "You are not allowed to change this");

		const teamFields =
			body.location !== undefined || body.packed !== undefined || body.returned !== undefined;
		const ownerFields =
			body.name !== undefined || body.quantity !== undefined || body.notes !== undefined;
		const leaderFields =
			body.estimated_cents !== undefined ||
			body.buyer_id !== undefined ||
			body.used_quantity !== undefined;
		if (teamFields && !contribute) return forbidden();
		if (ownerFields && !(manage || (isOwner && contribute))) return forbidden();
		if (leaderFields && !manage) return forbidden();

		if (body.name !== undefined && material.kind === "inventory") {
			return APIResponse.badRequest(c, "An inventory entry is named like its inventory item");
		}
		if (
			(body.estimated_cents !== undefined || body.buyer_id !== undefined) &&
			material.kind !== "purchase"
		) {
			return APIResponse.badRequest(c, "Only purchases have an estimate and a buyer");
		}
		if (body.buyer_id && !(await MaterialService.isTeamMember(event.id, body.buyer_id))) {
			return APIResponse.badRequest(c, "The buyer is not on the event's team");
		}

		const resource = material.resource_id ? await loadResource(material.resource_id) : undefined;
		if (body.used_quantity !== undefined && !resource?.consumable) {
			return APIResponse.badRequest(c, "Only consumable inventory items record what was used");
		}
		const quantity = body.quantity ?? material.quantity;
		const used = body.used_quantity !== undefined ? body.used_quantity : material.used_quantity;
		if (used !== null && used > quantity) {
			return APIResponse.badRequest(c, "More was used than was booked");
		}
		if (resource && body.quantity !== undefined && body.quantity > material.quantity) {
			if (!(await Inventory.fits(event, resource, body.quantity, material.id))) {
				return APIResponse.conflict(c, NOT_ENOUGH);
			}
		}

		const now = Date.now();
		const { packed, returned, ...fields } = body;
		await DB.instance()
			.update(T.eventMaterials)
			.set({
				...fields,
				...(packed !== undefined ? { packed_at: packed ? (material.packed_at ?? now) : null } : {}),
				...(returned !== undefined
					? { returned_at: returned ? (material.returned_at ?? now) : null }
					: {}),
				updated_at: now,
			})
			.where(and(inOrg(T.eventMaterials), eq(T.eventMaterials.id, material.id)))
			.run();

		// Used up: off the stock (or back on when corrected downwards), never below zero.
		const usedDelta = (used ?? 0) - (material.used_quantity ?? 0);
		if (resource && body.used_quantity !== undefined && usedDelta !== 0) {
			await DB.instance()
				.update(T.orgResources)
				.set({ quantity: Math.max(0, resource.quantity - usedDelta) })
				.where(and(inOrg(T.orgResources), eq(T.orgResources.id, resource.id)))
				.run();
		}
		if (material.request_id && body.quantity !== undefined)
			await MaterialService.settle(material.request_id);

		const name = resource?.name ?? body.name ?? material.name!;
		if (body.buyer_id && body.buyer_id !== material.buyer_id && body.buyer_id !== userId) {
			await Notifier.notify([body.buyer_id], {
				type: "material_assigned",
				title: `Du kaufst ein: ${quantityLabel(name, quantity)}`,
				body: event.name,
				link: `/events/${event.id}/materials`,
			});
		}

		// Packing ticks are routine; everything else goes into the log.
		if (ownerFields || leaderFields || body.location !== undefined) {
			await AuditLog.record({
				userId,
				eventId: event.id,
				action: "update",
				entityType: "material",
				entityId: material.id,
				summary:
					body.used_quantity !== undefined && usedDelta !== 0
						? `Verbrauch von „${name}“: ${used ?? 0} von ${quantity}`
						: `${quantityLabel(name, quantity)} bearbeitet`,
			});
		}

		return APIResponse.success(c, "Material updated successfully", await one(c, material.id));
	},
);

router.delete(
	"/:materialId",

	APIRouteSpec.authenticated({
		summary: "Remove material",
		description:
			"The Leitung, or who brings an `own` entry. Removing an inventory entry releases the booking; what was recorded as used stays off the stock.",
		tags,

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Material removed successfully"),
			APIResponseSpec.notFound("Material not found"),
			APIResponseSpec.forbidden("You are not allowed to remove this"),
		),
	}),

	async (c) => {
		const { userId } = c.get("eventAccess");
		const material = c.get("material");
		const isOwner =
			material.kind === "own" &&
			material.owner_id === userId &&
			EventAccess.can(c, "materials:contribute");
		if (!EventAccess.can(c, "materials:manage") && !isOwner) {
			return APIResponse.forbidden(c, "You are not allowed to remove this");
		}

		const resource = material.resource_id ? await loadResource(material.resource_id) : undefined;
		await DB.instance()
			.delete(T.eventMaterials)
			.where(and(inOrg(T.eventMaterials), eq(T.eventMaterials.id, material.id)))
			.run();
		if (material.request_id) await MaterialService.settle(material.request_id);

		await AuditLog.record({
			userId,
			eventId: c.get("event").id,
			action: "delete",
			entityType: "material",
			entityId: material.id,
			summary: `${quantityLabel(resource?.name ?? material.name ?? "", material.quantity)} entfernt`,
		});

		return APIResponse.successNoData(c, "Material removed successfully");
	},
);

router.post(
	"/:materialId/bought",

	APIRouteSpec.authenticated({
		summary: "Mark a purchase bought",
		description:
			"The Leitung or the buyer. With `to_inventory` (Leitung only, also for something bought earlier) it moves into the organisation's inventory: added to the stock of `resource_id` or a new item named like the entry, and booked for this event.",
		tags,

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Purchase updated successfully", EventMaterialsModel.Bought.Response),
			APIResponseSpec.notFound("Material not found"),
			APIResponseSpec.forbidden("You are not allowed to mark this bought"),
			APIResponseSpec.conflict("Already bought"),
		),
	}),

	zValidator("json", EventMaterialsModel.Bought.Body),

	async (c) => {
		const event = c.get("event");
		const { userId } = c.get("eventAccess");
		const material = c.get("material");
		const body = c.req.valid("json") as EventMaterialsModel.Bought.Body;
		const manage = EventAccess.can(c, "materials:manage");

		if (material.kind !== "purchase") return APIResponse.badRequest(c, "Only purchases are bought");
		const isBuyer = material.buyer_id === userId && EventAccess.can(c, "materials:contribute");
		if (!(manage || isBuyer) || (body.to_inventory && !manage)) {
			return APIResponse.forbidden(c, "You are not allowed to mark this bought");
		}
		if (material.bought_at !== null && !body.to_inventory)
			return APIResponse.conflict(c, "Already bought");

		const now = Date.now();
		let resource: DB.Models.OrgResource | undefined;
		if (body.to_inventory) {
			if (body.resource_id) {
				const existing = await loadResource(body.resource_id);
				if (!existing) return APIResponse.badRequest(c, "Inventory item not found");
				resource = await DB.instance()
					.update(T.orgResources)
					.set({ quantity: existing.quantity + material.quantity })
					.where(and(inOrg(T.orgResources), eq(T.orgResources.id, existing.id)))
					.returning()
					.get();
			} else {
				resource = await DB.instance()
					.insert(T.orgResources)
					.values({
						name: material.name!,
						category: body.category ?? "Allgemein",
						quantity: material.quantity,
						org_id: OrgContext.id(),
					})
					.returning()
					.get();
			}
		}

		await DB.instance()
			.update(T.eventMaterials)
			.set({
				bought_at: material.bought_at ?? now,
				...(resource ? { kind: "inventory" as const, resource_id: resource.id, name: null } : {}),
				updated_at: now,
			})
			.where(and(inOrg(T.eventMaterials), eq(T.eventMaterials.id, material.id)))
			.run();

		const label = quantityLabel(material.name!, material.quantity);
		await AuditLog.record({
			userId,
			eventId: event.id,
			action: "update",
			entityType: "material",
			entityId: material.id,
			summary: resource
				? `${label} gekauft und ins Inventar übernommen („${resource.name}“)`
				: `${label} gekauft`,
		});
		if (resource) {
			await AuditLog.record({
				userId,
				action: body.resource_id ? "update" : "create",
				entityType: "resource",
				entityId: resource.id,
				summary: `${material.quantity}× „${resource.name}“ von „${event.name}“ ins Inventar übernommen`,
			});
		}

		return APIResponse.success(c, "Purchase updated successfully", await one(c, material.id));
	},
);

router.post(
	"/:materialId/links",

	APIRouteSpec.authenticated({
		summary: "Link material to the program",
		description:
			"Anyone on the team: the entry is used at a program item or (recurring events) on a date, optionally with a quantity. Linking it again changes the quantity.",
		tags,

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Link saved successfully", EventMaterialsModel.AddLink.Response),
			APIResponseSpec.notFound("Material not found"),
			APIResponseSpec.forbidden(FORBIDDEN_CONTRIBUTE),
		),
	}),

	zValidator("json", EventMaterialsModel.AddLink.Body),

	async (c) => {
		if (!EventAccess.can(c, "materials:contribute"))
			return APIResponse.forbidden(c, FORBIDDEN_CONTRIBUTE);
		const event = c.get("event");
		const material = c.get("material");
		const body = c.req.valid("json") as EventMaterialsModel.AddLink.Body;

		let target = "";
		if (body.program_item_id) {
			const item = await loadProgramItem(event.id, body.program_item_id);
			if (!item) return APIResponse.badRequest(c, "The program item does not belong to this event");
			target = `„${item.title}“`;
		} else {
			const occurrence = await DB.instance()
				.select()
				.from(T.eventOccurrences)
				.where(
					and(
						inOrg(T.eventOccurrences),
						eq(T.eventOccurrences.id, body.occurrence_id!),
						eq(T.eventOccurrences.event_id, event.id),
					),
				)
				.get();
			if (!occurrence) return APIResponse.badRequest(c, "The date does not belong to this event");
			target = `den Termin am ${occurrence.date}`;
		}

		await upsertLink(material.id, body, body.quantity);

		const result = await one(c, material.id);
		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: event.id,
			action: "update",
			entityType: "material",
			entityId: material.id,
			summary: `„${result.name}“ für ${target} eingeplant`,
		});

		return APIResponse.success(c, "Link saved successfully", result);
	},
);

router.delete(
	"/:materialId/links/:linkId",

	APIRouteSpec.authenticated({
		summary: "Unlink material from the program",
		description: "Anyone on the team.",
		tags,

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Link removed successfully", EventMaterialsModel.AddLink.Response),
			APIResponseSpec.notFound("Link not found"),
			APIResponseSpec.forbidden(FORBIDDEN_CONTRIBUTE),
		),
	}),

	zValidator("param", EventMaterialsModel.LinkParams),

	async (c) => {
		if (!EventAccess.can(c, "materials:contribute"))
			return APIResponse.forbidden(c, FORBIDDEN_CONTRIBUTE);
		const material = c.get("material");
		const { linkId } = c.req.valid("param") as EventMaterialsModel.LinkParams;

		const removed = await DB.instance()
			.delete(T.materialLinks)
			.where(
				and(
					inOrg(T.materialLinks),
					eq(T.materialLinks.id, linkId),
					eq(T.materialLinks.material_id, material.id),
				),
			)
			.returning()
			.get();
		if (!removed) return APIResponse.notFound(c, "Link not found");

		const result = await one(c, material.id);
		await AuditLog.record({
			userId: c.get("eventAccess").userId,
			eventId: c.get("event").id,
			action: "update",
			entityType: "material",
			entityId: material.id,
			summary: `„${result.name}“ aus dem Programm genommen`,
		});

		return APIResponse.success(c, "Link removed successfully", result);
	},
);
