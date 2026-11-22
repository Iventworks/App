/**
 * Forms ("Formulare") in the browser: labels, new questions for the editor, answers as text, the
 * statistics and filters of the answers page, the CSV export and the QR code. The rules for
 * questions and answers are the server's (`FormFields` / `FormAnswers`, imported from there).
 */
import { encode } from "uqr";
import type {
	GetFormsByFormIdResponses,
	GetFormsByFormIdResponsesResponses,
	GetOrgFormsResponses,
	GetPublicFormsByTokenResponses,
} from "~/api-client";
import { FormAnswers, FormFields } from "~~/server/lib/forms/fields";
import { Csv } from "~~/server/lib/utils/csv";
import { formatDay, parseDay } from "./format";

export type FormSummary = GetOrgFormsResponses["200"]["data"][number];
export type FormDetails = GetFormsByFormIdResponses["200"]["data"];
export type FormField = FormFields.Field;
export type FormResponse = GetFormsByFormIdResponsesResponses["200"]["data"][number];
export type PublicForm = GetPublicFormsByTokenResponses["200"]["data"];
export type FormAnswerValue = FormAnswers.Value;

export const FORM_FIELD_TYPES: Record<FormFields.Type, { label: string; icon: string }> = {
	short_text: { label: "Kurze Antwort", icon: "i-lucide-text-cursor-input" },
	long_text: { label: "Längere Antwort", icon: "i-lucide-align-left" },
	single_choice: { label: "Einfachauswahl", icon: "i-lucide-circle-dot" },
	multiple_choice: { label: "Mehrfachauswahl", icon: "i-lucide-square-check" },
	dropdown: { label: "Auswahlliste", icon: "i-lucide-square-chevron-down" },
	number: { label: "Zahl", icon: "i-lucide-hash" },
	date: { label: "Datum", icon: "i-lucide-calendar" },
	email: { label: "E-Mail-Adresse", icon: "i-lucide-at-sign" },
	rating: { label: "Bewertung", icon: "i-lucide-star" },
	scale: { label: "Skala", icon: "i-lucide-gauge" },
	section: { label: "Abschnitt", icon: "i-lucide-heading" },
};

/** The question types in the editor's "add" menu, grouped. */
export const FORM_FIELD_GROUPS: FormFields.Type[][] = [
	["short_text", "long_text", "email", "number", "date"],
	["single_choice", "multiple_choice", "dropdown"],
	["rating", "scale"],
	["section"],
];

export type FormState = "draft" | "open" | "expired" | "full" | "closed";

export const FORM_STATES: Record<
	FormState,
	{ label: string; short: string; color: "neutral" | "success" | "warning"; icon: string }
> = {
	draft: { label: "Entwurf", short: "Entwurf", color: "neutral", icon: "i-lucide-pencil-line" },
	open: { label: "Nimmt Antworten an", short: "Offen", color: "success", icon: "i-lucide-radio" },
	expired: {
		label: "Frist abgelaufen",
		short: "Abgelaufen",
		color: "warning",
		icon: "i-lucide-timer-off",
	},
	full: { label: "Antwortlimit erreicht", short: "Voll", color: "warning", icon: "i-lucide-inbox" },
	closed: { label: "Geschlossen", short: "Geschlossen", color: "warning", icon: "i-lucide-lock" },
};

/** Draft, open, past its closing time or full (both still `open`) or closed. */
export function formStateOf(
	form: Pick<FormSummary, "status" | "accepting" | "response_count">,
): FormState {
	if (form.status !== "open") return form.status;
	if (form.accepting) return "open";
	return form.response_count >= FormAnswers.MAX_PER_FORM ? "full" : "expired";
}

