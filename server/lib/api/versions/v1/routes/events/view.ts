import { and, count, inArray, ne } from "drizzle-orm";
import { DB } from "../../../../../db";
import type { DrizzleDB } from "../../../../../db/utils";
import { inOrg } from "../../../../../orgs/context";
import type { AuthHandler } from "../../../../utils/authHandler";
import { Occurrences } from "../../../../utils/occurrences";
import { PermissionHelper } from "../../../../utils/permissions";
import { UserSummary } from "../../../../utils/shared-models/userSummary";
import type { EventsModel } from "./model";

/** Build the caller-specific view of events with leaders and head counts in a few queries. */
export async function withAccess(
	events: DB.Models.Event[],
	authContext: AuthHandler.AuthenticatedAuthContext,
	tx: DrizzleDB = DB.instance(),
): Promise<EventsModel.EventWithAccess[]> {
	if (events.length === 0) return [];
	const eventIds = events.map((event) => event.id);

	const members = await tx
		.select()
		.from(DB.Tables.eventMembers)
		.where(and(inOrg(DB.Tables.eventMembers), inArray(DB.Tables.eventMembers.event_id, eventIds)))
		.all();

	const participantCounts = await tx
		.select({ event_id: DB.Tables.participants.event_id, value: count() })
		.from(DB.Tables.participants)
		.where(
			and(
				inOrg(DB.Tables.participants),
				inArray(DB.Tables.participants.event_id, eventIds),
				ne(DB.Tables.participants.status, "cancelled"),
			),
		)
		.groupBy(DB.Tables.participants.event_id)
		.all();

	const users = await UserSummary.fetchMap(
		members.filter((member) => member.role === "leader").map((member) => member.user_id),
		tx,
	);
	const nextOccurrences = await Occurrences.nextByEvent(events, tx);

	return events.map(({ org_id: _orgId, ...event }) => {
		const eventMembers = members.filter((member) => member.event_id === event.id);
		const membership = eventMembers.find((member) => member.user_id === authContext.user_id);
		const role = PermissionHelper.getEffectiveEventRole(authContext.user_role, membership);

		return {
			...event,
			my_role: role,
			is_member: Boolean(membership),
			permissions: PermissionHelper.listEventPermissions(role, membership ?? null),
			leaders: eventMembers
				.filter((member) => member.role === "leader")
				.map((member) => users.get(member.user_id))
				.filter((user): user is UserSummary.Schema => Boolean(user)),
			staff_count: eventMembers.length,
			participant_count: participantCounts.find((entry) => entry.event_id === event.id)?.value ?? 0,
			next_occurrence: nextOccurrences.get(event.id) ?? null,
		};
	});
}
