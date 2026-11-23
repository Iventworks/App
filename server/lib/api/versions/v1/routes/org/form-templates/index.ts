import type { Context } from "hono";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { FormService } from "../../../../../../forms/service";
import { APIResponse } from "../../../../../utils/api-res";
import { AuditLog } from "../../../../../utils/auditLog";
import { AuthHandler } from "../../../../../utils/authHandler";
import { getAuthUserId } from "../../../../../utils/guards";
import { PermissionHelper } from "../../../../../utils/permissions";
import { FormModel } from "../../../../../utils/shared-models/forms";
import { APIResponseSpec, APIRouteSpec } from "../../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../../docs";

/**
 * Form templates (`scope = template`): everyone who works in the portal can pick one for a new
 * form (an event's team too), only the Kernteam manages them — on `/forms/{formId}` like forms.
 */
export const router = new Hono().basePath("/form-templates");

const TAG = DOCS_TAGS.ORG.FORMS;
const FORBIDDEN = "Only the core team manages templates";

/** Everyone reads the templates (to start a form from one); the Kernteam manages them. */
function viewer(c: Context) {
	return {
		userId: getAuthUserId(c),
		manage: PermissionHelper.can({
			authContext: AuthHandler.AuthContext.get(c),
			permission: "org_forms:manage",
		}),
		contribute: false,
	};
}

router.get(
	"/",

	APIRouteSpec.authenticated({
		summary: "List form templates",
		description: "The templates a new form can start from.",
		tags: [TAG],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Templates retrieved successfully", FormModel.List.Response),
		),
	}),

	async (c) => {
		return APIResponse.success(
			c,
			"Templates retrieved successfully",
			await FormService.list({ scope: "template" }, viewer(c)),
		);
	},
);

router.post(
	"/",

	APIRouteSpec.authenticated({
		summary: "Create form template",
		description: "A new template, empty or as a copy of another one (`template_id`).",
		tags: [TAG],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.created("Template created successfully", FormModel.Details),
			APIResponseSpec.notFound("Template not found"),
			APIResponseSpec.forbidden(FORBIDDEN),
		),
	}),

	zValidator("json", FormModel.Create.Body),

	async (c) => {
		if (
			!PermissionHelper.can({
				authContext: AuthHandler.AuthContext.get(c),
				permission: "org_forms:manage",
			})
		) {
			return APIResponse.forbidden(c, FORBIDDEN);
		}
		const { title, template_id } = c.req.valid("json") as FormModel.Create.Body;
		const source = template_id === null ? null : await FormService.template(template_id);
		if (template_id !== null && !source) return APIResponse.notFound(c, "Template not found");

		const template = await FormService.create({
			scope: "template",
			eventId: null,
			title,
			from: source,
			userId: getAuthUserId(c),
		});

		await AuditLog.record({
			userId: getAuthUserId(c),
			action: "create",
			entityType: "form",
			entityId: template.id,
			summary: `${FormService.describe(template)} angelegt`,
		});

		return APIResponse.created(
			c,
			"Template created successfully",
			await FormService.details(template, viewer(c)),
		);
	},
);