/** Ids for new questions and options: short, random, unique within a form. */
export function newFormId() {
	return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newFormField(type: FormFields.Type): FormField {
	const base = { id: newFormId(), label: "", description: "", required: false, condition: null };
	switch (type) {
		case "single_choice":
		case "multiple_choice":
		case "dropdown":
			return {
				...base,
				type,
				options: [
					{ id: newFormId(), label: "Option 1" },
					{ id: newFormId(), label: "Option 2" },
				],
			};
		case "number":
			return { ...base, type, min: null, max: null, integer: false };
		case "rating":
			return { ...base, type, max: 5 };
		case "scale":
			return { ...base, type, min: 1, max: 5, min_label: "", max_label: "" };
		default:
			return { ...base, type };
	}
}

/**
 * A deep, plain copy of questions, also of reactive ones (`structuredClone` throws on proxies, and
 * `toRaw` only unwraps the top level).
 */
export function cloneFormFields<T extends FormField | FormField[]>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/** A copy with new ids (its options too); conditions on its options don't follow it. */
export function duplicateFormField(field: FormField): FormField {
	const copy = cloneFormFields(field);
	copy.id = newFormId();
	if (FormFields.isChoice(copy)) {
		copy.options = copy.options.map((option) => ({ ...option, id: newFormId() }));
	}
	return copy;
}

/**
 * What keeps the questions from being saved, by question id, in German — the editor's version of
 * `FormFields.problemsOf`, which the server checks again.
 */
export function formFieldProblems(fields: FormField[]): Record<string, string> {
	const problems: Record<string, string> = {};
	const earlier = new Map<string, FormField>();
	for (const field of fields) {
		const problem = (() => {
			if (field.type === "section") {
				if (!field.label.trim() && !field.description.trim()) {
					return "Der Abschnitt braucht eine Überschrift oder einen Text.";
				}
			} else if (!field.label.trim()) {
				return "Die Frage hat noch keinen Text.";
			}
			if (FormFields.isChoice(field)) {
				if (!field.options.length) return "Die Frage braucht mindestens eine Option.";
				if (field.options.some((option) => !option.label.trim())) return "Eine Option hat keinen Text.";
			}
			if (
				field.type === "number" &&
				field.min !== null &&
				field.max !== null &&
				field.min > field.max
			) {
				return "Das Minimum ist größer als das Maximum.";
			}
			if (field.condition) {
				const target = earlier.get(field.condition.field_id);
				if (!target || !FormFields.isChoice(target)) {
					return "Die Bedingung bezieht sich auf eine Frage, die nicht mehr davor steht.";
				}
				if (!field.condition.option_ids.length)
					return "Wähle für die Bedingung mindestens eine Antwort.";
				if (
					field.condition.option_ids.some((id) => !target.options.some((option) => option.id === id))
				) {
					return "Die Bedingung nennt eine Antwort, die es nicht mehr gibt.";
				}
			}
			return null;
		})();
		if (problem) problems[field.id] = problem;
		earlier.set(field.id, field);
	}
	return problems;
}

/** The German message for a problem `FormAnswers.check` found. */
export function answerProblemText(field: FormField, problem: FormAnswers.Problem): string {
	switch (problem) {
		case "required":
			return "Bitte beantworte diese Frage.";
		case "too_long":
			return "Diese Antwort ist zu lang.";
		case "not_integer":
			return "Bitte gib eine ganze Zahl ein.";
		case "too_small":
			return field.type === "number" && field.min !== null
				? `Bitte gib mindestens ${field.min.toLocaleString("de-DE")} ein.`
				: "Diese Zahl ist zu klein.";
		case "too_large":
			return field.type === "number" && field.max !== null
				? `Bitte gib höchstens ${field.max.toLocaleString("de-DE")} ein.`
				: "Diese Zahl ist zu groß.";
		default:
			if (field.type === "email") return "Bitte gib eine gültige E-Mail-Adresse ein.";
			if (field.type === "date") return "Bitte gib ein gültiges Datum ein.";
			return "Diese Antwort ist ungültig.";
	}
}

/** Label of an option, also for options removed since the answer came. */
export function optionLabel(field: FormField, optionId: string) {
	if (!FormFields.isChoice(field)) return optionId;
	return field.options.find((option) => option.id === optionId)?.label ?? "(entfernte Option)";
}

/** An answer as text (tables, export, the single answer). */
export function answerText(field: FormField, value: FormAnswerValue | undefined): string {
	if (value === undefined || FormAnswers.isEmpty(value)) return "";
	// Given before the question's type changed: shown as it was stored.
	if (!FormAnswers.fits(field, value)) {
		if (Array.isArray(value)) return value.join(", ");
		return typeof value === "number" ? value.toLocaleString("de-DE") : value;
	}
	if (Array.isArray(value)) return value.map((id) => optionLabel(field, id)).join(", ");
	if (typeof value === "number") {
		if (field.type === "rating") return `${value} von ${field.max}`;
		return value.toLocaleString("de-DE");
	}
	if (field.type === "date") return formatDay(value);
	return value;
}

// --- Filters and statistics ---------------------------------------------------------------------

export interface FormResponseFilter {
	/** Received from this day on (`YYYY-MM-DD`, local). */
	from: string | null;
	/** Received up to and including this day. */
	to: string | null;
	/** A choice question and the options of which one must be chosen. */
	fieldId: string | undefined;
	optionIds: string[];
	/** Text in any answer. */
	search: string;
}

export function emptyResponseFilter(): FormResponseFilter {
	return { from: null, to: null, fieldId: undefined, optionIds: [], search: "" };
}

/** The start of the day after `day`, local time (not `+ 24 h`: wrong on DST days). */
function dayAfter(day: string) {
	const date = parseDay(day);
	date.setDate(date.getDate() + 1);
	return date.getTime();
}

export function filterResponses(
	fields: FormField[],
	responses: FormResponse[],
	filter: FormResponseFilter,
): FormResponse[] {
	const from = filter.from ? parseDay(filter.from).getTime() : null;
	const to = filter.to ? dayAfter(filter.to) : null;
	const search = filter.search.trim().toLowerCase();
	const byId = new Map(fields.map((field) => [field.id, field]));
	return responses.filter((response) => {
		if (from !== null && response.created_at < from) return false;
		if (to !== null && response.created_at >= to) return false;
		if (filter.fieldId && filter.optionIds.length) {
			const answer = response.answers[filter.fieldId];
			if (!Array.isArray(answer) || !filter.optionIds.some((id) => answer.includes(id))) return false;
		}
		if (search) {
			const text = Object.entries(response.answers)
				.map(([id, value]) => {
					const field = byId.get(id);
					return field ? answerText(field, value) : "";
				})
				.join(" ")
				.toLowerCase();
			if (!text.includes(search) && !String(response.number).includes(search)) return false;
		}
		return true;
	});
}

export type FieldStats =
	| { kind: "choice"; answered: number; rows: { id: string; label: string; count: number }[] }
	| {
			kind: "numbers";
			answered: number;
			average: number | null;
			min: number | null;
			max: number | null;
			/** Distribution for rating and scale (every step), else empty. */
			rows: { id: string; label: string; count: number }[];
	  }
	| { kind: "text"; answered: number; latest: { number: number; text: string }[] };

/**
 * What the answers say about one question (`responses` newest first). Answers that don't fit its
 * type (given before the type changed) are left out.
 */
export function fieldStats(field: FormField, responses: FormResponse[]): FieldStats {
	const values = responses
		.map((response) => ({ number: response.number, value: response.answers[field.id] }))
		.filter(
			(entry): entry is { number: number; value: FormAnswerValue } =>
				entry.value !== undefined &&
				!FormAnswers.isEmpty(entry.value) &&
				FormAnswers.fits(field, entry.value),
		);

	if (FormFields.isChoice(field)) {
		const counts = new Map<string, number>();
		for (const { value } of values) {
			for (const id of value as string[]) counts.set(id, (counts.get(id) ?? 0) + 1);
		}
		const rows = field.options.map((option) => ({
			id: option.id,
			label: option.label,
			count: counts.get(option.id) ?? 0,
		}));
		const removed = [...counts.entries()]
			.filter(([id]) => !field.options.some((option) => option.id === id))
			.reduce((total, [, count]) => total + count, 0);
		if (removed) rows.push({ id: "", label: "(entfernte Optionen)", count: removed });
		return { kind: "choice", answered: values.length, rows };
	}

	if (field.type === "number" || field.type === "rating" || field.type === "scale") {
		const numbers = values.map(({ value }) => value as number);
		const steps =
			field.type === "rating"
				? Array.from({ length: field.max }, (_, index) => index + 1)
				: field.type === "scale"
					? Array.from({ length: field.max - field.min + 1 }, (_, index) => field.min + index)
					: [];
		return {
			kind: "numbers",
			answered: numbers.length,
			average: numbers.length ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length : null,
			min: numbers.length ? Math.min(...numbers) : null,
			max: numbers.length ? Math.max(...numbers) : null,
			rows: steps.map((step) => ({
				id: String(step),
				label: field.type === "rating" ? `${step} ${step === 1 ? "Stern" : "Sterne"}` : String(step),
				count: numbers.filter((n) => n === step).length,
			})),
		};
	}

	return {
		kind: "text",
		answered: values.length,
		latest: values.map(({ number, value }) => ({
			number,
			text: answerText(field, value),
		})),
	};
}

// --- Export -------------------------------------------------------------------------------------

/** The answers as CSV for spreadsheets (UTF-8 with BOM, `;`), oldest first. */
export function responsesCsv(fields: FormField[], responses: FormResponse[]) {
	const questions = FormFields.questionsOf(fields);
	const header = ["Nr.", "Eingegangen", ...questions.map((field) => field.label)];
	const rows = [...responses]
		.sort((a, b) => a.number - b.number)
		.map((response) => [
			response.number,
			new Date(response.created_at).toLocaleString("de-DE"),
			...questions.map((field) => {
				const value = response.answers[field.id];
				return typeof value === "number" && field.type !== "rating" ? value : answerText(field, value);
			}),
		]);
	return Csv.table([header, ...rows]);
}

// --- QR code ------------------------------------------------------------------------------------

/** The QR code's modules (with a quiet zone of 4, as the standard asks). */
export function qrMatrix(value: string) {
	return encode(value, { ecc: "M", border: 4 }).data;
}

/** The QR code as an SVG path in module units (one `M…h1v1h-1z` per dark module). */
export function qrPath(matrix: boolean[][]) {
	let path = "";
	matrix.forEach((row, y) => {
		row.forEach((dark, x) => {
			if (dark) path += `M${x} ${y}h1v1h-1z`;
		});
	});
	return path;
}

export function qrSvg(value: string) {
	const matrix = qrMatrix(value);
	const size = matrix.length;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * 10}" height="${size * 10}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${qrPath(matrix)}" fill="#000"/></svg>`;
}

/** The QR code as a PNG, `pixels` wide (sharp enough for slides and print). */
export async function qrPng(value: string, pixels = 1200): Promise<Blob | null> {
	const matrix = qrMatrix(value);
	const scale = Math.max(1, Math.floor(pixels / matrix.length));
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = matrix.length * scale;
	const context = canvas.getContext("2d");
	if (!context) return null;
	context.fillStyle = "#fff";
	context.fillRect(0, 0, canvas.width, canvas.height);
	context.fillStyle = "#000";
	matrix.forEach((row, y) => {
		row.forEach((dark, x) => {
			if (dark) context.fillRect(x * scale, y * scale, scale, scale);
		});
	});
	return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
