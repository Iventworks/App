import { z } from "zod";
import { FILE_ACCESS_PRINCIPALS } from "../../../db/schema";

/** Request and response shapes of access lists on org and event documents (`FileAccess`). */
export namespace FileAccessModel {
	/** What an entry grants — the same rights as a share link. */
	export const Rights = z.object({
		read: z.boolean(),
		upload: z.boolean(),
		edit: z.boolean(),
		delete: z.boolean(),
	});
	export type Rights = z.infer<typeof Rights>;

	/** What the caller may do with an item (see `FileAccess.Permissions`). */
	export const Permissions = Rights.extend({
		rename: z.boolean(),
		manage: z.boolean(),
	});
	export type Permissions = z.infer<typeof Permissions>;

	export const Principal = z.enum(FILE_ACCESS_PRINCIPALS);
	export type Principal = z.infer<typeof Principal>;

	/** One entry of an access list, with a label to show. */
	export const Entry = z.object({
		principal: Principal,
		/** The group's or person's id; null for `members` and `team`. */
		id: z.number().nullable(),
		label: z.string(),
		/** Group colour. */
		color: z.string().nullable(),
		permissions: Rights,
	});
	export type Entry = z.infer<typeof Entry>;

	/** Who has access to an item, and where that comes from. */
	export const View = z.object({
		/** The item has its own access list. */
		custom: z.boolean(),
		/**
		 * The folder whose list applies when the item inherits; null when it is the library's
		 * default (or the item's own list).
		 */
		inherited_from: z.object({ id: z.number(), name: z.string() }).nullable(),
		/**
		 * The list that applies — own, inherited or the library's default (org documents: empty,
		 * only the Kernteam; event documents: the whole team may view and upload). Managers
		 * (Kernteam / Leitung) always have full access and are never listed.
		 */
		entries: z.array(Entry),
		/**
		 * What applies when the item inherits: the list of the nearest folder above with its own
		 * (`from`), or the library's default (`from` null). The same as `inherited_from` and
		 * `entries` while it inherits.
		 */
		inherits: z.object({
			from: z.object({ id: z.number(), name: z.string() }).nullable(),
			entries: z.array(Entry),
		}),
	});
	export type View = z.infer<typeof View>;

	export const EntryInput = z.object({
		principal: Principal,
		/** Group or user id; leave out for `members` and `team`. */
		id: z.number().int().positive().nullable().optional(),
		permissions: Rights,
	});
	export type EntryInput = z.infer<typeof EntryInput>;

	export const UpdateBody = z.object({
		/** false: inherit from the parent folder again (the entries are removed). */
		custom: z.boolean(),
		entries: z.array(EntryInput).max(200).default([]),
	});
	export type UpdateBody = z.infer<typeof UpdateBody>;

	/** Someone who can be added to an access list. */
	export const Candidate = z.object({
		principal: Principal,
		id: z.number().nullable(),
		label: z.string(),
		description: z.string().nullable(),
		color: z.string().nullable(),
	});
	export type Candidate = z.infer<typeof Candidate>;
}
