import { z } from "zod";

export namespace RealtimeModel.Ticket {
	export const Response = z.object({
		/** Pass as `?ticket=` when opening the socket. Works once, for a few seconds. */
		ticket: z.string(),
		/** Path of the WebSocket on the same host (`wss://<host><path>?ticket=…`). */
		path: z.string(),
		expires_at: z.number(),
	});
	export type Response = z.infer<typeof Response>;
}
