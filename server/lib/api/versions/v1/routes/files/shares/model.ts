import { z } from "zod";
import { FileShares } from "../../../../../utils/fileShares";

export namespace FileSharesModel {
	export const Params = z.object({
		fileId: z.coerce.number().int().positive(),
	});
	export type Params = z.infer<typeof Params>;

	export const ShareParams = Params.extend({
		shareId: z.coerce.number().int().positive(),
	});
	export type ShareParams = z.infer<typeof ShareParams>;

	const Password = z.string().min(4, "Mindestens 4 Zeichen").max(128);
	const ExpiresAt = z
		.number()
		.int()
		.refine((value) => value > Date.now(), { message: "Expiry must be in the future" })
		.nullable();

	export namespace Create {
		export const Body = z.object({
			permissions: FileShares.Permissions,
			label: z.string().trim().max(100).nullable().optional(),
			/** Unix ms; null = never; omitted = the org's default expiry. */
			expires_at: ExpiresAt.optional(),
			password: Password.nullable().optional(),
		});
		export type Body = z.infer<typeof Body>;
	}

	export namespace Update {
		export const Body = z
			.object({
				permissions: FileShares.Permissions,
				label: z.string().trim().max(100).nullable(),
				expires_at: ExpiresAt,
				/** A string sets a new password, null removes it. */
				password: Password.nullable(),
			})
			.partial()
			.refine((body) => Object.values(body).some((value) => value !== undefined), {
				message: "Nothing to change",
			});
		export type Body = z.infer<typeof Body>;
	}
}
