import { and, count, desc, eq, inArray, max, sql } from "drizzle-orm";
import { FileShares } from "../api/utils/fileShares";
import type { FormModel } from "../api/utils/shared-models/forms";
import { UserSummary } from "../api/utils/shared-models/userSummary";
import { DB } from "../db";
import { inOrg, OrgContext } from "../orgs/context";
import { FormAnswers, FormFields } from "./fields";

/**
 * Forms ("Formulare", `forms` / `form_responses`): the lists, creating (also from a template),
 * publishing and closing, copies, and the answers. Who may do what is checked by the routes.
 */
export namespace FormService {
	/** Answers one form keeps at most: the whole list goes to the browser for the statistics. */
	export const MAX_RESPONSES = FormAnswers.MAX_PER_FORM;

	type Where = { scope: "org" | "template" } | { scope: "event"; eventId: number };

	export async function get(id: number) {
		return (
			(await DB.instance()
				.select()
				.from(DB.Tables.forms)
				.where(and(inOrg(DB.Tables.forms), eq(DB.Tables.forms.id, id)))
				.get()) ?? null
		);
	}

	/** A template of this org, or null. */
	export async function template(id: number) {
		const form = await get(id);
		return form?.scope === "template" ? form : null;
	}

	/** Open and not past its closing time (it may still be full, see `accepting`). */
	export function isOpen(form: DB.Models.Form, now = Date.now()) {
		return form.status === "open" && (form.closes_at === null || form.closes_at > now);
	}

	/** Takes answers: open, not past its closing time and below `MAX_RESPONSES`. */
	export function accepting(form: DB.Models.Form, responseCount: number, now = Date.now()) {
		return isOpen(form, now) && responseCount < MAX_RESPONSES;
	}

	export async function responseCount(formId: number) {
		const T = DB.Tables;
		return (
			(
				await DB.instance()
					.select({ value: count() })
					.from(T.formResponses)
					.where(and(inOrg(T.formResponses), eq(T.formResponses.form_id, formId)))
					.get()
			)?.value ?? 0
		);
	}

	export function publicUrl(token: string) {
		return `${OrgContext.current().url}/s/form/${token}`;
	}

	/** "Formular „Titel“" / "Formularvorlage „Titel“" for audit entries. */
	export function describe(form: Pick<DB.Models.Form, "scope" | "title">) {
		return `${form.scope === "template" ? "Formularvorlage" : "Formular"} „${form.title}“`;
	}

	export async function list(where: Where): Promise<FormModel.Summary[]> {
		const T = DB.Tables;
		const rows = await DB.instance()
			.select()
			.from(T.forms)
			.where(
				and(
					inOrg(T.forms),
					eq(T.forms.scope, where.scope),
					where.scope === "event" ? eq(T.forms.event_id, where.eventId) : undefined,
				),
			)
			.orderBy(desc(T.forms.updated_at), desc(T.forms.id))
			.all();
		return await summaries(rows);
	}

	async function responseStats(formIds: number[]) {
		if (!formIds.length) return new Map<number, { count: number; last: number | null }>();
		const T = DB.Tables;
		const rows = await DB.instance()
			.select({
				form_id: T.formResponses.form_id,
				count: count(),
				last: max(T.formResponses.created_at),
			})
			.from(T.formResponses)
			.where(and(inOrg(T.formResponses), inArray(T.formResponses.form_id, formIds)))
			.groupBy(T.formResponses.form_id)
			.all();
		return new Map(rows.map((row) => [row.form_id, { count: row.count, last: row.last }]));
	}

	export async function summaries(forms: DB.Models.Form[]): Promise<FormModel.Summary[]> {
		const [stats, users] = await Promise.all([
			responseStats(forms.map((form) => form.id)),
			UserSummary.fetchMap(forms.map((form) => form.created_by)),
		]);
		return forms.map((form) => {
			const responses = stats.get(form.id);
			return {
				id: form.id,
				scope: form.scope,
				event_id: form.event_id,
				title: form.title,
				description: form.description,
				status: form.status,
				accepting: accepting(form, responses?.count ?? 0),
				closes_at: form.closes_at,
				published_at: form.published_at,
				closed_at: form.closed_at,
				public_url: form.token && form.scope !== "template" ? publicUrl(form.token) : null,
				question_count: FormFields.questionsOf(form.fields).length,
				response_count: responses?.count ?? 0,
				last_response_at: responses?.last ?? null,
				created_by: form.created_by ? (users.get(form.created_by) ?? null) : null,
				created_at: form.created_at,
				updated_at: form.updated_at,
			};
		});
	}

	export async function details(form: DB.Models.Form): Promise<FormModel.Details> {
		const [[summary], users] = await Promise.all([
			summaries([form]),
			UserSummary.fetchMap([form.updated_by]),
		]);
		return {
			...(summary as FormModel.Summary),
			fields: form.fields,
			confirmation_message: form.confirmation_message,
			updated_by: form.updated_by ? (users.get(form.updated_by) ?? null) : null,
		};
	}

