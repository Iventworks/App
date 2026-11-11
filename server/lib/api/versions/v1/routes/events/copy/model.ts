import { z } from "zod";
import { EventCopier } from "../../../../../utils/eventCopy";
import { EventsModel } from "../model";

export namespace EventCopyModel {
	const isoDate = z.iso.date("Expected a date in the format YYYY-MM-DD");

	export const Body = z.object({
		name: EventsModel.EventFields.name,
		/** First day of the copy. Program items and due dates move by the same number of days. */
		start_date: isoDate,
		/** Last day; default: as long as the original. */
		end_date: isoDate.optional(),
		/** What to take along besides the master data. */
		include: EventCopier.PartsSchema.default(EventCopier.PartsSchema.parse({})),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = z.object({
		event: EventsModel.EventWithAccess,
		/** Resources that could not be booked again: not enough units free on the new days. */
		skipped_bookings: z.array(z.string()),
		/** Files that could not be copied because their contents are missing. */
		skipped_files: z.number(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace EventCopyModel.Summary {
	export const Response = EventCopier.SummarySchema;
	export type Response = z.infer<typeof Response>;
}
