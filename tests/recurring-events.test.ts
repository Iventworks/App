/**
 * Recurring events ("Regeltermine"): the recurrence rule, the dates it produces, the duty roster,
 * and how the rest of the app treats a series (it takes place on its dates, not all year).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { CalendarModel } from "../server/lib/api/versions/v1/routes/calendar/model";
import { DashboardModel } from "../server/lib/api/versions/v1/routes/dashboard/model";
import { EventsModel } from "../server/lib/api/versions/v1/routes/events/model";
import { EventOccurrencesModel } from "../server/lib/api/versions/v1/routes/events/occurrences/model";
import { CoreTeamModel } from "../server/lib/api/versions/v1/routes/org/core-team/model";
import { DB } from "../server/lib/db";
import { OrgContext } from "../server/lib/orgs/context";
import { Recurrence } from "../server/lib/utils/recurrence";
import { TimeUtils } from "../server/lib/utils/time";
import { makeAPIRequest } from "./helpers/api";
import {
	addEventMember,
	type SeededSession,
	type SeededUser,
	seedSession,
	seedUser,
} from "./helpers/seed";

let core: SeededUser;
let lea: SeededUser;
let sam: SeededUser;
let tom: SeededUser;
let outsider: SeededUser;

let coreSession: SeededSession;
let leaSession: SeededSession;
let samSession: SeededSession;
let tomSession: SeededSession;
let outsiderSession: SeededSession;

const today = TimeUtils.today();
const day = (offset: number) => TimeUtils.addDays(today, offset);

const rule = (overrides: Partial<Recurrence.Rule> = {}): Recurrence.Rule => ({
	frequency: "weekly",
	interval: 1,
	weekdays: [],
	monthly_mode: "day_of_month",
	start_time: null,
	end_time: null,
	...overrides,
});

async function createEvent(body: Record<string, unknown>, expectedCode = 201) {
	return await makeAPIRequest(
		"/v1/events",
		{ method: "POST", authToken: coreSession.token, body },
		expectedCode,
	);
}

/** A weekly series starting today (so today is one of its dates) for ten weeks. */
async function createWeekly(name: string, overrides: Record<string, unknown> = {}) {
	return EventsModel.Create.Response.parse(
		await createEvent({
			name,
			type: "recurring",
			start_date: today,
			end_date: day(69),
			recurrence: rule({ start_time: "19:00", end_time: "21:00" }),
			leader_ids: [lea.id],
			...overrides,
		}),
	);
}

async function listOccurrences(eventId: number, token = leaSession.token) {
	return await makeAPIRequest(`/v1/events/${eventId}/occurrences`, {
		authToken: token,
		expectedBodySchema: EventOccurrencesModel.GetAll.Response,
	});
}

async function addResponsibility(eventId: number, title: string, assigneeIds: number[]) {
	return await makeAPIRequest(
		`/v1/events/${eventId}/responsibilities`,
		{ method: "POST", authToken: leaSession.token, body: { title, assignee_ids: assigneeIds } },
		201,
	);
}

async function notificationsOf(token: string) {
	const page = await makeAPIRequest("/v1/notifications?limit=100", { authToken: token });
	return page.items as { type: string; title: string; body: string; link: string }[];
}

beforeAll(async () => {
	core = await seedUser("core_team", { display_name: "Konrad Kreis" });
	lea = await seedUser("volunteer", { display_name: "Lea Leitung" });
	sam = await seedUser("volunteer", { display_name: "Sam Schicht" });
	tom = await seedUser("volunteer", { display_name: "Tom Turnus" });
	outsider = await seedUser("volunteer", { display_name: "Ole Ohne" });

	coreSession = await seedSession(core.id);
	leaSession = await seedSession(lea.id);
	samSession = await seedSession(sam.id);
	tomSession = await seedSession(tom.id);
	outsiderSession = await seedSession(outsider.id);
});