	/** A new draft (or template), empty or with the questions and texts of `template`. */
	export async function create(input: {
		scope: DB.Models.Form["scope"];
		eventId: number | null;
		title: string;
		from: Pick<DB.Models.Form, "description" | "fields" | "confirmation_message"> | null;
		userId: number | null;
	}) {
		const now = Date.now();
		return await DB.instance()
			.insert(DB.Tables.forms)
			.values({
				scope: input.scope,
				event_id: input.scope === "event" ? input.eventId : null,
				title: input.title,
				description: input.from?.description ?? "",
				fields: input.from?.fields ?? [],
				confirmation_message: input.from?.confirmation_message ?? "",
				created_by: input.userId,
				updated_by: input.userId,
				created_at: now,
				updated_at: now,
				org_id: OrgContext.id(),
			})
			.returning()
			.get();
	}

	export async function update(
		form: DB.Models.Form,
		changes: Partial<
			Pick<DB.Models.Form, "title" | "description" | "confirmation_message" | "closes_at" | "fields">
		>,
		userId: number,
	) {
		return await DB.instance()
			.update(DB.Tables.forms)
			.set({ ...changes, updated_by: userId, updated_at: Date.now() })
			.where(and(inOrg(DB.Tables.forms), eq(DB.Tables.forms.id, form.id)))
			.returning()
			.get();
	}

	/**
	 * Publish a draft (it gets its link), reopen a closed form or one past its closing time (a
	 * closing time that has passed is dropped, or it would close again at once) or close it.
	 * Returns the form unchanged when there is nothing to do.
	 */
	export async function setStatus(form: DB.Models.Form, status: "open" | "closed", userId: number) {
		const now = Date.now();
		const expired = form.closes_at !== null && form.closes_at <= now;
		if (form.status === status && !(status === "open" && expired)) return form;
		const set: Partial<typeof DB.Tables.forms.$inferInsert> = {
			status,
			updated_by: userId,
			updated_at: now,
		};
		if (status === "open") {
			set.token = form.token ?? FileShares.createToken();
			set.published_at = form.published_at ?? now;
			set.closed_at = null;
			if (expired) set.closes_at = null;
		} else {
			set.closed_at = now;
		}
		return await DB.instance()
			.update(DB.Tables.forms)
			.set(set)
			.where(and(inOrg(DB.Tables.forms), eq(DB.Tables.forms.id, form.id)))
			.returning()
			.get();
	}

	export async function responses(form: DB.Models.Form): Promise<FormModel.Responses.Item[]> {
		const T = DB.Tables;
		return await DB.instance()
			.select({
				id: T.formResponses.id,
				number: T.formResponses.number,
				answers: T.formResponses.answers,
				created_at: T.formResponses.created_at,
			})
			.from(T.formResponses)
			.where(and(inOrg(T.formResponses), eq(T.formResponses.form_id, form.id)))
			.orderBy(desc(T.formResponses.number))
			.all();
	}

	/**
	 * Store checked answers with the next number. Synchronous (one transaction: two people sending
	 * at once get different numbers). `null`: the form already has `MAX_RESPONSES` answers.
	 */
	export function submit(form: DB.Models.Form, answers: FormAnswers.Answers) {
		const T = DB.Tables;
		return DB.instance().transaction((tx) => {
			const total =
				tx
					.select({ value: count() })
					.from(T.formResponses)
					.where(and(inOrg(T.formResponses), eq(T.formResponses.form_id, form.id)))
					.get()?.value ?? 0;
			if (total >= MAX_RESPONSES) return null;
			const counted = tx
				.update(T.forms)
				.set({ last_response_number: sql`${T.forms.last_response_number} + 1` })
				.where(and(inOrg(T.forms), eq(T.forms.id, form.id)))
				.returning({ number: T.forms.last_response_number })
				.get();
			if (!counted) return null;
			return tx
				.insert(T.formResponses)
				.values({
					form_id: form.id,
					number: counted.number,
					answers,
					created_at: Date.now(),
					org_id: OrgContext.id(),
				})
				.returning()
				.get();
		});
	}

	/** Delete one answer (its number stays used) or all of them (numbering starts again). */
	export function deleteResponses(form: DB.Models.Form, responseId?: number) {
		const T = DB.Tables;
		return DB.instance().transaction((tx) => {
			const removed = tx
				.delete(T.formResponses)
				.where(
					and(
						inOrg(T.formResponses),
						eq(T.formResponses.form_id, form.id),
						responseId === undefined ? undefined : eq(T.formResponses.id, responseId),
					),
				)
				.returning({ id: T.formResponses.id, number: T.formResponses.number })
				.all();
			if (responseId === undefined) {
				tx
					.update(T.forms)
					.set({ last_response_number: 0 })
					.where(and(inOrg(T.forms), eq(T.forms.id, form.id)))
					.run();
			}
			return removed;
		});
	}

	/** Delete the form with its answers; returns how many answers it had. */
	export async function remove(form: DB.Models.Form) {
		const T = DB.Tables;
		const answers = (await responseStats([form.id])).get(form.id)?.count ?? 0;
		await DB.instance()
			.delete(T.forms)
			.where(and(inOrg(T.forms), eq(T.forms.id, form.id)))
			.run();
		return answers;
	}
}
