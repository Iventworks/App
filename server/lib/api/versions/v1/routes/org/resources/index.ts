import { and, asc, eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { Inventory, MaterialPeriod } from "../../../../../../materials/inventory";
import { MaterialService } from "../../../../../../materials/service";
import { inOrg, OrgContext } from "../../../../../../orgs/context";
import { TimeUtils } from "../../../../../../utils/time";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import { EventSchedule } from "../../../../../utils/eventSchedule";
import { getAuthUserId } from "../../../../../utils/guards";
import { Notifier } from "../../../../../utils/notifications";
import { PermissionHelper } from "../../../../../utils/permissions";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { OrgResourcesModel } from "./model";

type ResourcesEnv = {
	Variables: { resource: DB.Models.OrgResource; purchase: DB.Models.ResourcePurchase };
};

/**
 * The organisation's inventory (tents, projectors, vans, …), what still has to be bought, and
 * which event has booked what — the core team's view. Events book through their material list
 * (`/events/{id}/materials`), which only shows what is free.
 */
export const router = new Hono<ResourcesEnv>().basePath("/resources");

const T = DB.Tables;
const tags = [DOCS_TAGS.ORG.RESOURCES];

function can(c: Context, permission: "org_resources:read" | "org_resources:write") {
	return PermissionHelper.can({ authContext: AuthHandler.AuthContext.get(c), permission });
}

const FORBIDDEN_READ = "Only the core team sees the inventory";
const FORBIDDEN_WRITE = "Only the core team can manage resources";

/** Inventory bookings (optionally filtered) joined with their event and resource. */
async function loadBookings(filter: { resourceIds?: number[]; eventId?: number; id?: number }) {
	if (filter.resourceIds && filter.resourceIds.length === 0) return [];
	return await DB.instance()
		.select({
			booking: T.eventMaterials,
			event: T.events,
			resource: {
				id: T.orgResources.id,
				name: T.orgResources.name,
				category: T.orgResources.category,
				quantity: T.orgResources.quantity,
			},
		})
		.from(T.eventMaterials)
		.innerJoin(T.events, and(inOrg(T.events), eq(T.events.id, T.eventMaterials.event_id)))
		.innerJoin(
			T.orgResources,
			and(inOrg(T.orgResources), eq(T.orgResources.id, T.eventMaterials.resource_id)),
		)
		.where(
			and(
				inOrg(T.eventMaterials),
				eq(T.eventMaterials.kind, "inventory"),
				filter.resourceIds ? inArray(T.eventMaterials.resource_id, filter.resourceIds) : undefined,
				filter.eventId ? eq(T.eventMaterials.event_id, filter.eventId) : undefined,
				filter.id ? eq(T.eventMaterials.id, filter.id) : undefined,
			),
		)
		.orderBy(asc(T.events.start_date), asc(T.eventMaterials.id))
		.all();
}

type BookingRow = Awaited<ReturnType<typeof loadBookings>>[number];

function toBookingWithResource(row: BookingRow): OrgResourcesModel.BookingWithResource {
	const period = MaterialPeriod.of(row.event);
	return {
		id: row.booking.id,
		quantity: row.booking.quantity,
		notes: row.booking.notes,
		used_quantity: row.booking.used_quantity,
		created_at: row.booking.created_at,
		event: {
			id: row.event.id,
			name: row.event.name,
			type: row.event.type,
			start_date: row.event.start_date,
			end_date: row.event.end_date,
			from: period.start_date,
			until: period.end_date,
		},
		resource: row.resource,
	};
}

async function toResponse(
	resources: DB.Models.OrgResource[],
): Promise<OrgResourcesModel.Resource[]> {
	const ids = resources.map((resource) => resource.id);
	const bookings = await loadBookings({ resourceIds: ids });
	const today = TimeUtils.today();
	// A recurring event only uses its bookings on the days of its dates.
	const periods = new Map(bookings.map((row) => [row.event.id, MaterialPeriod.of(row.event)]));
	const schedule = await EventSchedule.load([...periods.values()]);
	const purchases = ids.length
		? await DB.instance()
				.select()
				.from(T.resourcePurchases)
				.where(and(inOrg(T.resourcePurchases), inArray(T.resourcePurchases.resource_id, ids)))
				.orderBy(asc(T.resourcePurchases.created_at), asc(T.resourcePurchases.id))
				.all()
		: [];
	const buyers = await UserSummary.fetchMap(purchases.map((purchase) => purchase.buyer_id));

	return resources.map((resource) => {
		const own = bookings.filter((row) => row.booking.resource_id === resource.id);
		const ownPurchases = purchases
			.filter((purchase) => purchase.resource_id === resource.id)
			.map((purchase) => ({
				id: purchase.id,
				resource_id: purchase.resource_id,
				quantity: purchase.quantity,
				estimated_cents: purchase.estimated_cents,
				buyer: purchase.buyer_id ? (buyers.get(purchase.buyer_id) ?? null) : null,
				notes: purchase.notes,
				created_at: purchase.created_at,
			}));
		return {
			...resource,
			bookings: own.map((row) => {
				const { resource: _resource, ...booking } = toBookingWithResource(row);
				return booking;
			}),
			booked_now: own
				.filter((row) => row.event.status !== "cancelled")
				.filter((row) => schedule.takesPlaceOn(periods.get(row.event.id)!, today))
				// What a consumable used up has left the stock already.
				.reduce((sum, row) => sum + row.booking.quantity - (row.booking.used_quantity ?? 0), 0),
			purchases: ownPurchases,
			on_order: ownPurchases.reduce((sum, purchase) => sum + purchase.quantity, 0),
		};
	});
}

async function single(resourceId: number) {
	const resource = await DB.instance()
		.select()
		.from(T.orgResources)
		.where(and(inOrg(T.orgResources), eq(T.orgResources.id, resourceId)))
		.get();
	const [result] = await toResponse([resource!]);
	return result!;
}

/** A buyer must be someone from the core team (who can see this page). */
async function validBuyer(buyerId: number | null | undefined) {
	if (!buyerId) return true;
	const user = await DB.instance()
		.select({ role: T.users.role, suspended_at: T.users.suspended_at })
		.from(T.users)
		.where(and(inOrg(T.users), eq(T.users.id, buyerId)))
		.get();
	return !!user && !user.suspended_at && PermissionHelper.hasOrgRole(user.role, "core_team");
}

async function notifyBuyer(
	c: Context,
	buyerId: number | null,
	resource: DB.Models.OrgResource,
	quantity: number,
) {
	if (!buyerId) return;
	await Notifier.notify(
		[buyerId],
		{
			type: "material_assigned",
			title: `Du kaufst ein: ${quantity}× „${resource.name}“`,
			body: "Material & Ressourcen",
			link: "/core-team/resources",
		},
		{ excludeUserId: getAuthUserId(c) },
	);
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List resources",
		description:
			"The organisation's inventory with all bookings, how many units are in use today, and what is still to be bought (core team).",
		tags,

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Resources retrieved successfully", OrgResourcesModel.GetAll.Response),
			APIResponseSpec.forbidden(FORBIDDEN_READ),
		),
	}),

	async (c) => {
		if (!can(c, "org_resources:read")) return APIResponse.forbidden(c, FORBIDDEN_READ);

		const resources = await DB.instance()
			.select()
			.from(T.orgResources)
			.where(inOrg(T.orgResources))
			.orderBy(asc(T.orgResources.category), asc(T.orgResources.name))
			.all();

		return APIResponse.success(c, "Resources retrieved successfully", await toResponse(resources));
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create resource",
		description:
			"Add an item to the organisation's inventory (core team). With `purchase`, units still to be bought are added too; they can be booked once bought.",
		tags,

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Resource created successfully", OrgResourcesModel.Create.Response),
			APIResponseSpec.forbidden(FORBIDDEN_WRITE),
		),
	}),

	zValidator("json", OrgResourcesModel.Create.Body),

	async (c) => {
		if (!can(c, "org_resources:write")) return APIResponse.forbidden(c, FORBIDDEN_WRITE);

		const { purchase, ...body } = c.req.valid("json") as OrgResourcesModel.Create.Body;
		if (!(await validBuyer(purchase?.buyer_id))) {
			return APIResponse.badRequest(c, "The buyer must be someone from the core team");
		}

		const resource = await DB.instance()
			.insert(T.orgResources)
			.values({ ...body, org_id: OrgContext.id() })
			.returning()
			.get();
		if (purchase) {
			await DB.instance()
				.insert(T.resourcePurchases)
				.values({
					...purchase,
					resource_id: resource.id,
					created_by: getAuthUserId(c),
					org_id: OrgContext.id(),
				})
				.run();
		}

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "create",
			entityType: "resource",
			entityId: resource.id,
			summary: purchase
				? `Ressource „${resource.name}“ (${resource.quantity}×, ${purchase.quantity}× zu kaufen) angelegt`
				: `Ressource „${resource.name}“ (${resource.quantity}×) angelegt`,
		});
		if (purchase) await notifyBuyer(c, purchase.buyer_id, resource, purchase.quantity);

		return APIResponse.created(c, "Resource created successfully", await single(resource.id));
	},
);

