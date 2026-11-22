import { z } from "zod";
import { FORM_SCOPES, FORM_STATUSES } from "../../../db/schema";
import { FormAnswers, FormFields } from "../../../forms/fields";
import { UserSummary } from "./userSummary";

/**
 * Forms ("Formulare") in the API: the lists of the Kernteam (`/org/forms`), of an event
 * (`/events/{id}/forms`) and of the templates (`/org/form-templates`), everything on one form
 * (`/forms/{formId}`) and the public side (`/public/forms/{token}`).
 */
export namespace FormModel {
	export const Status = z.enum(FORM_STATUSES);
	export const Scope = z.enum(FORM_SCOPES);

	export const Summary = z.object({
		id: z.number(),
		scope: Scope,
		event_id: z.number().nullable(),
		title: z.string(),
		description: z.string(),
		status: Status,
		/** Open and not past `closes_at`: the link takes answers. */
		accepting: z.boolean(),
		closes_at: z.number().nullable(),
		published_at: z.number().nullable(),
		closed_at: z.number().nullable(),
		/** The link to fill it in, once published (templates never have one). */
		public_url: z.string().nullable(),
		question_count: z.number(),
		response_count: z.number(),
		last_response_at: z.number().nullable(),
		created_by: UserSummary.Schema.nullable(),
		created_at: z.number(),
		updated_at: z.number(),
	});
	export type Summary = z.infer<typeof Summary>;

	export const Details = Summary.extend({
		fields: z.array(FormFields.Field),
		confirmation_message: z.string(),
		updated_by: UserSummary.Schema.nullable(),
	});
	export type Details = z.infer<typeof Details>;

	export const Params = z.object({
		formId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const Title = z.string().trim().min(1).max(FormFields.MAX_TITLE);
}

export namespace FormModel.List {
	export const Response = z.array(FormModel.Summary);
	export type Response = z.infer<typeof Response>;
}

export namespace FormModel.Create {
	export const Body = z.object({
		title: FormModel.Title,
		/** Start from this template: its description, questions and confirmation text. */
		template_id: z.number().int().positive().nullable().default(null),
	});
	export type Body = z.infer<typeof Body>;
}

export namespace FormModel.Update {
	export const Body = z
		.object({
			title: FormModel.Title,
			/** Markdown, shown above the questions. */
			description: z.string().max(10_000),
			/** Shown after sending; empty: a default text. */
			confirmation_message: z.string().trim().max(2_000),
			closes_at: z.number().int().positive().nullable(),
			fields: FormFields.List,
		})
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;
}

export namespace FormModel.SetStatus {
	export const Body = z.object({
		/** `open` publishes a draft or reopens a closed form; `closed` stops answers. */
		status: z.enum(["open", "closed"]),
	});
	export type Body = z.infer<typeof Body>;
}

export namespace FormModel.Copy {
	export const Body = z.object({
		title: FormModel.Title,
		/** Save it as a template (Kernteam) instead of a new form next to this one. */
		as_template: z.boolean().default(false),
	});
	export type Body = z.infer<typeof Body>;
}

export namespace FormModel.Responses {
	export const Item = z.object({
		id: z.number(),
		number: z.number(),
		answers: FormAnswers.Answers,
		created_at: z.number(),
	});
	export type Item = z.infer<typeof Item>;

	export const Response = z.array(Item);
	export type Response = z.infer<typeof Response>;

	export const Params = FormModel.Params.extend({
		responseId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;
}

export namespace FormModel.Public {
	export const Params = z.object({ token: z.string().min(1).max(64) });
	export type Params = z.infer<typeof Params>;

	export const Form = z.object({
		title: z.string(),
		description: z.string(),
		/** Empty while it takes no answers. */
		fields: z.array(FormFields.Field),
		accepting: z.boolean(),
	});
	export type Form = z.infer<typeof Form>;

	export const Submit = z.object({
		answers: FormAnswers.Answers,
		/** Hidden from people (a honeypot): whatever fills it in is not one. */
		website: z.string().max(500).optional(),
	});
	export type Submit = z.infer<typeof Submit>;

	export const Submitted = z.object({
		confirmation_message: z.string(),
	});
	export type Submitted = z.infer<typeof Submitted>;
}
