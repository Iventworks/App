import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { DB } from "../server/lib/db";
import { FormAnswers, FormFields } from "../server/lib/forms/fields";
import { FormStarters } from "../server/lib/forms/starters";
import { inOrg, OrgContext } from "../server/lib/orgs/context";
import { OrgService } from "../server/lib/orgs/service";
import { makeAPIRequest } from "./helpers/api";
import { SYSTEM_HOST } from "./helpers/orgs";
import { addEventMember, type SeededSession, seedSession, seedUser } from "./helpers/seed";

let core: SeededSession;
let volunteer: SeededSession;
let leader: SeededSession;
let staff: SeededSession;
let eventId: number;

const QUESTIONS = [
	{ id: "name", type: "short_text", label: "Name", required: true },
	{
		id: "allergies",
		type: "single_choice",
		label: "Allergien?",
		required: true,
		options: [
			{ id: "yes", label: "Ja" },
			{ id: "no", label: "Nein" },
		],
	},
	{
		id: "which",
		type: "long_text",
		label: "Welche?",
		required: true,
		condition: { field_id: "allergies", option_ids: ["yes"] },
	},
	{ id: "stars", type: "rating", label: "Wie gut?", max: 5 },
];

const tokenOf = (url: string) => url.split("/s/form/")[1]!;

async function createOrgForm(title = "Umfrage", template_id: number | null = null) {
	return await makeAPIRequest(
		"/v1/org/forms",
		{ method: "POST", authToken: core.token, body: { title, template_id } },
		201,
	);
}

async function setFields(formId: number, fields: unknown[], code = 200, token = core.token) {
	return await makeAPIRequest(
		`/v1/forms/${formId}`,
		{ method: "PUT", authToken: token, body: { fields } },
		code,
	);
}

async function setStatus(formId: number, status: "open" | "closed", code = 200) {
	return await makeAPIRequest(
		`/v1/forms/${formId}/status`,
		{ method: "PUT", authToken: core.token, body: { status } },
		code,
	);
}

async function send(token: string, answers: Record<string, unknown>, code = 201, extra = {}) {
	return await makeAPIRequest(
		`/v1/public/forms/${token}/responses`,
		{ method: "POST", body: { answers, ...extra } },
		code,
	);
}

/** A published org form with `QUESTIONS`; returns its id and link token. */
async function publishedForm(title = "Anmeldung") {
	const form = await createOrgForm(title);
	await setFields(form.id, QUESTIONS);
	const published = await setStatus(form.id, "open");
	return { id: form.id as number, token: tokenOf(published.public_url) };
}

function auditSummaries(formId: number) {
	return DB.instance()
		.select({ summary: DB.Tables.auditLogs.summary })
		.from(DB.Tables.auditLogs)
		.where(
			and(
				inOrg(DB.Tables.auditLogs),
				eq(DB.Tables.auditLogs.entity_type, "form"),
				eq(DB.Tables.auditLogs.entity_id, formId),
			),
		)
		.all()
		.map((row) => row.summary);
}

beforeAll(async () => {
	core = await seedSession((await seedUser("core_team")).id);
	volunteer = await seedSession((await seedUser("volunteer")).id);
	const leaderUser = await seedUser("volunteer");
	const staffUser = await seedUser("volunteer");
	leader = await seedSession(leaderUser.id);
	staff = await seedSession(staffUser.id);

	const event = await makeAPIRequest(
		"/v1/events",
		{
			method: "POST",
			authToken: core.token,
			body: { name: "Herbstfreizeit", type: "camp", start_date: "2027-10-01", end_date: "2027-10-05" },
		},
		201,
	);
	eventId = event.id;
	await addEventMember(eventId, leaderUser.id, "leader");
	await addEventMember(eventId, staffUser.id, "staff");
});