// Literal `/bookings…` and `/purchases…` paths are registered before the `/:resourceId/*` loader.

router.get(
	"/bookings",

	APIRouteSpec.authenticated({
		summary: "List resource bookings",
		description: "All inventory bookings of events, optionally only those of one event (core team).",
		tags,

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success(
				"Bookings retrieved successfully",
				OrgResourcesModel.GetBookings.Response,
			),
			APIResponseSpec.forbidden(FORBIDDEN_READ),
		),
	}),

	zValidator("query", OrgResourcesModel.GetBookings.Query),

	async (c) => {
		if (!can(c, "org_resources:read")) return APIResponse.forbidden(c, FORBIDDEN_READ);

		const { event_id } = c.req.valid("query") as OrgResourcesModel.GetBookings.Query;
		const rows = await loadBookings({ eventId: event_id });

		return APIResponse.success(c, "Bookings retrieved successfully", rows.map(toBookingWithResource));
	},
);

router.delete(
	"/bookings/:bookingId",

	APIRouteSpec.authenticated({
		summary: "Delete resource booking",
		description: "Release a booking (core team): the entry leaves the event's material list.",
		tags,

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Booking deleted successfully"),
			APIResponseSpec.forbidden(FORBIDDEN_WRITE),
			APIResponseSpec.notFound("Booking not found"),
		),
	}),

	zValidator("param", OrgResourcesModel.BookingParams),

	async (c) => {
		if (!can(c, "org_resources:write")) return APIResponse.forbidden(c, FORBIDDEN_WRITE);

		const { bookingId } = c.req.valid("param") as OrgResourcesModel.BookingParams;
		const [row] = await loadBookings({ id: bookingId });
		if (!row) return APIResponse.notFound(c, "Booking not found");

		await DB.instance()
			.delete(T.eventMaterials)
			.where(and(inOrg(T.eventMaterials), eq(T.eventMaterials.id, bookingId)))
			.run();
		if (row.booking.request_id) await MaterialService.settle(row.booking.request_id);

		await AuditLog.record({
			userId: getAuthUserId(c),
			eventId: row.booking.event_id,
			action: "delete",
			entityType: "material",
			entityId: bookingId,
			summary: `Reservierung von „${row.resource.name}“ (${row.booking.quantity}×) aufgehoben`,
		});

		return APIResponse.successNoData(c, "Booking deleted successfully");
	},
);

