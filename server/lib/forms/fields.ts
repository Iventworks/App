import { z } from "zod";

/**
 * The questions of a form (`forms.fields`) and the answers to them (`form_responses.answers`).
 * Pure, without server imports: the frontend imports this file too, so the form people fill in
 * shows and checks exactly what the server accepts.
 *
 * - Every question has a stable `id` (made by the editor); answers, conditions and the
 *   statistics refer to it, so a question can be renamed or moved without losing its answers.
 *   Options of choice questions have ids for the same reason.
 * - A `section` is a heading with text and no answer. Its condition hides everything up to the
 *   next section.
 * - Conditions (`condition`) show a question or section only when an earlier choice question
 *   (single choice, dropdown, multiple choice) has one of the given options. A hidden question is
 *   never required, and its answer is dropped — also for questions that depend on it.
 * - Answers: text, email and date (`YYYY-MM-DD`) are strings, number, rating and scale numbers,
 *   choice questions arrays of option ids (one for single choice and dropdown).
 */
export namespace FormFields {
	export const TYPES = [
		"short_text",
		"long_text",
		"single_choice",
		"multiple_choice",
		"dropdown",
		"number",
		"date",
		"email",
		"rating",
		"scale",
		"section",
	] as const;
	export type Type = (typeof TYPES)[number];

	export const CHOICE_TYPES = ["single_choice", "multiple_choice", "dropdown"] as const;
	export type ChoiceType = (typeof CHOICE_TYPES)[number];

	export const MAX_FIELDS = 200;
	export const MAX_OPTIONS = 100;
	export const MAX_SHORT_TEXT = 1_000;
	export const MAX_LONG_TEXT = 10_000;
	export const MAX_EMAIL = 254;

	export const Id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

	export const Option = z.object({
		id: Id,
		label: z.string().trim().min(1).max(200),
	});
	export type Option = z.infer<typeof Option>;

	/** Show the question or section only when `field_id` has one of `option_ids` selected. */
	export const Condition = z.object({
		field_id: Id,
		option_ids: z.array(Id).min(1).max(MAX_OPTIONS),
	});
	export type Condition = z.infer<typeof Condition>;

	const base = {
		id: Id,
		/** The question (a section's heading). */
		label: z.string().trim().max(500),
		/** Help text below the question (a section's text). */
		description: z.string().max(2_000).default(""),
		required: z.boolean().default(false),
		condition: Condition.nullable().default(null),
	};

	const options = z.array(Option).min(1).max(MAX_OPTIONS);

	export const Field = z.discriminatedUnion("type", [
		z.object({ ...base, type: z.literal("short_text") }),
		z.object({ ...base, type: z.literal("long_text") }),
		z.object({ ...base, type: z.literal("single_choice"), options }),
		z.object({ ...base, type: z.literal("multiple_choice"), options }),
		z.object({ ...base, type: z.literal("dropdown"), options }),
		z.object({
			...base,
			type: z.literal("number"),
			min: z.number().nullable().default(null),
			max: z.number().nullable().default(null),
			/** Whole numbers only. */
			integer: z.boolean().default(false),
		}),
		z.object({ ...base, type: z.literal("date") }),
		z.object({ ...base, type: z.literal("email") }),
		/** Stars from 1 to `max`. */
		z.object({ ...base, type: z.literal("rating"), max: z.number().int().min(3).max(10).default(5) }),
		/** A row of numbers from `min` to `max`, with optional words at both ends. */
		z.object({
			...base,
			type: z.literal("scale"),
			min: z.number().int().min(0).max(1).default(1),
			max: z.number().int().min(2).max(10).default(5),
			min_label: z.string().trim().max(100).default(""),
			max_label: z.string().trim().max(100).default(""),
		}),
		z.object({ ...base, type: z.literal("section") }),
	]);
	export type Field = z.infer<typeof Field>;
	export type ChoiceField = Extract<Field, { type: ChoiceType }>;

	/** Everything `List` checks beyond the single fields, as English messages (400). */
	export function problemsOf(fields: Field[]): string[] {
		const problems: string[] = [];
		const seen = new Map<string, Field>();
		for (const [index, field] of fields.entries()) {
			const at = `Question ${index + 1}`;
			if (seen.has(field.id)) problems.push(`${at}: the id "${field.id}" is used twice`);
			if (field.type === "section") {
				if (!field.label && !field.description.trim()) {
					problems.push(`${at}: a section needs a heading or a text`);
				}
			} else if (!field.label) {
				problems.push(`${at}: the question has no text`);
			}
			if (isChoice(field)) {
				const ids = new Set(field.options.map((option) => option.id));
				if (ids.size !== field.options.length) problems.push(`${at}: option ids must be unique`);
			}
			if (
				field.type === "number" &&
				field.min !== null &&
				field.max !== null &&
				field.min > field.max
			) {
				problems.push(`${at}: the minimum is above the maximum`);
			}
			if (field.type === "scale" && field.min >= field.max) {
				problems.push(`${at}: the scale needs at least two steps`);
			}
			if (field.condition) {
				const target = seen.get(field.condition.field_id);
				if (!target || !isChoice(target)) {
					problems.push(`${at}: a condition can only refer to an earlier choice question`);
				} else {
					const ids = new Set(target.options.map((option) => option.id));
					if (field.condition.option_ids.some((id) => !ids.has(id))) {
						problems.push(`${at}: the condition names an option the question doesn't have`);
					}
				}
			}
			seen.set(field.id, field);
		}
		return problems;
	}

