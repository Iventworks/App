import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { DB } from "../../../../../db";

export namespace CalendarModel {
	export const Entry = createSelectSchema(DB.Tables.calendarEntries).omit({ org_id: true });
	export type Entry = z.infer<typeof Entry>;

	export const Params = z.object({
		entryId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const EntryFields = {
		title: z.string().trim().min(1).max(200),
		description: z.string().max(10_000),
		location: z.string().trim().max(200).nullable(),
		start_at: z.number().int(),
		end_at: z.number().int(),
		all_day: z.boolean(),
		color: z
			.string()
			.regex(/^#[0-9a-fA-F]{6}$/, "Expected a hex color like #f97316")
			.nullable(),
	};

	/** Maximum span of one feed request. */
	export const MAX_FEED_SPAN_MS = 120 * 24 * 60 * 60 * 1000;
}

export namespace CalendarModel.GetEntries {
	export const Query = z.object({
		from: z.coerce.number().int().optional(),
		to: z.coerce.number().int().optional(),
	});
	export type Query = z.infer<typeof Query>;

	export const Response = z.array(CalendarModel.Entry);
	export type Response = z.infer<typeof Response>;
}

export namespace CalendarModel.CreateEntry {
	const F = CalendarModel.EntryFields;

	export const Body = z
		.object({
			title: F.title,
			description: F.description.default(""),
			location: F.location.default(null),
			start_at: F.start_at,
			end_at: F.end_at,
			all_day: F.all_day.default(false),
			color: F.color.default(null),
		})
		.refine((data) => data.end_at >= data.start_at, {
			message: "end_at must not be before start_at",
			path: ["end_at"],
		});
	export type Body = z.infer<typeof Body>;

	export const Response = CalendarModel.Entry;
	export type Response = z.infer<typeof Response>;
}

export namespace CalendarModel.UpdateEntry {
	export const Body = z
		.object(CalendarModel.EntryFields)
		.partial()
		.refine((data) => Object.values(data).some((value) => value !== undefined), {
			message: "At least one field must be provided",
		});
	export type Body = z.infer<typeof Body>;

	export const Response = CalendarModel.Entry;
	export type Response = z.infer<typeof Response>;
}

export namespace CalendarModel.Feed {
	export const Query = z.object({
		/** Range start (unix ms, inclusive). */
		from: z.coerce.number().int(),
		/** Range end (unix ms, exclusive). At most 120 days after `from`. */
		to: z.coerce.number().int(),
	});
	export type Query = z.infer<typeof Query>;

	export const Item = z.object({
		/** Unique across sources, e.g. `entry-5`, `program-12`, `event-3`, `task-9`. */
		id: z.string(),
		source: z.enum(["entry", "program", "event", "task"]),
		/** Numeric id of the underlying row. */
		source_id: z.number(),
		title: z.string(),
		start_at: z.number(),
		end_at: z.number(),
		all_day: z.boolean(),
		color: z.string().nullable(),
		location: z.string().nullable(),
		/** In-app path to open the item. */
		link: z.string().nullable(),
		event: z.object({ id: z.number(), name: z.string() }).nullable(),
		/** Own entry/task, own event, or a program item the caller is responsible for. */
		is_mine: z.boolean(),
	});
	export type Item = z.infer<typeof Item>;

	export const Response = z.array(Item);
	export type Response = z.infer<typeof Response>;
}