router.use(
	"/purchases/:purchaseId/*",
	zValidator("param", OrgResourcesModel.PurchaseParams),
	async (c, next) => {
		const purchaseId = OrgResourcesModel.PurchaseParams.shape.purchaseId.safeParse(
			c.req.param("purchaseId"),
		);
		if (!purchaseId.success) return APIResponse.badRequest(c, "Invalid purchase id");
		if (!can(c, "org_resources:write")) return APIResponse.forbidden(c, FORBIDDEN_WRITE);

		const purchase = await DB.instance()
			.select()
			.from(T.resourcePurchases)
			.where(and(inOrg(T.resourcePurchases), eq(T.resourcePurchases.id, purchaseId.data)))
			.get();
		if (!purchase) return APIResponse.notFound(c, "Purchase not found");
		const resource = await DB.instance()
			.select()
			.from(T.orgResources)
			.where(and(inOrg(T.orgResources), eq(T.orgResources.id, purchase.resource_id)))
			.get();

		c.set("purchase", purchase);
		c.set("resource", resource!);
		await next();
	},
);

router.put(
	"/purchases/:purchaseId",

	APIRouteSpec.authenticated({
		summary: "Update a purchase",
		description: "Change quantity, estimate, buyer (core team) or notes of units still to be bought.",
		tags,

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success(
				"Purchase updated successfully",
				OrgResourcesModel.UpdatePurchase.Response,
			),
			APIResponseSpec.forbidden(FORBIDDEN_WRITE),
			APIResponseSpec.notFound("Purchase not found"),
		),
	}),

	zValidator("json", OrgResourcesModel.UpdatePurchase.Body),

	async (c) => {
		const purchase = c.get("purchase");
		const resource = c.get("resource");
		const body = c.req.valid("json") as OrgResourcesModel.UpdatePurchase.Body;
		if (!(await validBuyer(body.buyer_id))) {
			return APIResponse.badRequest(c, "The buyer must be someone from the core team");
		}

		const updated = await DB.instance()
			.update(T.resourcePurchases)
			.set(body)
			.where(and(inOrg(T.resourcePurchases), eq(T.resourcePurchases.id, purchase.id)))
			.returning()
			.get();

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "update",
			entityType: "resource",
			entityId: resource.id,
			summary: `Einkauf von „${resource.name}“ (${updated.quantity}×) bearbeitet`,
		});
		if (body.buyer_id && body.buyer_id !== purchase.buyer_id) {
			await notifyBuyer(c, body.buyer_id, resource, updated.quantity);
		}

		return APIResponse.success(c, "Purchase updated successfully", await single(resource.id));
	},
);