describe("Questions and answers (FormFields / FormAnswers)", () => {
	const fields = FormFields.List.parse(QUESTIONS);

	test("conditions show a question only for the chosen option", () => {
		expect(FormAnswers.visibleIds(fields, { allergies: ["no"] }).has("which")).toBe(false);
		expect(FormAnswers.visibleIds(fields, { allergies: ["yes"] }).has("which")).toBe(true);
		// A hidden question is not required, and its answer is dropped.
		const hidden = FormAnswers.check(fields, { name: "Anna", allergies: ["no"], which: "Nüsse" });
		expect(hidden.problems).toEqual({});
		expect(hidden.answers).toEqual({ name: "Anna", allergies: ["no"] });
		expect(FormAnswers.check(fields, { name: "Anna", allergies: ["yes"] }).problems).toEqual({
			which: "required",
		});
	});

	test("a section's condition hides everything up to the next section", () => {
		const sectioned = FormFields.List.parse([
			{ id: "come", type: "single_choice", label: "Kommst du?", options: [{ id: "y", label: "Ja" }] },
			{
				id: "s1",
				type: "section",
				label: "Details",
				condition: { field_id: "come", option_ids: ["y"] },
			},
			{ id: "food", type: "short_text", label: "Essen", required: true },
			{ id: "s2", type: "section", label: "Zum Schluss" },
			{ id: "note", type: "short_text", label: "Anmerkung" },
		]);
		const shown = FormAnswers.visibleIds(sectioned, {});
		expect([...shown]).toEqual(["come", "s2", "note"]);
		expect(FormAnswers.check(sectioned, {}).problems).toEqual({});
	});

	test("answers are checked by type", () => {
		const typed = FormFields.List.parse([
			{ id: "n", type: "number", label: "Alter", min: 6, max: 17, integer: true },
			{ id: "d", type: "date", label: "Datum" },
			{ id: "e", type: "email", label: "E-Mail" },
			{ id: "s", type: "scale", label: "Skala", min: 0, max: 10 },
			{ id: "m", type: "multiple_choice", label: "Mehrere", options: [{ id: "a", label: "A" }] },
		]);
		const { problems } = FormAnswers.check(typed, {
			n: 5.5,
			d: "2027-02-30",
			e: "keine-adresse",
			s: 11,
			m: ["a", "a"],
		});
		expect(problems).toEqual({
			n: "not_integer",
			d: "invalid",
			e: "invalid",
			s: "invalid",
			m: "invalid",
		});
		expect(FormAnswers.check(typed, { n: 18 }).problems).toEqual({ n: "too_large" });
	});

	test("conditions may only name an earlier choice question", () => {
		expect(FormFields.problemsOf(FormFields.List.parse([]))).toEqual([]);
		const later = FormFields.List.safeParse([
			{ id: "a", type: "short_text", label: "A", condition: { field_id: "b", option_ids: ["x"] } },
			{ id: "b", type: "single_choice", label: "B", options: [{ id: "x", label: "X" }] },
		]);
		expect(later.success).toBe(false);
	});

	test("the starter templates are valid", () => {
		expect(FormStarters.TEMPLATES.map((template) => template.title)).toEqual([
			"Feedback",
			"Anmeldung",
			"Veranstaltungsbewertung",
		]);
	});
});