	export const List = z
		.array(Field)
		.max(MAX_FIELDS)
		.superRefine((fields, ctx) => {
			for (const message of problemsOf(fields)) ctx.addIssue({ code: "custom", message });
		});

	export function isChoice(field: Field): field is ChoiceField {
		return (CHOICE_TYPES as readonly string[]).includes(field.type);
	}

	/** Questions that take an answer (everything but sections). */
	export function questionsOf(fields: Field[]) {
		return fields.filter((field) => field.type !== "section");
	}
}

export namespace FormAnswers {
	export const Value = z.union([
		z.string().max(FormFields.MAX_LONG_TEXT),
		z.number(),
		z.array(z.string().max(40)).max(FormFields.MAX_OPTIONS),
	]);
	export type Value = z.infer<typeof Value>;

	export const Answers = z.record(FormFields.Id, Value);
	export type Answers = z.infer<typeof Answers>;

	/** Why an answer was not accepted — the frontend words these in German. */
	export type Problem =
		| "required"
		| "invalid"
		| "too_long"
		| "too_small"
		| "too_large"
		| "not_integer";

	const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	const DATE = /^\d{4}-\d{2}-\d{2}$/;

	function conditionMet(
		condition: FormFields.Condition | null,
		visible: Set<string>,
		answers: Answers,
	) {
		if (!condition) return true;
		if (!visible.has(condition.field_id)) return false;
		const answer = answers[condition.field_id];
		return Array.isArray(answer) && condition.option_ids.some((id) => answer.includes(id));
	}

	/** Ids of the questions and sections shown for these answers (see the conditions above). */
	export function visibleIds(fields: FormFields.Field[], answers: Answers): Set<string> {
		const visible = new Set<string>();
		let sectionShown = true;
		for (const field of fields) {
			if (field.type === "section") {
				sectionShown = conditionMet(field.condition, visible, answers);
				if (sectionShown) visible.add(field.id);
			} else if (sectionShown && conditionMet(field.condition, visible, answers)) {
				visible.add(field.id);
			}
		}
		return visible;
	}

	export function isEmpty(value: Value | undefined | null) {
		if (value === undefined || value === null) return true;
		if (typeof value === "string") return value.trim() === "";
		if (Array.isArray(value)) return value.length === 0;
		return false;
	}

	function isValidDate(value: string) {
		if (!DATE.test(value)) return false;
		const date = new Date(`${value}T00:00:00Z`);
		return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
	}

	/** The problem with one (non-empty) answer, or null. */
	function problemOf(field: FormFields.Field, value: Value): Problem | null {
		switch (field.type) {
			case "short_text":
			case "long_text": {
				if (typeof value !== "string") return "invalid";
				const max = field.type === "short_text" ? FormFields.MAX_SHORT_TEXT : FormFields.MAX_LONG_TEXT;
				return value.length > max ? "too_long" : null;
			}
			case "email":
				if (typeof value !== "string") return "invalid";
				if (value.trim().length > FormFields.MAX_EMAIL) return "too_long";
				return EMAIL.test(value.trim()) ? null : "invalid";
			case "date":
				return typeof value === "string" && isValidDate(value) ? null : "invalid";
			case "number":
				if (typeof value !== "number") return "invalid";
				if (field.integer && !Number.isInteger(value)) return "not_integer";
				if (field.min !== null && value < field.min) return "too_small";
				if (field.max !== null && value > field.max) return "too_large";
				return null;
			case "rating":
				return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= field.max
					? null
					: "invalid";
			case "scale":
				return typeof value === "number" &&
					Number.isInteger(value) &&
					value >= field.min &&
					value <= field.max
					? null
					: "invalid";
			case "single_choice":
			case "dropdown":
			case "multiple_choice": {
				if (!Array.isArray(value)) return "invalid";
				if (field.type !== "multiple_choice" && value.length !== 1) return "invalid";
				if (new Set(value).size !== value.length) return "invalid";
				const ids = new Set(field.options.map((option) => option.id));
				return value.every((id) => ids.has(id)) ? null : "invalid";
			}
			case "section":
				return "invalid";
		}
	}

	/**
	 * Check answers against the questions: only shown questions count, required ones must be
	 * answered. `answers` holds the accepted answers (trimmed text, nothing for hidden or empty
	 * questions); `problems` what is missing or wrong, by question id.
	 */
	export function check(
		fields: FormFields.Field[],
		raw: Answers,
	): { answers: Answers; problems: Record<string, Problem> } {
		const visible = visibleIds(fields, raw);
		const answers: Answers = {};
		const problems: Record<string, Problem> = {};
		for (const field of fields) {
			if (field.type === "section" || !visible.has(field.id)) continue;
			const value = raw[field.id];
			if (isEmpty(value)) {
				if (field.required) problems[field.id] = "required";
				continue;
			}
			const problem = problemOf(field, value as Value);
			if (problem) {
				problems[field.id] = problem;
				continue;
			}
			answers[field.id] = typeof value === "string" ? value.trim() : (value as Value);
		}
		return { answers, problems };
	}
}
