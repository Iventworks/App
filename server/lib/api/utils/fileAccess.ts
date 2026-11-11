import { and, eq } from "drizzle-orm";
import { DB } from "../../db";
import { inOrg } from "../../orgs/context";
import type { AuthHandler } from "./authHandler";
import { ConversationAccess } from "./conversations";
import { EventAccess } from "./eventAccess";
import { PermissionHelper } from "./permissions";

/**
 * Who may read or change a row of the `files` table, depending on its scope:
 * - `org`: read = everyone in the portal, write = `org_documents:write` (core team)
 * - `event`: read = event access with `files:view`; write = uploader (with `files:upload`) or
 *   `files:manage_all` (leaders)
 * - `receipt`: read/write = the expense's submitter or `expenses:review` in that event
 * - `message` (chat attachments): read = everyone in the chat; before it is sent only the
 *   uploader. Never written through the file routes — attachments go with their message.
 */
export class FileAccess {
	static async canRead(
		authContext: AuthHandler.AuthContext,
		file: DB.Models.File,
	): Promise<boolean> {
		if (authContext.type === "unauthenticated") return false;

		switch (file.scope) {
			case "org":
				return PermissionHelper.can({ authContext, permission: "org_documents:read" });
			case "event": {
				if (file.event_id === null) return false;
				const access = await EventAccess.resolve(authContext, file.event_id);
				return PermissionHelper.canInEvent({ access, permission: "files:view" });
			}
			case "receipt":
				return await FileAccess.canAccessReceipt(authContext, file);
			case "message":
				return await FileAccess.canReadAttachment(authContext, file);
			default:
				return false;
		}
	}

	protected static async canReadAttachment(
		authContext: AuthHandler.AuthenticatedAuthContext,
		file: DB.Models.File,
	) {
		if (file.conversation_id === null) return false;
		if (file.message_id === null) return file.uploaded_by === authContext.user_id;

		const conversation = await DB.instance()
			.select()
			.from(DB.Tables.conversations)
			.where(and(inOrg(DB.Tables.conversations), eq(DB.Tables.conversations.id, file.conversation_id)))
			.get();
		return Boolean(
			conversation &&
				ConversationAccess.canAccess(conversation, authContext.user_id, authContext.user_role),
		);
	}

	static async canWrite(
		authContext: AuthHandler.AuthContext,
		file: DB.Models.File,
	): Promise<boolean> {
		if (authContext.type === "unauthenticated") return false;

		switch (file.scope) {
			case "org":
				return PermissionHelper.can({ authContext, permission: "org_documents:write" });
			case "event": {
				if (file.event_id === null) return false;
				const access = await EventAccess.resolve(authContext, file.event_id);
				if (PermissionHelper.canInEvent({ access, permission: "files:manage_all" })) {
					return true;
				}
				return (
					file.uploaded_by === authContext.user_id &&
					PermissionHelper.canInEvent({ access, permission: "files:upload" })
				);
			}
			case "receipt":
				return await FileAccess.canAccessReceipt(authContext, file);
			default:
				return false;
		}
	}

	/**
	 * Create and manage share links for `file`: only people who manage the whole library may, so a
	 * link (which can carry edit/delete rights for everything inside a folder) never grants more
	 * than its creator has. Receipts are never shared.
	 */
	static async canShare(
		authContext: AuthHandler.AuthContext,
		file: DB.Models.File,
	): Promise<boolean> {
		if (authContext.type === "unauthenticated") return false;

		switch (file.scope) {
			case "org":
				return PermissionHelper.can({ authContext, permission: "org_documents:write" });
			case "event": {
				if (file.event_id === null) return false;
				const access = await EventAccess.resolve(authContext, file.event_id);
				return PermissionHelper.canInEvent({ access, permission: "files:manage_all" });
			}
			default:
				return false;
		}
	}

	protected static async canAccessReceipt(
		authContext: AuthHandler.AuthenticatedAuthContext,
		file: DB.Models.File,
	) {
		if (!PermissionHelper.hasOrgRole(authContext.user_role, "volunteer")) return false;

		const expense = await DB.instance()
			.select()
			.from(DB.Tables.expenses)
			.where(and(inOrg(DB.Tables.expenses), eq(DB.Tables.expenses.receipt_file_id, file.id)))
			.get();

		const eventId = expense?.event_id ?? file.event_id;
		if (expense && expense.submitted_by === authContext.user_id) return true;
		if (eventId === null) return false;

		const access = await EventAccess.resolve(authContext, eventId);
		return PermissionHelper.canInEvent({ access, permission: "expenses:review" });
	}
}