describe("Templates", () => {
	test("every org starts with the starter templates, once", async () => {
		const templates = await makeAPIRequest("/v1/org/form-templates", { authToken: volunteer.token });
		const titles = templates.map((template: any) => template.title);
		for (const title of ["Feedback", "Anmeldung", "Veranstaltungsbewertung"]) {
			expect(titles).toContain(title);
		}
		FormStarters.addTo(OrgContext.current());
		expect(
			await makeAPIRequest("/v1/org/form-templates", { authToken: volunteer.token }),
		).toHaveLength(templates.length);
	});

	test("only the core team manages templates", async () => {
		await makeAPIRequest(
			"/v1/org/form-templates",
			{ method: "POST", authToken: volunteer.token, body: { title: "Meine" } },
			403,
		);
		const template = await makeAPIRequest(
			"/v1/org/form-templates",
			{ method: "POST", authToken: core.token, body: { title: "Elternabend" } },
			201,
		);
		expect(template.scope).toBe("template");
		await makeAPIRequest(`/v1/forms/${template.id}`, { authToken: leader.token }, 403);
		await setStatus(template.id, "open", 400);
	});

	test("a form starts with the template's questions; changing the form keeps the template", async () => {
		const templates = await makeAPIRequest("/v1/org/form-templates", { authToken: core.token });
		const anmeldung = templates.find((template: any) => template.title === "Anmeldung");
		const form = await makeAPIRequest(
			`/v1/events/${eventId}/forms`,
			{
				method: "POST",
				authToken: leader.token,
				body: { title: "Anmeldung 2027", template_id: anmeldung.id },
			},
			201,
		);
		expect(form.scope).toBe("event");
		expect(form.fields.map((field: any) => field.id)).toContain("allergien_welche");
		await setFields(form.id, [], 200, leader.token);
		const unchanged = await makeAPIRequest(`/v1/forms/${anmeldung.id}`, { authToken: core.token });
		expect(unchanged.fields.length).toBeGreaterThan(0);

		// Not a template: 404.
		await makeAPIRequest(
			"/v1/org/forms",
			{ method: "POST", authToken: core.token, body: { title: "X", template_id: form.id } },
			404,
		);
	});
});

describe("Who manages forms", () => {
	test("Kernteam forms: core team only", async () => {
		const form = await createOrgForm("Intern");
		await makeAPIRequest("/v1/org/forms", { authToken: volunteer.token }, 403);
		await makeAPIRequest(`/v1/forms/${form.id}`, { authToken: volunteer.token }, 403);
		await makeAPIRequest(`/v1/forms/${form.id}`, { authToken: leader.token }, 403);
		const list = await makeAPIRequest("/v1/org/forms", { authToken: core.token });
		expect(list.map((entry: any) => entry.id)).toContain(form.id);
	});

	test("event forms: the Leitung (and the core team), not the rest of the team", async () => {
		const form = await makeAPIRequest(
			`/v1/events/${eventId}/forms`,
			{ method: "POST", authToken: leader.token, body: { title: "Feedback" } },
			201,
		);
		await makeAPIRequest(`/v1/events/${eventId}/forms`, { authToken: staff.token }, 403);
		await makeAPIRequest(
			`/v1/events/${eventId}/forms`,
			{ method: "POST", authToken: staff.token, body: { title: "X" } },
			403,
		);
		await makeAPIRequest(`/v1/forms/${form.id}`, { authToken: staff.token }, 403);
		await makeAPIRequest(`/v1/forms/${form.id}/responses`, { authToken: staff.token }, 403);
		await makeAPIRequest(`/v1/forms/${form.id}`, { authToken: core.token });
		const list = await makeAPIRequest(`/v1/events/${eventId}/forms`, { authToken: leader.token });
		expect(list.map((entry: any) => entry.id)).toContain(form.id);

		// Saving it as a template is the core team's.
		await makeAPIRequest(
			`/v1/forms/${form.id}/copy`,
			{ method: "POST", authToken: leader.token, body: { title: "Vorlage", as_template: true } },
			403,
		);
		const copy = await makeAPIRequest(
			`/v1/forms/${form.id}/copy`,
			{ method: "POST", authToken: leader.token, body: { title: "Feedback (Kopie)" } },
			201,
		);
		expect(copy.event_id).toBe(eventId);
		expect(copy.status).toBe("draft");
	});

	test("questions are checked when saved", async () => {
		const form = await createOrgForm();
		await setFields(form.id, [{ id: "a", type: "short_text", label: "" }], 400);
		await setFields(
			form.id,
			[
				{ id: "a", type: "short_text", label: "A" },
				{ id: "a", type: "short_text", label: "B" },
			],
			400,
		);
		await setFields(form.id, [{ id: "c", type: "single_choice", label: "C", options: [] }], 400);
	});
});