describe("Recurrence rule", () => {
	test("weekly: the weekday of the first date, several weekdays, every other week", () => {
		// 2027-03-05 is a Friday.
		expect(Recurrence.weekday("2027-03-05")).toBe(5);
		expect(Recurrence.dates(rule(), "2027-03-05", "2027-04-02")).toEqual([
			"2027-03-05",
			"2027-03-12",
			"2027-03-19",
			"2027-03-26",
			"2027-04-02",
		]);
		// Tuesday and Friday; the Tuesday before the start is not part of the series.
		expect(Recurrence.dates(rule({ weekdays: [5, 2] }), "2027-03-05", "2027-03-19")).toEqual([
			"2027-03-05",
			"2027-03-09",
			"2027-03-12",
			"2027-03-16",
			"2027-03-19",
		]);
		expect(Recurrence.dates(rule({ interval: 2 }), "2027-03-05", "2027-04-02")).toEqual([
			"2027-03-05",
			"2027-03-19",
			"2027-04-02",
		]);
		// Across a year boundary and the change to summer time.
		expect(Recurrence.dates(rule(), "2026-12-25", "2027-01-08")).toEqual([
			"2026-12-25",
			"2027-01-01",
			"2027-01-08",
		]);
	});

	test("monthly: by day of the month and by weekday of the month", () => {
		expect(Recurrence.dates(rule({ frequency: "monthly" }), "2027-01-15", "2027-04-30")).toEqual([
			"2027-01-15",
			"2027-02-15",
			"2027-03-15",
			"2027-04-15",
		]);
		// The 31st falls back to the last day of shorter months.
		expect(Recurrence.dates(rule({ frequency: "monthly" }), "2027-01-31", "2027-04-30")).toEqual([
			"2027-01-31",
			"2027-02-28",
			"2027-03-31",
			"2027-04-30",
		]);
		// 2027-01-08 is the second Friday of January.
		expect(
			Recurrence.dates(
				rule({ frequency: "monthly", monthly_mode: "weekday_of_month" }),
				"2027-01-08",
				"2027-04-30",
			),
		).toEqual(["2027-01-08", "2027-02-12", "2027-03-12", "2027-04-09"]);
		// 2027-01-29 is the fifth Friday: "the last Friday" of every month.
		expect(
			Recurrence.dates(
				rule({ frequency: "monthly", monthly_mode: "weekday_of_month" }),
				"2027-01-29",
				"2027-04-30",
			),
		).toEqual(["2027-01-29", "2027-02-26", "2027-03-26", "2027-04-30"]);
		// Every third month.
		expect(
			Recurrence.dates(rule({ frequency: "monthly", interval: 3 }), "2027-01-10", "2027-12-31"),
		).toEqual(["2027-01-10", "2027-04-10", "2027-07-10", "2027-10-10"]);
	});

	test("limits", () => {
		expect(Recurrence.validate(rule(), "2027-01-01", "2027-12-31")).toBeNull();
		expect(Recurrence.validate(rule(), "2027-01-01", "2031-01-01")).toContain("three years");
		// Every day for three years would be more than 400 dates.
		expect(
			Recurrence.validate(rule({ weekdays: [1, 2, 3, 4, 5, 6, 7] }), "2027-01-01", "2029-12-31"),
		).toContain("at most");
		// Mondays only, but the series lasts from Tuesday to Sunday.
		expect(Recurrence.validate(rule({ weekdays: [1] }), "2027-03-02", "2027-03-07")).toContain(
			"no date",
		);
		expect(
			Recurrence.validate(
				rule({ start_time: "19:00", end_time: "18:00" }),
				"2027-01-01",
				"2027-02-01",
			),
		).toContain("end_time");
	});

	test("wall-clock times survive the change to summer time", () => {
		// Europe/Berlin switches to summer time on 2027-03-28.
		const winter = TimeUtils.instantOf("2027-03-27", "19:00");
		const summer = TimeUtils.instantOf("2027-03-28", "19:00");
		expect(summer - winter).toBe(23 * 60 * 60 * 1000);
		expect(TimeUtils.toTimeString(summer)).toBe("19:00");
		expect(TimeUtils.startOfDay("2027-03-28")).toBe(TimeUtils.instantOf("2027-03-28", "00:00"));

		// Moving an instant by days keeps its time of day.
		const moved = TimeUtils.shiftDays(winter, 1);
		expect(moved).toBe(summer);
		expect(TimeUtils.toDateString(TimeUtils.shiftDays(winter, 365))).toBe("2028-03-26");
		expect(TimeUtils.toTimeString(TimeUtils.shiftDays(winter, 365))).toBe("19:00");
	});
});

