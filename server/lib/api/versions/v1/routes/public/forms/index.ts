import { and, eq, ne } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../../db";
import { FormAnswers } from "../../../../../../forms/fields";
import { FormService } from "../../../../../../forms/service";
import { inOrg, OrgContext } from "../../../../../../orgs/context";
import { APIResponse } from "../../../../../utils/api-res";
import { getClientIP } from "../../../../../utils/clientInfo";
import { FormModel } from "../../../../../utils/shared-models/forms";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";

type PublicFormsEnv = {
	Variables: { form: DB.Models.Form };
};

/**
 * Filling in a form, for anyone with its link (page `/s/form/<token>`, no account):
 * `/public/forms/{token}`. The token is the only key. Drafts and templates have none; unknown links answer 404. A closed form (or one
 * past its closing time) still opens, without its questions, and takes no answers (409).
 */
export const router = new Hono<PublicFormsEnv>().basePath("/forms");

const TAG = DOCS_TAGS.PUBLIC.FORMS;
const NOT_FOUND = "Form not found";
const DEFAULT_CONFIRMATION = "Danke! Deine Antwort wurde gespeichert.";

// Answers per form and client address: generous, because a whole room scanning the QR code on a
// slide sends through one Wi-Fi address.
const SEND_WINDOW_MS = 10 * 60 * 1000;
const SEND_MAX = 300;
const sent = new Map<string, { count: number; resetAt: number }>();
setInterval(() => {
	const now = Date.now();
	for (const [key, entry] of sent) if (entry.resetAt <= now) sent.delete(key);
}, SEND_WINDOW_MS).unref();

/** Counts one answer from this client; false once it sent too many. */
function allowSend(c: Context<PublicFormsEnv>) {
	const key = `${OrgContext.id()}:${c.get("form").id}:${getClientIP(c)}`;
	const now = Date.now();
	let entry = sent.get(key);
	if (!entry || entry.resetAt <= now) {
		entry = { count: 0, resetAt: now + SEND_WINDOW_MS };
		sent.set(key, entry);
	}
	entry.count++;
	return entry.count <= SEND_MAX;
}

// `/:token/*` matches `/:token` itself too.
router.use("/:token/*", async (c, next) => {
	const token = c.req.param("token") ?? "";
	const T = DB.Tables;
	const form = await DB.instance()
		.select()
		.from(T.forms)
		.where(and(inOrg(T.forms), eq(T.forms.token, token), ne(T.forms.scope, "template")))
		.get();
	if (!form || form.status === "draft") return APIResponse.notFound(c, NOT_FOUND);
	c.set("form", form);
	await next();
});

router.get(
	"/:token",

	APIRouteSpec.unauthenticated({
		summary: "Open form",
		description:
			"The form to fill in: title, description (Markdown) and questions. While it takes no answers (`accepting: false`), without its questions.",
		tags: [TAG],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Form retrieved successfully", FormModel.Public.Form),
			APIResponseSpec.notFound(NOT_FOUND),
		),
	}),

	zValidator("param", FormModel.Public.Params),

	async (c) => {
		const form = c.get("form");
		const accepting = FormService.accepting(form);
		return APIResponse.success(c, "Form retrieved successfully", {
			title: form.title,
			description: form.description,
			fields: accepting ? form.fields : [],
			accepting,
		} satisfies FormModel.Public.Form);
	},
);

router.post(
	"/:token/responses",

	APIRouteSpec.unauthenticated({
		summary: "Send answers",
		description: `Send the answers (by question id). Only shown questions count, required ones must be answered (\`FormAnswers.check\`). ${SEND_MAX} answers per form and client address in ${SEND_WINDOW_MS / 60_000} minutes.`,
		tags: [TAG],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.created("Answers saved", FormModel.Public.Submitted),
			APIResponseSpec.badRequest(
				"Some answers are missing or invalid / Syntax or validation error in request",
			),
			APIResponseSpec.notFound(NOT_FOUND),
			APIResponseSpec.conflict("This form doesn't take answers anymore"),
			APIResponseSpec.tooManyRequests("Too many answers from this address, try again later"),
		),
	}),

	zValidator("param", FormModel.Public.Params),
	zValidator("json", FormModel.Public.Submit),

	async (c) => {
		const form = c.get("form");
		const confirmation = {
			confirmation_message: form.confirmation_message || DEFAULT_CONFIRMATION,
		} satisfies FormModel.Public.Submitted;
		if (!FormService.accepting(form)) {
			return APIResponse.conflict(c, "This form doesn't take answers anymore");
		}
		if (!allowSend(c)) {
			return APIResponse.tooManyRequests(c, "Too many answers from this address, try again later");
		}

		const body = c.req.valid("json") as FormModel.Public.Submit;
		// The honeypot: people never see the field, so whatever fills it in gets a thank-you and
		// nothing is stored.
		if (body.website) return APIResponse.created(c, "Answers saved", confirmation);

		const { answers, problems } = FormAnswers.check(form.fields, body.answers);
		const wrong = Object.entries(problems);
		if (wrong.length) {
			return APIResponse.badRequest(
				c,
				`Some answers are missing or invalid: ${wrong.map(([id, problem]) => `${id} (${problem})`).join(", ")}`,
			);
		}

		if (!FormService.submit(form, answers)) {
			return APIResponse.conflict(c, "This form doesn't take answers anymore");
		}
		return APIResponse.created(c, "Answers saved", confirmation);
	},
);
