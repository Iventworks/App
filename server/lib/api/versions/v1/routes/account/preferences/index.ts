import { Hono } from "hono";
import { validator } from "hono-openapi";
import { Realtime } from "../../../../../../realtime";
import { APIResponse } from "../../../../../utils/api-res";
import { AuthHandler } from "../../../../../utils/authHandler";
import { UserPreferencesHandler } from "../../../../../utils/preferences";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";
import { AccountPreferencesModel } from "./model";

export const router = new Hono().basePath("/preferences");

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "Get all preferences",
		description:
			"Retrieve all of the authenticated user's preferences in a single request, keyed by the same names as the per-preference routes. Preferences that were never set are returned with their defaults.",
		tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Preferences retrieved successfully",
				AccountPreferencesModel.GetAll.Response,
			),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.getAsSession(c);

		const preferences = await UserPreferencesHandler.getAll(authContext.user_id);

		return APIResponse.success(c, "Preferences retrieved successfully", preferences);
	},
);

router.get(
	"/onboarding",

	APIRouteSpec.authenticated({
		summary: "Get onboarding state",
		description:
			"Retrieve whether the authenticated user has completed the one-time, platform-wide welcome onboarding.",
		tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Onboarding state retrieved successfully",
				AccountPreferencesModel.Onboarding.Response,
			),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.getAsSession(c);

		const preference = await UserPreferencesHandler.getOnboarding(authContext.user_id);

		return APIResponse.success(c, "Onboarding state retrieved successfully", preference);
	},
);

router.put(
	"/onboarding",

	APIRouteSpec.authenticated({
		summary: "Update onboarding state",
		description:
			"Set whether the authenticated user has completed the one-time, platform-wide welcome onboarding.",
		tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.successNoData("Onboarding state updated successfully"),
		),
	}),

	validator("json", AccountPreferencesModel.Onboarding.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.getAsSession(c);

		const body = c.req.valid("json");

		await UserPreferencesHandler.setOnboarding(authContext.user_id, body);

		return APIResponse.successNoData(c, "Onboarding state updated successfully");
	},
);

router.get(
	"/notifications",

	APIRouteSpec.authenticated({
		summary: "Get notification settings",
		description:
			"Which push notifications the caller gets (chat messages, other notifications, with or without the message text) and whether others see them online.",
		tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success(
				"Notification settings retrieved successfully",
				AccountPreferencesModel.Notifications.Response,
			),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;
		const preference = await UserPreferencesHandler.get(authContext.user_id, "notifications");
		return APIResponse.success(c, "Notification settings retrieved successfully", preference);
	},
);

router.put(
	"/notifications",

	APIRouteSpec.authenticated({
		summary: "Update notification settings",
		description:
			"Change some of the notification settings. Switching `share_presence` off hides the caller's online status and last-seen time from everyone right away.",
		tags: [DOCS_TAGS.ACCOUNT_PREFERENCES],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success(
				"Notification settings updated successfully",
				AccountPreferencesModel.Notifications.Response,
			),
		),
	}),

	validator("json", AccountPreferencesModel.Notifications.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.AuthenticatedAuthContext;
		const body = c.req.valid("json") as AccountPreferencesModel.Notifications.Body;

		const current = await UserPreferencesHandler.get(authContext.user_id, "notifications");
		const next = { ...current, ...body };
		await UserPreferencesHandler.set(authContext.user_id, "notifications", next);
		if (next.share_presence !== current.share_presence) {
			Realtime.presenceSharingChanged(authContext.user_id, next.share_presence);
		}

		return APIResponse.success(c, "Notification settings updated successfully", next);
	},
);