describe("Recurring events", () => {
	test("creating one creates its dates", async () => {
		const event = await createWeekly("Jugendkreis");
		expect(event.type).toBe("recurring");
		expect(event.recurrence).toMatchObject({ frequency: "weekly", start_time: "19:00" });
		// Today is the first date.
		expect(event.next_occurrence).toMatchObject({
			date: today,
			start_time: "19:00",
			end_time: "21:00",
		});

		const { occurrences } = await listOccurrences(event.id);
		expect(occurrences.map((occurrence) => occurrence.date)).toEqual(
			Array.from({ length: 10 }, (_, week) => day(week * 7)),
		);
		expect(occurrences.every((occurrence) => occurrence.origin === "rule")).toBe(true);
		expect(occurrences[0]).toMatchObject({
			start_time: "19:00",
			end_time: "21:00",
			custom_time: false,
			status: "planned",
		});

		const ranged = await makeAPIRequest(
			`/v1/events/${event.id}/occurrences?from=${day(7)}&to=${day(20)}`,
			{ authToken: leaSession.token, expectedBodySchema: EventOccurrencesModel.GetAll.Response },
		);
		expect(ranged.occurrences.map((occurrence) => occurrence.date)).toEqual([day(7), day(14)]);
	});

	test("a series needs a usable rule; other types carry none", async () => {
		await createEvent(
			{ name: "Ohne Regel", type: "recurring", start_date: today, end_date: day(30) },
			400,
		);
		await createEvent(
			{
				name: "Zu lang",
				type: "recurring",
				start_date: today,
				end_date: day(4 * 366),
				recurrence: rule(),
			},
			400,
		);
		await createEvent(
			{
				name: "Kaputte Zeit",
				type: "recurring",
				start_date: today,
				end_date: day(30),
				recurrence: { ...rule(), start_time: "25:00" },
			},
			400,
		);

		const camp = await createEvent({
			name: "Freizeit mit Regel",
			type: "camp",
			start_date: day(100),
			end_date: day(105),
			recurrence: rule(),
		});
		expect(camp.recurrence).toBeNull();
		expect(camp.next_occurrence).toBeNull();
		// Dates only exist for recurring events.
		await makeAPIRequest(`/v1/events/${camp.id}/occurrences`, { authToken: coreSession.token }, 400);
	});

	test("changing the rule keeps what people worked on", async () => {
		const event = await createWeekly("Hauskreis");
		const before = (await listOccurrences(event.id)).occurrences;
		const untouched = before[2]!;
		const withTopic = before[3]!;
		const cancelled = before[4]!;

		await makeAPIRequest(`/v1/events/${event.id}/occurrences/${withTopic.id}`, {
			method: "PUT",
			authToken: leaSession.token,
			body: { title: "Bergpredigt" },
		});
		await makeAPIRequest(`/v1/events/${event.id}/occurrences/${cancelled.id}`, {
			method: "PUT",
			authToken: leaSession.token,
			body: { status: "cancelled", cancel_reason: "Ferien" },
		});

		// Every second week from now on: the odd weeks drop out of the rule.
		const updated = await makeAPIRequest(`/v1/events/${event.id}`, {
			method: "PUT",
			authToken: leaSession.token,
			body: { recurrence: rule({ interval: 2, start_time: "18:30", end_time: "20:00" }) },
			expectedBodySchema: EventsModel.Update.Response,
		});
		expect(updated.recurrence?.interval).toBe(2);

		const after = (await listOccurrences(event.id)).occurrences;
		const byId = new Map(after.map((occurrence) => [occurrence.id, occurrence]));
		// Week 2 is still in the rule and follows the new time.
		expect(byId.get(untouched.id)).toMatchObject({ origin: "rule", start_time: "18:30" });
		// Week 3 left the rule but has a topic: it stays, as a date of its own.
		expect(byId.get(withTopic.id)).toMatchObject({ origin: "manual", title: "Bergpredigt" });
		// Week 4 is in the rule and stays cancelled.
		expect(byId.get(cancelled.id)).toMatchObject({ status: "cancelled", cancel_reason: "Ferien" });
		// Week 1 left the rule and nobody touched it.
		expect(byId.has(before[1]!.id)).toBe(false);
		expect(after.map((occurrence) => occurrence.date)).toEqual([
			day(0),
			day(14),
			day(21),
			day(28),
			day(42),
			day(56),
		]);

		// A longer series gets the additional dates; none is doubled.
		await makeAPIRequest(`/v1/events/${event.id}`, {
			method: "PUT",
			authToken: leaSession.token,
			body: { end_date: day(84) },
		});
		const longer = (await listOccurrences(event.id)).occurrences.map((occurrence) => occurrence.date);
		expect(longer).toEqual([day(0), day(14), day(21), day(28), day(42), day(56), day(70), day(84)]);

		// Turned into a one-time event: no dates any more.
		const once = await makeAPIRequest(`/v1/events/${event.id}`, {
			method: "PUT",
			authToken: leaSession.token,
			body: { type: "event" },
			expectedBodySchema: EventsModel.Update.Response,
		});
		expect(once.recurrence).toBeNull();
		expect(
			DB.instance()
				.select()
				.from(DB.Tables.eventOccurrences)
				.where(eq(DB.Tables.eventOccurrences.event_id, event.id))
				.all(),
		).toHaveLength(0);
	});

	test("past dates are history: a changed rule leaves them alone", async () => {
		const event = await createWeekly("Seit Wochen", { start_date: day(-28) });
		const dates = async () =>
			(await listOccurrences(event.id)).occurrences.map((occurrence) => occurrence.date);
		expect((await dates()).slice(0, 5)).toEqual([day(-28), day(-21), day(-14), day(-7), day(0)]);

		await makeAPIRequest(`/v1/events/${event.id}`, {
			method: "PUT",
			authToken: leaSession.token,
			body: { recurrence: rule({ interval: 4 }) },
		});
		// The past weekly dates stay; from today on only every fourth week.
		expect(await dates()).toEqual([day(-28), day(-21), day(-14), day(-7), day(0), day(28), day(56)]);
	});
});

