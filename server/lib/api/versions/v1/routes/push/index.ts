import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import type { DB } from "../../../../../db";
import { WebPushKeys } from "../../../../../push/keys";
import { PushService } from "../../../../../push/service";
import { APIResponse } from "../../../../utils/api-res";
import { AuthHandler } from "../../../../utils/authHandler";
import { requireOrgRole } from "../../../../utils/guards";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { PushModel } from "./model";

/** Web Push: this browser's subscription, the person's devices, a test push. */
export const router = new Hono().basePath("/push");

router.use("*", requireOrgRole("volunteer"));

const SESSION_ONLY = "Push notifications need a login session (not an API key)";

function session(c: Context) {
	const authContext = AuthHandler.AuthContext.get(c);
	return authContext.type === "session" ? authContext : null;
}

function toItem(subscription: DB.Models.PushSubscription): PushModel.Subscription {
	return {
		id: subscription.id,
		endpoint: subscription.endpoint,
		label: subscription.label,
		created_at: subscription.created_at,
		last_success_at: subscription.last_success_at,
	};
}

/** "Chrome · Android" from a User-Agent: enough to tell one's devices apart. */
export function deviceLabel(userAgent: string | undefined) {
	const ua = userAgent ?? "";
	const browser = /Edg\//.test(ua)
		? "Edge"
		: /OPR\/|Opera/.test(ua)
			? "Opera"
			: /SamsungBrowser/.test(ua)
				? "Samsung Internet"
				: /Firefox\//.test(ua)
					? "Firefox"
					: /Chrome\//.test(ua)
						? "Chrome"
						: /Safari\//.test(ua)
							? "Safari"
							: null;
	const system = /iPhone|iPad|iPod/.test(ua)
		? "iOS"
		: /Android/.test(ua)
			? "Android"
			: /Windows/.test(ua)
				? "Windows"
				: /Mac OS X|Macintosh/.test(ua)
					? "macOS"
					: /Linux/.test(ua)
						? "Linux"
						: null;
	const label = [browser, system].filter(Boolean).join(" · ");
	return label || null;
}

router.get(
	"/config",

	APIRouteSpec.authenticated({
		summary: "Get push configuration",
		description:
			"The server's VAPID public key, for `pushManager.subscribe({ applicationServerKey })`.",
		tags: [DOCS_TAGS.PERSONAL.NOTIFICATIONS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Push configuration retrieved successfully", PushModel.Config.Response),
		),
	}),

	async (c) => {
		const keys = await WebPushKeys.get();
		return APIResponse.success(c, "Push configuration retrieved successfully", {
			public_key: keys.publicKey,
		});
	},
);

router.get(
	"/subscriptions",

	APIRouteSpec.authenticated({
		summary: "List push devices",
		description: "The caller's browsers and devices that receive push notifications.",
		tags: [DOCS_TAGS.PERSONAL.NOTIFICATIONS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Push devices retrieved successfully", PushModel.Subscriptions.Response),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;
		return APIResponse.success(
			c,
			"Push devices retrieved successfully",
			PushService.list(authContext.user_id).map(toItem),
		);
	},
);

router.post(
	"/subscriptions",

	APIRouteSpec.authenticated({
		summary: "Register push device",
		description:
			"Store this browser's push subscription (from `pushManager.subscribe()`). Only subscriptions of known push services are accepted (Google, Mozilla, Apple, Microsoft and `IVENTWORKS_WEB_PUSH_EXTRA_HOSTS`). The subscription belongs to the current login: logging out ends it. Registering the same browser again updates it.",
		tags: [DOCS_TAGS.PERSONAL.NOTIFICATIONS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Push device registered successfully", PushModel.Subscribe.Response),
			APIResponseSpec.badRequest(
				"Unsupported push service / Invalid subscription keys / Syntax or validation error in request",
			),
			APIResponseSpec.forbidden(SESSION_ONLY),
		),
	}),

	zValidator("json", PushModel.Subscribe.Body),

	async (c) => {
		const current = session(c);
		if (!current) return APIResponse.forbidden(c, SESSION_ONLY);

		const body = c.req.valid("json") as PushModel.Subscribe.Body;
		if (!PushService.isAllowedEndpoint(body.endpoint)) {
			return APIResponse.badRequest(c, "Unsupported push service");
		}
		if (!PushService.hasValidKeys(body.keys)) {
			return APIResponse.badRequest(c, "Invalid subscription keys");
		}

		const subscription = PushService.subscribe(
			{ userId: current.user_id, sessionId: current.id },
			body,
			body.label ?? deviceLabel(c.req.header("user-agent")),
		);
		return APIResponse.success(c, "Push device registered successfully", toItem(subscription));
	},
);

router.post(
	"/subscriptions/unsubscribe",

	APIRouteSpec.authenticated({
		summary: "Unregister this browser",
		description:
			"Remove the caller's subscription with this endpoint (the browser turned push off). Unknown endpoints are ignored.",
		tags: [DOCS_TAGS.PERSONAL.NOTIFICATIONS],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Push device removed successfully"),
		),
	}),

	zValidator("json", PushModel.Unsubscribe.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;
		const { endpoint } = c.req.valid("json") as PushModel.Unsubscribe.Body;
		PushService.remove(authContext.user_id, { endpoint });
		return APIResponse.successNoData(c, "Push device removed successfully");
	},
);

router.delete(
	"/subscriptions/:subscriptionId",

	APIRouteSpec.authenticated({
		summary: "Remove push device",
		description: "Stop push notifications to one of the caller's devices.",
		tags: [DOCS_TAGS.PERSONAL.NOTIFICATIONS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Push device removed successfully"),
			APIResponseSpec.notFound("Push device not found"),
		),
	}),

	zValidator("param", PushModel.Params.Schema),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;
		const { subscriptionId } = c.req.valid("param") as PushModel.Params.Schema;
		if (!PushService.remove(authContext.user_id, { id: subscriptionId })) {
			return APIResponse.notFound(c, "Push device not found");
		}
		return APIResponse.successNoData(c, "Push device removed successfully");
	},
);

router.post(
	"/test",

	APIRouteSpec.authenticated({
		summary: "Send test push",
		description: "Send a test notification to all of the caller's devices.",
		tags: [DOCS_TAGS.PERSONAL.NOTIFICATIONS],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Test push sent successfully", PushModel.Test.Response),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;
		const devices = PushService.list(authContext.user_id).length;
		PushService.send([authContext.user_id], {
			kind: "test",
			title: "Test-Benachrichtigung",
			body: "Push-Benachrichtigungen funktionieren auf diesem Gerät.",
			url: "/settings/notifications",
			tag: "push-test",
		});
		return APIResponse.success(c, "Test push sent successfully", { devices });
	},
);