describe("Publishing and answering", () => {
	test("a draft has no link; publishing needs a question", async () => {
		const form = await createOrgForm("Leer");
		expect(form.public_url).toBeNull();
		await setStatus(form.id, "open", 400);
		await setFields(form.id, [{ id: "s", type: "section", label: "Nur Text" }]);
		await setStatus(form.id, "open", 400);
	});

	test("answers are checked, numbered and listed", async () => {
		const { id, token } = await publishedForm();
		const opened = await makeAPIRequest(`/v1/public/forms/${token}`);
		expect(opened.accepting).toBe(true);
		expect(opened.fields).toHaveLength(QUESTIONS.length);

		await send(token, { name: "Anna", allergies: ["yes"] }, 400);
		await send(token, { name: "Anna", allergies: ["maybe"] }, 400);
		await send(token, { name: "  Anna  ", allergies: ["no"], which: "wird verworfen", stars: 4 });
		await send(token, { name: "Ben", allergies: ["yes"], which: "Nüsse", unknown: "x" });

		const responses = await makeAPIRequest(`/v1/forms/${id}/responses`, { authToken: core.token });
		expect(responses.map((response: any) => response.number)).toEqual([2, 1]);
		expect(responses[1].answers).toEqual({ name: "Anna", allergies: ["no"], stars: 4 });
		expect(responses[0].answers).toEqual({ name: "Ben", allergies: ["yes"], which: "Nüsse" });

		const summary = await makeAPIRequest(`/v1/forms/${id}`, { authToken: core.token });
		expect(summary.response_count).toBe(2);
		expect(summary.question_count).toBe(QUESTIONS.length);
	});

	test("a deleted answer's number is not given again; deleting all starts over", async () => {
		const { id, token } = await publishedForm("Nummern");
		await send(token, { name: "A", allergies: ["no"] });
		await send(token, { name: "B", allergies: ["no"] });
		const [second] = await makeAPIRequest(`/v1/forms/${id}/responses`, { authToken: core.token });
		await makeAPIRequest(`/v1/forms/${id}/responses/${second.id}`, {
			method: "DELETE",
			authToken: core.token,
		});
		await send(token, { name: "C", allergies: ["no"] });
		let numbers = (await makeAPIRequest(`/v1/forms/${id}/responses`, { authToken: core.token })).map(
			(response: any) => response.number,
		);
		expect(numbers).toEqual([3, 1]);

		await makeAPIRequest(`/v1/forms/${id}/responses`, { method: "DELETE", authToken: core.token });
		await send(token, { name: "D", allergies: ["no"] });
		numbers = (await makeAPIRequest(`/v1/forms/${id}/responses`, { authToken: core.token })).map(
			(response: any) => response.number,
		);
		expect(numbers).toEqual([1]);
		expect(auditSummaries(id)).toContain("Antwort Nr. 2 auf Formular „Nummern“ gelöscht");
		expect(auditSummaries(id)).toContain("Alle 2 Antworten auf Formular „Nummern“ gelöscht");
	});

	test("closing stops answers, reopening takes them again", async () => {
		const { id, token } = await publishedForm("Abstimmung");
		await setStatus(id, "closed");
		const closed = await makeAPIRequest(`/v1/public/forms/${token}`);
		expect(closed.accepting).toBe(false);
		expect(closed.fields).toEqual([]);
		await send(token, { name: "Zu spät", allergies: ["no"] }, 409);

		const reopened = await setStatus(id, "open");
		expect(tokenOf(reopened.public_url)).toBe(token);
		await send(token, { name: "Wieder da", allergies: ["no"] });
		expect(auditSummaries(id)).toEqual(
			expect.arrayContaining([
				"Formular „Abstimmung“ veröffentlicht",
				"Formular „Abstimmung“ geschlossen",
				"Formular „Abstimmung“ wieder geöffnet",
			]),
		);
	});

	test("a closing time that has passed stops answers; reopening drops it", async () => {
		const { id, token } = await publishedForm("Frist");
		await makeAPIRequest(`/v1/forms/${id}`, {
			method: "PUT",
			authToken: core.token,
			body: { closes_at: Date.now() - 1000 },
		});
		expect((await makeAPIRequest(`/v1/public/forms/${token}`)).accepting).toBe(false);
		await send(token, { name: "X", allergies: ["no"] }, 409);
		await setStatus(id, "closed");
		const reopened = await setStatus(id, "open");
		expect(reopened.closes_at).toBeNull();
		expect(reopened.accepting).toBe(true);
	});

	test("the honeypot gets a thank-you and nothing is stored", async () => {
		const { id, token } = await publishedForm("Honig");
		const answer = await send(token, { name: "Bot", allergies: ["no"] }, 201, {
			website: "https://spam.example",
		});
		expect(answer.confirmation_message).toBeTruthy();
		expect(await makeAPIRequest(`/v1/forms/${id}/responses`, { authToken: core.token })).toEqual([]);
	});

	test("a visitor's expired session doesn't get in the way", async () => {
		const { token } = await publishedForm("Mit altem Login");
		const stale = { Authorization: "Bearer iventworks_sess_1:abgelaufen" };
		const opened = await makeAPIRequest(`/v1/public/forms/${token}`, {
			additionalOptions: { headers: stale },
		});
		expect(opened.accepting).toBe(true);
		await makeAPIRequest(
			`/v1/public/forms/${token}/responses`,
			{
				method: "POST",
				body: { answers: { name: "Anna", allergies: ["no"] } },
				additionalOptions: { headers: stale },
			},
			201,
		);
	});

	test("unknown links, drafts and other orgs answer 404", async () => {
		await makeAPIRequest("/v1/public/forms/gibtesnicht", {}, 404);
		const { token } = await publishedForm("Nur hier");
		const other = await OrgService.create({ slug: "forms-other", display_name: "Andere" });
		try {
			await makeAPIRequest(
				`/v1/public/forms/${token}`,
				{ additionalOptions: { headers: { "X-Iventworks-Host": `forms-other.${SYSTEM_HOST}` } } },
				404,
			);
		} finally {
			await OrgService.delete(other.id);
		}
	});

	test("deleting a form deletes its answers", async () => {
		const { id, token } = await publishedForm("Weg damit");
		await send(token, { name: "A", allergies: ["no"] });
		await makeAPIRequest(`/v1/forms/${id}`, { method: "DELETE", authToken: core.token });
		await makeAPIRequest(`/v1/public/forms/${token}`, {}, 404);
		const left = DB.instance()
			.select()
			.from(DB.Tables.formResponses)
			.where(and(inOrg(DB.Tables.formResponses), eq(DB.Tables.formResponses.form_id, id)))
			.all();
		expect(left).toEqual([]);
	});
});

describe("Copying an event", () => {
	test("its forms come along as drafts, without answers or link", async () => {
		const form = await makeAPIRequest(
			`/v1/events/${eventId}/forms`,
			{ method: "POST", authToken: leader.token, body: { title: "Rückmeldung" } },
			201,
		);
		await setFields(form.id, QUESTIONS, 200, leader.token);
		const published = await makeAPIRequest(`/v1/forms/${form.id}/status`, {
			method: "PUT",
			authToken: leader.token,
			body: { status: "open" },
		});
		await send(tokenOf(published.public_url), { name: "Anna", allergies: ["no"] });

		const result = await makeAPIRequest(
			`/v1/events/${eventId}/copy`,
			{
				method: "POST",
				authToken: core.token,
				body: { name: "Herbstfreizeit 2028", start_date: "2028-10-01", end_date: "2028-10-05" },
			},
			201,
		);
		const forms = await makeAPIRequest(`/v1/events/${result.event.id}/forms`, {
			authToken: core.token,
		});
		const copied = forms.find((entry: any) => entry.title === "Rückmeldung");
		expect(copied).toMatchObject({ status: "draft", public_url: null, response_count: 0 });
		expect(copied.question_count).toBe(QUESTIONS.length);
	});
});