describe("Dates", () => {
	let eventId: number;

	beforeAll(async () => {
		const event = await createWeekly("Teentreff");
		eventId = event.id;
		await addEventMember(eventId, sam.id, "staff");
		await addEventMember(eventId, tom.id, "staff");
	});

	test("own time, place and topic; reset to the series", async () => {
		const [first] = (await listOccurrences(eventId)).occurrences;
		const path = `/v1/events/${eventId}/occurrences/${first!.id}`;
		const put = async (body: Record<string, unknown>, expectedCode?: number) =>
			await makeAPIRequest(
				path,
				{
					method: "PUT",
					authToken: leaSession.token,
					body,
					...(expectedCode ? {} : { expectedBodySchema: EventOccurrencesModel.Update.Response }),
				},
				expectedCode,
			);

		const changed = await put({
			title: "Spieleabend",
			notes: "Snacks mitbringen",
			start_time: "18:00",
			end_time: "22:00",
			location: "Gemeindehaus",
		});
		expect(changed).toMatchObject({
			title: "Spieleabend",
			notes: "Snacks mitbringen",
			start_time: "18:00",
			end_time: "22:00",
			location: "Gemeindehaus",
			custom_time: true,
			custom_location: true,
		});

		await put({ end_time: "17:00" }, 400);
		// A date of the series cannot be moved to another day.
		await put({ date: day(1) }, 400);
		await put({}, 400);

		const reset = await put({ start_time: null, location: null });
		expect(reset).toMatchObject({
			start_time: "19:00",
			end_time: "21:00",
			custom_time: false,
			custom_location: false,
			title: "Spieleabend",
		});
	});

	test("extra dates are added by hand, moved and deleted; dates of the series only cancelled", async () => {
		const extra = await makeAPIRequest(
			`/v1/events/${eventId}/occurrences`,
			{
				method: "POST",
				authToken: leaSession.token,
				body: { date: day(3), title: "Sondertermin", start_time: "10:00" },
				expectedBodySchema: EventOccurrencesModel.Create.Response,
			},
			201,
		);
		expect(extra).toMatchObject({
			origin: "manual",
			date: day(3),
			start_time: "10:00",
			end_time: null,
		});

		const moved = await makeAPIRequest(`/v1/events/${eventId}/occurrences/${extra.id}`, {
			method: "PUT",
			authToken: leaSession.token,
			body: { date: day(4) },
			expectedBodySchema: EventOccurrencesModel.Update.Response,
		});
		expect(moved.date).toBe(day(4));

		// It survives a change of the rule.
		await makeAPIRequest(`/v1/events/${eventId}`, {
			method: "PUT",
			authToken: leaSession.token,
			body: { end_date: day(76) },
		});
		const { occurrences } = await listOccurrences(eventId);
		expect(occurrences.some((occurrence) => occurrence.id === extra.id)).toBe(true);

		const fromSeries = occurrences.find((occurrence) => occurrence.origin === "rule")!;
		await makeAPIRequest(
			`/v1/events/${eventId}/occurrences/${fromSeries.id}`,
			{ method: "DELETE", authToken: leaSession.token },
			400,
		);
		await makeAPIRequest(`/v1/events/${eventId}/occurrences/${extra.id}`, {
			method: "DELETE",
			authToken: leaSession.token,
		});
		await makeAPIRequest(
			`/v1/events/${eventId}/occurrences/${extra.id}`,
			{ method: "PUT", authToken: leaSession.token, body: { title: "weg" } },
			404,
		);
	});

	test("staff see the dates, only leaders change them, outsiders get nothing", async () => {
		const { occurrences } = await listOccurrences(eventId, samSession.token);
		const id = occurrences[1]!.id;

		await makeAPIRequest(
			`/v1/events/${eventId}/occurrences/${id}`,
			{ method: "PUT", authToken: samSession.token, body: { title: "Nein" } },
			403,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/occurrences`,
			{ method: "POST", authToken: samSession.token, body: { date: day(2) } },
			403,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/occurrences/plan`,
			{ method: "POST", authToken: samSession.token, body: { mode: "standard" } },
			403,
		);
		await makeAPIRequest(
			`/v1/events/${eventId}/occurrences`,
			{ authToken: outsiderSession.token },
			403,
		);

		// A date of another event is not found through this one.
		const other = await createWeekly("Anderer Kreis");
		const foreign = (await listOccurrences(other.id)).occurrences[0]!;
		await makeAPIRequest(
			`/v1/events/${eventId}/occurrences/${foreign.id}`,
			{ method: "PUT", authToken: leaSession.token, body: { title: "fremd" } },
			404,
		);
	});
});

