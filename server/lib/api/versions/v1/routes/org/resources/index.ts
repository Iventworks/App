import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { inOrg, OrgContext } from "../../../../../../orgs/context";
import { TimeUtils } from "../../../../../../utils/time";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import { getAuthUserId } from "../../../../../utils/guards";
import { PermissionHelper } from "../../../../../utils/permissions";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { OrgResourcesModel } from "./model";

type ResourcesEnv = {
	Variables: { resource: DB.Models.OrgResource };
};

/** Organisation inventory (tents, projectors, vans, …) and which event has booked what. */
export const router = new Hono<ResourcesEnv>().basePath("/resources");

function can(c: Context, permission: "org_resources:read" | "org_resources:write") {
	return PermissionHelper.can({ authContext: AuthHandler.AuthContext.get(c), permission });
}

const FORBIDDEN_WRITE = "Only the core team can manage resources";

/** Bookings (optionally filtered) joined with their event and resource. */
async function loadBookings(filter: { resourceIds?: number[]; eventId?: number }) {
	const conditions = [];
	if (filter.resourceIds) {
		if (filter.resourceIds.length === 0) return [];
		conditions.push(inArray(DB.Tables.resourceBookings.resource_id, filter.resourceIds));
	}
	if (filter.eventId) conditions.push(eq(DB.Tables.resourceBookings.event_id, filter.eventId));

	return await DB.instance()
		.select({
			booking: DB.Tables.resourceBookings,
			event: {
				id: DB.Tables.events.id,
				name: DB.Tables.events.name,
				start_date: DB.Tables.events.start_date,
				end_date: DB.Tables.events.end_date,
			},
			resource: {
				id: DB.Tables.orgResources.id,
				name: DB.Tables.orgResources.name,
				category: DB.Tables.orgResources.category,
				quantity: DB.Tables.orgResources.quantity,
			},
		})
		.from(DB.Tables.resourceBookings)
		.innerJoin(
			DB.Tables.events,
			and(inOrg(DB.Tables.events), eq(DB.Tables.events.id, DB.Tables.resourceBookings.event_id)),
		)
		.innerJoin(
			DB.Tables.orgResources,
			and(
				inOrg(DB.Tables.orgResources),
				eq(DB.Tables.orgResources.id, DB.Tables.resourceBookings.resource_id),
			),
		)
		.where(and(inOrg(DB.Tables.resourceBookings), conditions.length ? and(...conditions) : undefined))
		.orderBy(asc(DB.Tables.events.start_date), asc(DB.Tables.resourceBookings.id))
		.all();
}

type BookingRow = Awaited<ReturnType<typeof loadBookings>>[number];

function toBookingWithResource(row: BookingRow): OrgResourcesModel.BookingWithResource {
	return {
		id: row.booking.id,
		quantity: row.booking.quantity,
		notes: row.booking.notes,
		created_at: row.booking.created_at,
		event: row.event,
		resource: row.resource,
	};
}

