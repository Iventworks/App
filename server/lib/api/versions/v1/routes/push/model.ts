import { z } from "zod";
import { PushService } from "../../../../../push/service";

export namespace PushModel {
	export const Subscription = z.object({
		id: z.number(),
		/** The push service URL of that browser (to recognise "this device"). */
		endpoint: z.string(),
		label: z.string().nullable(),
		created_at: z.number(),
		/** Last push the push service accepted. */
		last_success_at: z.number().nullable(),
	});
	export type Subscription = z.infer<typeof Subscription>;
}

export namespace PushModel.Config {
	export const Response = z.object({
		/** The VAPID public key: `applicationServerKey` for `pushManager.subscribe()`. */
		public_key: z.string(),
	});
	export type Response = z.infer<typeof Response>;
}

export namespace PushModel.Subscriptions {
	export const Response = z.array(PushModel.Subscription);
	export type Response = z.infer<typeof Response>;
}

export namespace PushModel.Subscribe {
	export const Body = PushService.SubscriptionInputSchema.extend({
		/** How the device shows in the list; default: browser and system from the User-Agent. */
		label: z.string().trim().min(1).max(80).optional(),
	});
	export type Body = z.infer<typeof Body>;

	export const Response = PushModel.Subscription;
	export type Response = z.infer<typeof Response>;
}

export namespace PushModel.Unsubscribe {
	export const Body = z.object({ endpoint: z.string().max(2048) });
	export type Body = z.infer<typeof Body>;
}

export namespace PushModel.Params {
	export const Schema = z.object({ subscriptionId: z.coerce.number().int().positive() });
	export type Schema = z.infer<typeof Schema>;
}

export namespace PushModel.Test {
	export const Response = z.object({ devices: z.number() });
	export type Response = z.infer<typeof Response>;
}