describe("Duty roster", () => {
	let eventId: number;
	let techId: number;
	let inputId: number;

	beforeAll(async () => {
		const event = await createWeekly("Gottesdienst");
		eventId = event.id;
		await addEventMember(eventId, sam.id, "staff");
		await addEventMember(eventId, tom.id, "staff");
		techId = (await addResponsibility(eventId, "Technik", [sam.id, tom.id])).id;
		inputId = (await addResponsibility(eventId, "Andacht", [lea.id])).id;
	});

	const duty = (occurrence: EventOccurrencesModel.Occurrence, responsibilityId: number): number[] =>
		occurrence.duties
			.find((entry) => entry.responsibility_id === responsibilityId)
			?.users.map((user) => user.id) ?? [];

	test("the list names the responsibilities and who usually does them", async () => {
		const { responsibilities } = await listOccurrences(eventId);
		expect(responsibilities.map((entry) => entry.title)).toEqual(["Andacht", "Technik"]);
		expect(
			responsibilities
				.find((entry) => entry.id === techId)
				?.assignees.map((user) => user.id)
				.sort(),
		).toEqual([sam.id, tom.id].sort());
	});

	test("leaders put staff on duty; they are told", async () => {
		const { occurrences } = await listOccurrences(eventId);
		const target = occurrences[1]!;
		const path = `/v1/events/${eventId}/occurrences/${target.id}/duties/${techId}`;

		const set = await makeAPIRequest(path, {
			method: "PUT",
			authToken: leaSession.token,
			body: { user_ids: [sam.id] },
			expectedBodySchema: EventOccurrencesModel.SetDuty.Response,
		});
		expect(duty(set, techId)).toEqual([sam.id]);

		const forSam = await notificationsOf(samSession.token);
		expect(forSam.some((entry) => entry.type === "occurrence_assigned")).toBe(true);
		expect(forSam.find((entry) => entry.type === "occurrence_assigned")?.link).toBe(
			`/events/${eventId}/occurrences`,
		);

		// Only the event's staff.
		await makeAPIRequest(
			path,
			{ method: "PUT", authToken: leaSession.token, body: { user_ids: [outsider.id] } },
			400,
		);
		await makeAPIRequest(
			path,
			{ method: "PUT", authToken: samSession.token, body: { user_ids: [tom.id] } },
			403,
		);
		// A responsibility of another event does not exist here.
		const other = await createWeekly("Fremder Dienst");
		const foreign = (await addResponsibilityTo(other.id, "Fremd")).id;
		await makeAPIRequest(
			`/v1/events/${eventId}/occurrences/${target.id}/duties/${foreign}`,
			{ method: "PUT", authToken: leaSession.token, body: { user_ids: [sam.id] } },
			404,
		);

		const cleared = await makeAPIRequest(path, {
			method: "PUT",
			authToken: leaSession.token,
			body: { user_ids: [] },
			expectedBodySchema: EventOccurrencesModel.SetDuty.Response,
		});
		expect(duty(cleared, techId)).toEqual([]);
	});

	async function addResponsibilityTo(otherEventId: number, title: string) {
		return await makeAPIRequest(
			`/v1/events/${otherEventId}/responsibilities`,
			{ method: "POST", authToken: coreSession.token, body: { title } },
			201,
		);
	}

	test("staff take a duty themselves and give it back", async () => {
		const { occurrences } = await listOccurrences(eventId);
		const target = occurrences[2]!;
		const path = `/v1/events/${eventId}/occurrences/${target.id}/duties/${techId}/me`;

		const taken = await makeAPIRequest(path, {
			method: "PUT",
			authToken: tomSession.token,
			body: { assigned: true },
			expectedBodySchema: EventOccurrencesModel.SignUp.Response,
		});
		expect(duty(taken, techId)).toEqual([tom.id]);
		expect(taken.is_mine).toBe(true);
		// Twice is fine.
		await makeAPIRequest(path, {
			method: "PUT",
			authToken: tomSession.token,
			body: { assigned: true },
		});

		const forSam = (await listOccurrences(eventId, samSession.token)).occurrences.find(
			(occurrence) => occurrence.id === target.id,
		)!;
		expect(forSam.is_mine).toBe(false);

		const returned = await makeAPIRequest(path, {
			method: "PUT",
			authToken: tomSession.token,
			body: { assigned: false },
			expectedBodySchema: EventOccurrencesModel.SignUp.Response,
		});
		expect(duty(returned, techId)).toEqual([]);

		// The core team runs every event but is not on this one's team.
		await makeAPIRequest(
			path,
			{ method: "PUT", authToken: coreSession.token, body: { assigned: true } },
			403,
		);
		await makeAPIRequest(
			path,
			{ method: "PUT", authToken: outsiderSession.token, body: { assigned: true } },
			403,
		);
	});

	test("filling the roster: everyone who usually does it, or taking turns", async () => {
		const plan = async (body: Record<string, unknown>) =>
			await makeAPIRequest(`/v1/events/${eventId}/occurrences/plan`, {
				method: "POST",
				authToken: leaSession.token,
				body,
				expectedBodySchema: EventOccurrencesModel.Plan.Response,
			});

		// Sam and Tom take turns on the tech; dates already planned stay.
		const first = (await listOccurrences(eventId)).occurrences[0]!;
		await makeAPIRequest(`/v1/events/${eventId}/occurrences/${first.id}/duties/${techId}`, {
			method: "PUT",
			authToken: leaSession.token,
			body: { user_ids: [tom.id] },
		});
		const rotated = await plan({ mode: "rotate", responsibility_ids: [techId] });
		expect(rotated.occurrences).toBe(9);
		expect(rotated.duties).toBe(9);

		let { occurrences } = await listOccurrences(eventId);
		const techOrder = occurrences.map((occurrence) => duty(occurrence, techId));
		// Tom has the first date, so Sam is next, then they alternate.
		expect(techOrder.slice(0, 4)).toEqual([[tom.id], [sam.id], [tom.id], [sam.id]]);
		expect(techOrder.every((users) => users.length === 1)).toBe(true);
		// The other responsibility was not part of it.
		expect(occurrences.every((occurrence) => duty(occurrence, inputId).length === 0)).toBe(true);

		// The standard cast for everything that is still open.
		const standard = await plan({ mode: "standard" });
		expect(standard.occurrences).toBe(10);
		({ occurrences } = await listOccurrences(eventId));
		expect(occurrences.every((occurrence) => duty(occurrence, inputId)[0] === lea.id)).toBe(true);
		// Nothing left to fill.
		expect(await plan({ mode: "standard" })).toEqual({ occurrences: 0, duties: 0 });

		// Overwriting replaces what is there.
		const overwritten = await plan({
			mode: "standard",
			responsibility_ids: [techId],
			overwrite: true,
		});
		expect(overwritten.duties).toBe(20);
		({ occurrences } = await listOccurrences(eventId));
		expect(duty(occurrences[5]!, techId).sort()).toEqual([sam.id, tom.id].sort());

		// One notification per person, not one per date.
		const forTom = (await notificationsOf(tomSession.token)).filter(
			(entry) => entry.type === "occurrence_assigned" && entry.body === "Gottesdienst",
		);
		expect(forTom.some((entry) => entry.title.includes("Termine eingeteilt"))).toBe(true);
	});

	test("cancelling a date tells the people on duty; cancelled dates take no sign-ups", async () => {
		const { occurrences } = await listOccurrences(eventId);
		const target = occurrences[6]!;
		const path = `/v1/events/${eventId}/occurrences/${target.id}`;

		const cancelled = await makeAPIRequest(path, {
			method: "PUT",
			authToken: leaSession.token,
			body: { status: "cancelled", cancel_reason: "Gemeindefreizeit" },
			expectedBodySchema: EventOccurrencesModel.Update.Response,
		});
		expect(cancelled).toMatchObject({ status: "cancelled", cancel_reason: "Gemeindefreizeit" });

		const forSam = await notificationsOf(samSession.token);
		const notice = forSam.find((entry) => entry.type === "occurrence_cancelled");
		expect(notice?.title).toContain("fällt aus");
		expect(notice?.body).toContain("Gemeindefreizeit");

		await makeAPIRequest(
			`${path}/duties/${techId}/me`,
			{ method: "PUT", authToken: samSession.token, body: { assigned: true } },
			400,
		);

		// It no longer counts as the next date and can take place again.
		const restored = await makeAPIRequest(path, {
			method: "PUT",
			authToken: leaSession.token,
			body: { status: "planned" },
			expectedBodySchema: EventOccurrencesModel.Update.Response,
		});
		expect(restored).toMatchObject({ status: "planned", cancel_reason: null });
	});

	test("leaving the team takes someone off the upcoming dates", async () => {
		const members = await makeAPIRequest(`/v1/events/${eventId}/members`, {
			authToken: leaSession.token,
		});
		const tomMember = members.find((member: any) => member.user.id === tom.id);
		await makeAPIRequest(`/v1/events/${eventId}/members/${tomMember.id}`, {
			method: "DELETE",
			authToken: leaSession.token,
		});

		const { occurrences, responsibilities } = await listOccurrences(eventId);
		expect(occurrences.every((occurrence) => !duty(occurrence, techId).includes(tom.id))).toBe(true);
		expect(
			responsibilities.find((entry) => entry.id === techId)?.assignees.map((user) => user.id),
		).toEqual([sam.id]);
	});
});