async function toResponse(
	resources: DB.Models.OrgResource[],
): Promise<OrgResourcesModel.Resource[]> {
	const bookings = await loadBookings({ resourceIds: resources.map((resource) => resource.id) });
	const today = TimeUtils.today();

	return resources.map((resource) => {
		const own = bookings.filter((row) => row.booking.resource_id === resource.id);
		return {
			...resource,
			bookings: own.map((row) => {
				const { resource: _resource, ...booking } = toBookingWithResource(row);
				return booking;
			}),
			booked_now: own
				.filter((row) => row.event.start_date <= today && today <= row.event.end_date)
				.reduce((sum, row) => sum + row.booking.quantity, 0),
		};
	});
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List resources",
		description:
			"The organisation's inventory with all bookings and how many units are in use today.",
		tags: [DOCS_TAGS.ORG.RESOURCES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Resources retrieved successfully", OrgResourcesModel.GetAll.Response),
			APIResponseSpec.forbidden("You do not have permission to access this resource"),
		),
	}),

	async (c) => {
		if (!can(c, "org_resources:read")) {
			return APIResponse.forbidden(c, "You do not have permission to access this resource");
		}

		const resources = await DB.instance()
			.select()
			.from(DB.Tables.orgResources)
			.where(inOrg(DB.Tables.orgResources))
			.orderBy(asc(DB.Tables.orgResources.category), asc(DB.Tables.orgResources.name))
			.all();

		return APIResponse.success(c, "Resources retrieved successfully", await toResponse(resources));
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create resource",
		description: "Add an item to the organisation's inventory (core team).",
		tags: [DOCS_TAGS.ORG.RESOURCES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Resource created successfully", OrgResourcesModel.Create.Response),
			APIResponseSpec.forbidden(FORBIDDEN_WRITE),
		),
	}),

	zValidator("json", OrgResourcesModel.Create.Body),

	async (c) => {
		if (!can(c, "org_resources:write")) return APIResponse.forbidden(c, FORBIDDEN_WRITE);

		const body = c.req.valid("json") as OrgResourcesModel.Create.Body;
		const resource = await DB.instance()
			.insert(DB.Tables.orgResources)
			.values({ ...body, org_id: OrgContext.id() })
			.returning()
			.get();

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "create",
			entityType: "resource",
			entityId: resource.id,
			summary: `Ressource „${resource.name}“ (${resource.quantity}×) angelegt`,
		});

		const [result] = await toResponse([resource]);
		return APIResponse.created(c, "Resource created successfully", result!);
	},
);

// Literal `/bookings…` paths are registered before the `/:resourceId/*` loader.

router.get(
	"/bookings",

	APIRouteSpec.authenticated({
		summary: "List resource bookings",
		description: "All resource bookings, optionally only those of one event.",
		tags: [DOCS_TAGS.ORG.RESOURCES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success(
				"Bookings retrieved successfully",
				OrgResourcesModel.GetBookings.Response,
			),
			APIResponseSpec.forbidden("You do not have permission to access this resource"),
		),
	}),

	zValidator("query", OrgResourcesModel.GetBookings.Query),

	async (c) => {
		if (!can(c, "org_resources:read")) {
			return APIResponse.forbidden(c, "You do not have permission to access this resource");
		}

		const { event_id } = c.req.valid("query") as OrgResourcesModel.GetBookings.Query;
		const rows = await loadBookings({ eventId: event_id });

		return APIResponse.success(c, "Bookings retrieved successfully", rows.map(toBookingWithResource));
	},
);

router.delete(
	"/bookings/:bookingId",

	APIRouteSpec.authenticated({
		summary: "Delete resource booking",
		description: "Release a resource booking (core team).",
		tags: [DOCS_TAGS.ORG.RESOURCES],

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

		const [row] = await DB.instance()
			.select({ booking: DB.Tables.resourceBookings, resource_name: DB.Tables.orgResources.name })
			.from(DB.Tables.resourceBookings)
			.innerJoin(
				DB.Tables.orgResources,
				and(
					inOrg(DB.Tables.orgResources),
					eq(DB.Tables.orgResources.id, DB.Tables.resourceBookings.resource_id),
				),
			)
			.where(and(inOrg(DB.Tables.resourceBookings), eq(DB.Tables.resourceBookings.id, bookingId)))
			.all();

		if (!row) return APIResponse.notFound(c, "Booking not found");

		await DB.instance()
			.delete(DB.Tables.resourceBookings)
			.where(and(inOrg(DB.Tables.resourceBookings), eq(DB.Tables.resourceBookings.id, bookingId)))
			.run();

		await AuditLog.record({
			userId: getAuthUserId(c),
			eventId: row.booking.event_id,
			action: "delete",
			entityType: "resource_booking",
			entityId: bookingId,
			summary: `Reservierung von „${row.resource_name}“ (${row.booking.quantity}×) aufgehoben`,
		});

		return APIResponse.successNoData(c, "Booking deleted successfully");
	},
);

router.use("/:resourceId/*", zValidator("param", OrgResourcesModel.Params), async (c, next) => {
	const resourceId = OrgResourcesModel.Params.shape.resourceId.safeParse(c.req.param("resourceId"));
	if (!resourceId.success) return APIResponse.badRequest(c, "Invalid resource id");

	const resource = await DB.instance()
		.select()
		.from(DB.Tables.orgResources)
		.where(and(inOrg(DB.Tables.orgResources), eq(DB.Tables.orgResources.id, resourceId.data)))
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
		tags: [DOCS_TAGS.ORG.RESOURCES],

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
			.update(DB.Tables.orgResources)
			.set(body)
			.where(and(inOrg(DB.Tables.orgResources), eq(DB.Tables.orgResources.id, resource.id)))
			.returning()
			.get();

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "update",
			entityType: "resource",
			entityId: resource.id,
			summary: `Ressource „${updated.name}“ bearbeitet`,
		});

		const [result] = await toResponse([updated]);
		return APIResponse.success(c, "Resource updated successfully", result!);
	},
);

