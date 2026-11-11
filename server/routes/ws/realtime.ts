import { defineWebSocketHandler } from "h3";
import { RealtimeGateway } from "../../lib/realtime/gateway";

// The realtime channel. Only this path is upgraded (server/runtime/bun.ts); everything it does is
// in RealtimeGateway.
export default defineWebSocketHandler(RealtimeGateway.hooks);
