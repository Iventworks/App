import { z } from "zod";
import { OCCURRENCE_STATUSES } from "../../../../../../db/schema";
import { Occurrences } from "../../../../../utils/occurrences";
import { UserSummary } from "../../../../../utils/shared-models/userSummary";

export namespace EventOccurrencesModel {
	export const Occurrence = Occurrences.ItemSchema;
	export type Occurrence = z.infer<typeof Occurrence>;

	export const Params = z.object({
		eventId: z.coerce.number().int().positive(),
		occurrenceId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const DutyParams = Params.extend({
		responsibilityId: z.coerce.number().int().positive(),
	});
	export type DutyParams = z.infer<typeof DutyParams>;

	const isoDate = z.iso.date("Expected a date in the format YYYY-MM-DD");
	const time = z
		.string()
		.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected a time in the format HH:MM")
		.nullable();

	export const OccurrenceFields = {
		/** Only dates added by hand can be moved; a date of the series is cancelled instead. */
		date: isoDate,
		/** `HH:MM`; null = the time of the series. */
		start_time: time,
		end_time: time,
		/** null = the event's location. */
		location: z.string().trim().max(200).nullable(),
		/** What the date is about ("Thema"). */
		title: z.string().trim().max(200).nullable(),
		notes: z.string().max(10_000),
		status: z.enum(OCCURRENCE_STATUSES),
		cancel_reason: z.string().trim().max(500).nullable(),
	};
}

export namespace EventOccurrencesModel.GetAll {
	export const Query = z.object({
		/** Only dates from this day on (`YYYY-MM-DD`). */
		from: z.iso.date().optional(),
		/** Only dates up to this day. */
		to: z.iso.date().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.object({
		occurrences: z.array(EventOccurrencesModel.Occurrence),
		/** The event's responsibilities — the columns of the duty roster — with who usually does them. */
		responsibilities: z.array(
			z.object({
				id: z.number(),
				title: z.string(),
				assignees: z.array(UserSummary.Schema),
			}),
		),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace EventOccurrencesModel.Create {
	const F = EventOccurrencesModel.OccurrenceFields;

	export const Body = z.object({
		date: F.date,
		start_time: F.start_time.default(null),
		end_time: F.end_time.default(null),
		location: F.location.default(null),
		title: F.title.default(null),
		notes: F.notes.default(""),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventOccurrencesModel.Occurrence;
	export type Response = z.infer<typeof Response>;
}

export namespace EventOccurrencesModel.Update {
	export const Body = z
		.object(EventOccurrencesModel.OccurrenceFields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = EventOccurrencesModel.Occurrence;
	export type Response = z.infer<typeof Response>;
}

export namespace EventOccurrencesModel.SetDuty {
	export const Body = z.object({
		/** Event staff user ids; replaces who covers this responsibility on this date. */
		user_ids: z.array(z.number().int().positive()).max(50),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventOccurrencesModel.Occurrence;
	export type Response = z.infer<typeof Response>;
}

export namespace EventOccurrencesModel.SignUp {
	export const Body = z.object({
		/** true = "I'll do it", false = take the caller off this duty again. */
		assigned: z.boolean(),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = EventOccurrencesModel.Occurrence;
	export type Response = z.infer<typeof Response>;
}

export namespace EventOccurrencesModel.Plan {
	export const Body = z.object({
		/**
		 * `standard`: everyone who usually does a responsibility is put on every date.
		 * `rotate`: they take turns, one person per date.
		 */
		mode: z.enum(["standard", "rotate"]),
		/** Limit to these responsibilities (default: all that have people assigned). */
		responsibility_ids: z.array(z.number().int().positive()).max(200).optional(),
		/** Also replace duties that are already filled (default: only fill the gaps). */
		overwrite: z.boolean().default(false),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = z.object({
		/** Dates that got at least one new duty. */
		occurrences: z.number(),
		/** Duties (person on a responsibility on a date) that were set. */
		duties: z.number(),
	});
	export type Response = z.infer<typeof Response>;
}