router.delete(
	"/purchases/:purchaseId",

	APIRouteSpec.authenticated({
		summary: "Delete a purchase",
		description: "Don't buy these units after all (core team).",
		tags,

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Purchase deleted successfully"),
			APIResponseSpec.forbidden(FORBIDDEN_WRITE),
			APIResponseSpec.notFound("Purchase not found"),
		),
	}),

	async (c) => {
		const purchase = c.get("purchase");
		const resource = c.get("resource");

		await DB.instance()
			.delete(T.resourcePurchases)
			.where(and(inOrg(T.resourcePurchases), eq(T.resourcePurchases.id, purchase.id)))
			.run();

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "update",
			entityType: "resource",
			entityId: resource.id,
			summary: `Einkauf von „${resource.name}“ (${purchase.quantity}×) gestrichen`,
		});

		return APIResponse.successNoData(c, "Purchase deleted successfully");
	},
);

router.post(
	"/purchases/:purchaseId/bought",

	APIRouteSpec.authenticated({
		summary: "Mark a purchase bought",
		description: "The units go into the stock and can be booked from now on (core team).",
		tags,

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Purchase bought successfully", OrgResourcesModel.Update.Response),
			APIResponseSpec.forbidden(FORBIDDEN_WRITE),
			APIResponseSpec.notFound("Purchase not found"),
		),
	}),

	async (c) => {
		const purchase = c.get("purchase");
		const resource = c.get("resource");

		await DB.instance()
			.update(T.orgResources)
			.set({ quantity: resource.quantity + purchase.quantity })
			.where(and(inOrg(T.orgResources), eq(T.orgResources.id, resource.id)))
			.run();
		await DB.instance()
			.delete(T.resourcePurchases)
			.where(and(inOrg(T.resourcePurchases), eq(T.resourcePurchases.id, purchase.id)))
			.run();

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "update",
			entityType: "resource",
			entityId: resource.id,
			summary: `${purchase.quantity}× „${resource.name}“ gekauft (Bestand ${resource.quantity + purchase.quantity})`,
		});

		return APIResponse.success(c, "Purchase bought successfully", await single(resource.id));
	},
);

router.use("/:resourceId/*", zValidator("param", OrgResourcesModel.Params), async (c, next) => {
	const resourceId = OrgResourcesModel.Params.shape.resourceId.safeParse(c.req.param("resourceId"));
	if (!resourceId.success) return APIResponse.badRequest(c, "Invalid resource id");

	const resource = await DB.instance()
		.select()
		.from(T.orgResources)
		.where(and(inOrg(T.orgResources), eq(T.orgResources.id, resourceId.data)))
		.get();

	if (!resource) return APIResponse.notFound(c, "Resource not found");

	c.set("resource", resource);
	await next();
});

router.put(
	"/:resourceId",

	APIRouteSpec.authenticated({
		summary: "Update resource",
		description: "Edit an inventory item (core team).",
		tags,

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Resource updated successfully", OrgResourcesModel.Update.Response),
			APIResponseSpec.forbidden(FORBIDDEN_WRITE),
			APIResponseSpec.notFound("Resource not found"),
		),
	}),

	zValidator("json", OrgResourcesModel.Update.Body),

	async (c) => {
		if (!can(c, "org_resources:write")) return APIResponse.forbidden(c, FORBIDDEN_WRITE);

		const resource = c.get("resource");
		const body = c.req.valid("json") as OrgResourcesModel.Update.Body;

		const updated = await DB.instance()
			.update(T.orgResources)
			.set(body)
			.where(and(inOrg(T.orgResources), eq(T.orgResources.id, resource.id)))
			.returning()
			.get();

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "update",
			entityType: "resource",
			entityId: resource.id,
			summary: `Ressource „${updated.name}“ bearbeitet`,
		});

		return APIResponse.success(c, "Resource updated successfully", await single(resource.id));
	},
);

