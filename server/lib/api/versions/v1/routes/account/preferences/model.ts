import type { z } from "zod";
import { UserPreferences } from "../../../../../utils/preferences";

export namespace AccountPreferencesModel.GetAll {
	export const Response = UserPreferences.allSchema;
	export type Response = z.infer<typeof Response>;
}

export namespace AccountPreferencesModel.Notifications {
	export const Response = UserPreferences.schemas["notifications"];
	export type Response = z.infer<typeof Response>;

	/** Only the fields to change. */
	export const Body = UserPreferences.schemas["notifications"].partial();
	export type Body = z.infer<typeof Body>;
}

export namespace AccountPreferencesModel.Onboarding {
	export const Response = UserPreferences.schemas["onboarding"];
	export type Response = z.infer<typeof Response>;

	export const Body = Response;
	export type Body = z.infer<typeof Body>;
}
