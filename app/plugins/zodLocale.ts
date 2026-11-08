/**
 * German default messages for every Zod schema in the frontend — including the generated
 * `~/api-client/zod.gen` schemas that the forms validate with. Messages written in a schema itself
 * still win. An empty required text field reads "Bitte ausfüllen" instead of the generic
 * "Zu klein: erwartet, dass string >=1 Zeichen hat".
 */
import * as z from "zod";

export default defineNuxtPlugin(() => {
	z.config({
		...z.locales.de(),
		customError: (issue) => {
			if (issue.code === "too_small" && issue.origin === "string" && Number(issue.minimum) === 1) {
				return "Bitte ausfüllen";
			}
			return undefined;
		},
	});
});