describe("A series takes place on its dates, not all year", () => {
	let weeklyId: number;
	let campOnDateId: number;
	let campBetweenId: number;

	beforeAll(async () => {
		// Dates today, in 7, 14, … days; cancelled in 14 days.
		const weekly = await createWeekly("Bandprobe", { color: "#22c55e" });
		weeklyId = weekly.id;
		await addEventMember(weeklyId, sam.id, "staff");
		const { occurrences } = await listOccurrences(weeklyId);
		await makeAPIRequest(`/v1/events/${weeklyId}/occurrences/${occurrences[2]!.id}`, {
			method: "PUT",
			authToken: leaSession.token,
			body: { status: "cancelled" },
		});
		await makeAPIRequest(`/v1/events/${weeklyId}/occurrences/${occurrences[1]!.id}`, {
			method: "PUT",
			authToken: leaSession.token,
			body: { title: "Neue Lieder" },
		});

		// One camp over the date in three weeks, one between two dates, one over the cancelled date.
		campOnDateId = (
			await createEvent({ name: "Camp am Termin", start_date: day(20), end_date: day(22) })
		).id;
		campBetweenId = (
			await createEvent({ name: "Camp dazwischen", start_date: day(8), end_date: day(13) })
		).id;
		await addEventMember(campOnDateId, sam.id, "staff");
		await addEventMember(campBetweenId, sam.id, "staff");
	});

	test("the event list carries the next date; a cancelled one is skipped", async () => {
		const events = await makeAPIRequest("/v1/events?scope=mine", {
			authToken: samSession.token,
			expectedBodySchema: EventsModel.GetAll.Response,
		});
		const weekly = events.find((event) => event.id === weeklyId)!;
		expect(weekly.next_occurrence?.date).toBe(today);

		const overview = await makeAPIRequest(`/v1/events/${weeklyId}/overview`, {
			authToken: samSession.token,
			expectedBodySchema: EventsModel.Overview.Response,
		});
		expect(overview.is_running).toBe(true);
		expect(overview.next_occurrences.map((occurrence) => occurrence.date)).toEqual([
			day(0),
			day(7),
			day(21),
			day(28),
			day(35),
		]);
		expect(overview.next_occurrences[1]?.title).toBe("Neue Lieder");
	});

	test("the calendar shows the single dates", async () => {
		const from = TimeUtils.startOfDay(today);
		const to = TimeUtils.startOfDay(day(30));
		const feed = await makeAPIRequest(`/v1/calendar/feed?from=${from}&to=${to}`, {
			authToken: samSession.token,
			expectedBodySchema: CalendarModel.Feed.Response,
		});
		const dates = feed.filter((item) => item.event?.id === weeklyId && item.source === "event");
		// Four planned dates in the next 30 days (the one in two weeks is cancelled), each at 19:00.
		expect(dates.map((item) => TimeUtils.toDateString(item.start_at))).toEqual([
			day(0),
			day(7),
			day(21),
			day(28),
		]);
		expect(dates.every((item) => !item.all_day)).toBe(true);
		expect(dates.every((item) => TimeUtils.toTimeString(item.start_at) === "19:00")).toBe(true);
		expect(dates[1]?.title).toBe("Bandprobe: Neue Lieder");
		expect(dates[0]?.link).toBe(`/events/${weeklyId}/occurrences`);
		// Not one span over the whole series.
		expect(feed.some((item) => item.id === `event-${weeklyId}`)).toBe(false);
	});

	test("the dashboard: running on a day with a date, else upcoming with the next one", async () => {
		const dashboard = await makeAPIRequest("/v1/dashboard", {
			authToken: samSession.token,
			expectedBodySchema: DashboardModel.Response,
		});
		const current = dashboard.current_events.find((event) => event.id === weeklyId)!;
		expect(current).toMatchObject({ day_number: 1, total_days: 1 });
		expect(current.occurrence).toMatchObject({ date: today, start_time: "19:00" });
		expect(dashboard.upcoming_events.some((event) => event.id === weeklyId)).toBe(false);

		// A series whose first date is next week is upcoming, not running.
		const later = await createWeekly("Ab nächster Woche", { start_date: day(7), end_date: day(60) });
		await addEventMember(later.id, sam.id, "staff");
		const again = await makeAPIRequest("/v1/dashboard", {
			authToken: samSession.token,
			expectedBodySchema: DashboardModel.Response,
		});
		expect(again.current_events.some((event) => event.id === later.id)).toBe(false);
		const upcoming = again.upcoming_events.find((event) => event.id === later.id)!;
		expect(upcoming.days_until).toBe(7);
		expect(upcoming.occurrence?.date).toBe(day(7));
	});

	test("staff planning: a clash only when a date falls into the other event", async () => {
		const planning = await makeAPIRequest(
			`/v1/org/core-team/staff-planning?from=${today}&to=${day(40)}`,
			{ authToken: coreSession.token, expectedBodySchema: CoreTeamModel.StaffPlanning.Response },
		);
		const weekly = planning.events.find((event) => event.id === weeklyId)!;
		expect(weekly.type).toBe("recurring");
		expect(weekly.dates).toEqual([day(0), day(7), day(21), day(28), day(35)]);
		expect(planning.events.find((event) => event.id === campOnDateId)?.dates).toBeNull();

		const conflicts = planning.users.find((entry) => entry.user.id === sam.id)!.conflicts;
		const clashesWith = (id: number) =>
			conflicts.some((pair) => pair.includes(weeklyId) && pair.includes(id));
		expect(clashesWith(campOnDateId)).toBe(true);
		expect(clashesWith(campBetweenId)).toBe(false);

		// A range without any date of the series leaves it out.
		const gap = await makeAPIRequest(
			`/v1/org/core-team/staff-planning?from=${day(8)}&to=${day(13)}`,
			{ authToken: coreSession.token, expectedBodySchema: CoreTeamModel.StaffPlanning.Response },
		);
		expect(gap.events.some((event) => event.id === weeklyId)).toBe(false);
		expect(gap.events.some((event) => event.id === campBetweenId)).toBe(true);
	});

	test("the core team overview lists the series by its next date", async () => {
		const overview = await makeAPIRequest("/v1/org/core-team/overview", {
			authToken: coreSession.token,
			expectedBodySchema: CoreTeamModel.Overview.Response,
		});
		const running = overview.running_events.find((event) => event.id === weeklyId);
		expect(running?.next_date).toBe(today);
	});

	test("resources: a series only competes on the days of its dates", async () => {
		const resource = await makeAPIRequest(
			"/v1/org/resources",
			{ method: "POST", authToken: coreSession.token, body: { name: "Beamer (Serie)", quantity: 1 } },
			201,
		);
		const book = async (eventId: number, expectedCode: number) =>
			await makeAPIRequest(
				`/v1/org/resources/${resource.id}/bookings`,
				{ method: "POST", authToken: coreSession.token, body: { event_id: eventId, quantity: 1 } },
				expectedCode,
			);

		await book(weeklyId, 201);
		// Free between two dates, taken on a date.
		await book(campBetweenId, 201);
		await book(campOnDateId, 409);

		const listed = (await makeAPIRequest("/v1/org/resources", { authToken: coreSession.token })).find(
			(entry: any) => entry.id === resource.id,
		);
		// In use today: the series has a date today.
		expect(listed.booked_now).toBe(1);
		expect(listed.bookings.find((booking: any) => booking.event.id === weeklyId).event.type).toBe(
			"recurring",
		);
	});

	test("deleting the event deletes its dates and duties", async () => {
		const event = await createWeekly("Kurzlebig");
		const responsibility = await makeAPIRequest(
			`/v1/events/${event.id}/responsibilities`,
			{ method: "POST", authToken: leaSession.token, body: { title: "Tür", assignee_ids: [lea.id] } },
			201,
		);
		await makeAPIRequest(`/v1/events/${event.id}/occurrences/plan`, {
			method: "POST",
			authToken: leaSession.token,
			body: { mode: "standard" },
		});
		const db = DB.instance();
		const occurrenceIds = db
			.select({ id: DB.Tables.eventOccurrences.id })
			.from(DB.Tables.eventOccurrences)
			.where(eq(DB.Tables.eventOccurrences.event_id, event.id))
			.all();
		expect(occurrenceIds).toHaveLength(10);

		await makeAPIRequest(`/v1/events/${event.id}`, {
			method: "DELETE",
			authToken: coreSession.token,
		});

		expect(
			db
				.select()
				.from(DB.Tables.eventOccurrences)
				.where(eq(DB.Tables.eventOccurrences.event_id, event.id))
				.all(),
		).toHaveLength(0);
		expect(
			db
				.select()
				.from(DB.Tables.occurrenceDuties)
				.where(
					and(
						eq(DB.Tables.occurrenceDuties.org_id, OrgContext.id()),
						eq(DB.Tables.occurrenceDuties.responsibility_id, responsibility.id),
					),
				)
				.all(),
		).toHaveLength(0);
	});
});