router.delete(
	"/:resourceId",

	APIRouteSpec.authenticated({
		summary: "Delete resource",
		description:
			"Remove an inventory item together with its bookings (they leave the events' material lists) and purchases (core team).",
		tags,

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Resource deleted successfully"),
			APIResponseSpec.forbidden(FORBIDDEN_WRITE),
			APIResponseSpec.notFound("Resource not found"),
		),
	}),

	async (c) => {
		if (!can(c, "org_resources:write")) return APIResponse.forbidden(c, FORBIDDEN_WRITE);

		const resource = c.get("resource");
		// Its bookings leave the material lists: the requests they answered may be open again.
		const answered = await MaterialService.answeredBy(eq(T.eventMaterials.resource_id, resource.id));

		await DB.instance()
			.delete(T.orgResources)
			.where(and(inOrg(T.orgResources), eq(T.orgResources.id, resource.id)))
			.run();
		await MaterialService.settleAll(answered);

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "delete",
			entityType: "resource",
			entityId: resource.id,
			summary: `Ressource „${resource.name}“ gelöscht`,
		});

		return APIResponse.successNoData(c, "Resource deleted successfully");
	},
);

router.post(
	"/:resourceId/purchases",

	APIRouteSpec.authenticated({
		summary: "Plan a purchase",
		description:
			"Units of this item still to be bought, optionally with an estimate and a buyer from the core team (notified). They can be booked once marked bought.",
		tags,

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created(
				"Purchase created successfully",
				OrgResourcesModel.CreatePurchase.Response,
			),
			APIResponseSpec.forbidden(FORBIDDEN_WRITE),
			APIResponseSpec.notFound("Resource not found"),
		),
	}),

	zValidator("json", OrgResourcesModel.CreatePurchase.Body),

	async (c) => {
		if (!can(c, "org_resources:write")) return APIResponse.forbidden(c, FORBIDDEN_WRITE);

		const resource = c.get("resource");
		const body = c.req.valid("json") as OrgResourcesModel.CreatePurchase.Body;
		if (!(await validBuyer(body.buyer_id))) {
			return APIResponse.badRequest(c, "The buyer must be someone from the core team");
		}

		await DB.instance()
			.insert(T.resourcePurchases)
			.values({
				...body,
				resource_id: resource.id,
				created_by: getAuthUserId(c),
				org_id: OrgContext.id(),
			})
			.run();

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "update",
			entityType: "resource",
			entityId: resource.id,
			summary: `${body.quantity}× „${resource.name}“ zum Kaufen vorgemerkt`,
		});
		await notifyBuyer(c, body.buyer_id, resource, body.quantity);

		return APIResponse.created(c, "Purchase created successfully", await single(resource.id));
	},
);

router.post(
	"/:resourceId/bookings",

	APIRouteSpec.authenticated({
		summary: "Book resource for an event",
		description:
			"Reserve units for an event's material period (its dates plus its material days); the entry shows up on the event's material list. Fails with 409 when overlapping events have already booked too many units.",
		tags,

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created(
				"Booking created successfully",
				OrgResourcesModel.CreateBooking.Response,
			),
			APIResponseSpec.badRequest("Event not found / Syntax or validation error in request"),
			APIResponseSpec.forbidden(FORBIDDEN_WRITE),
			APIResponseSpec.notFound("Resource not found"),
			APIResponseSpec.conflict("Not enough units available"),
		),
	}),

	zValidator("json", OrgResourcesModel.CreateBooking.Body),

	async (c) => {
		if (!can(c, "org_resources:write")) return APIResponse.forbidden(c, FORBIDDEN_WRITE);

		const resource = c.get("resource");
		const body = c.req.valid("json") as OrgResourcesModel.CreateBooking.Body;

		const event = await DB.instance()
			.select()
			.from(T.events)
			.where(and(inOrg(T.events), eq(T.events.id, body.event_id)))
			.get();
		if (!event) return APIResponse.badRequest(c, "Event not found");

		if (!(await Inventory.fits(event, resource, body.quantity))) {
			return APIResponse.conflict(c, "Not enough units available");
		}

		const booking = await DB.instance()
			.insert(T.eventMaterials)
			.values({
				event_id: event.id,
				kind: "inventory",
				resource_id: resource.id,
				quantity: body.quantity,
				notes: body.notes,
				created_by: getAuthUserId(c),
				org_id: OrgContext.id(),
			})
			.returning()
			.get();

		await AuditLog.record({
			userId: getAuthUserId(c),
			eventId: event.id,
			action: "create",
			entityType: "material",
			entityId: booking.id,
			summary: `„${resource.name}“ (${booking.quantity}×) für „${event.name}“ reserviert`,
		});

		const [row] = await loadBookings({ id: booking.id });
		return APIResponse.created(c, "Booking created successfully", toBookingWithResource(row!));
	},
);