router.delete(
	"/:resourceId",

	APIRouteSpec.authenticated({
		summary: "Delete resource",
		description: "Remove an inventory item together with its bookings (core team).",
		tags: [DOCS_TAGS.ORG.RESOURCES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Resource deleted successfully"),
			APIResponseSpec.forbidden(FORBIDDEN_WRITE),
			APIResponseSpec.notFound("Resource not found"),
		),
	}),

	async (c) => {
		if (!can(c, "org_resources:write")) return APIResponse.forbidden(c, FORBIDDEN_WRITE);

		const resource = c.get("resource");

		await DB.instance()
			.delete(DB.Tables.orgResources)
			.where(and(inOrg(DB.Tables.orgResources), eq(DB.Tables.orgResources.id, resource.id)))
			.run();

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
	"/:resourceId/bookings",

	APIRouteSpec.authenticated({
		summary: "Book resource for an event",
		description:
			"Reserve units of a resource for an event's date range. Fails with 409 when overlapping events have already booked too many units.",
		tags: [DOCS_TAGS.ORG.RESOURCES],

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
			.from(DB.Tables.events)
			.where(and(inOrg(DB.Tables.events), eq(DB.Tables.events.id, body.event_id)))
			.get();
		if (!event) return APIResponse.badRequest(c, "Event not found");

		// Units already taken by bookings of events whose date range overlaps this event.
		const overlapping = await DB.instance()
			.select({ quantity: DB.Tables.resourceBookings.quantity })
			.from(DB.Tables.resourceBookings)
			.innerJoin(
				DB.Tables.events,
				and(inOrg(DB.Tables.events), eq(DB.Tables.events.id, DB.Tables.resourceBookings.event_id)),
			)
			.where(
				and(
					inOrg(DB.Tables.resourceBookings),
					eq(DB.Tables.resourceBookings.resource_id, resource.id),
					lte(DB.Tables.events.start_date, event.end_date),
					gte(DB.Tables.events.end_date, event.start_date),
				),
			)
			.all();
		const taken = overlapping.reduce((sum, row) => sum + row.quantity, 0);

		if (taken + body.quantity > resource.quantity) {
			return APIResponse.conflict(c, "Not enough units available");
		}

		const booking = await DB.instance()
			.insert(DB.Tables.resourceBookings)
			.values({
				org_id: OrgContext.id(),
				resource_id: resource.id,
				event_id: event.id,
				quantity: body.quantity,
				notes: body.notes,
			})
			.returning()
			.get();

		await AuditLog.record({
			userId: getAuthUserId(c),
			eventId: event.id,
			action: "create",
			entityType: "resource_booking",
			entityId: booking.id,
			summary: `„${resource.name}“ (${booking.quantity}×) für „${event.name}“ reserviert`,
		});

		return APIResponse.created(c, "Booking created successfully", {
			id: booking.id,
			quantity: booking.quantity,
			notes: booking.notes,
			created_at: booking.created_at,
			event: {
				id: event.id,
				name: event.name,
				start_date: event.start_date,
				end_date: event.end_date,
			},
			resource: {
				id: resource.id,
				name: resource.name,
				category: resource.category,
				quantity: resource.quantity,
			},
		} satisfies OrgResourcesModel.CreateBooking.Response);
	},
);
