import type { DB } from "../../db";
import type { AuthHandler } from "./authHandler";
import type { UserAccountSettings } from "./shared-models/accountData";

/**
 * Role-based access control (docs/10 › full RBAC). Two layers:
 *
 * - **Organisation roles** (`users.role`, cached on the session/API key):
 *   `unverified < volunteer < core_team < admin`. `ORG_PERMISSIONS` maps every org-level action
 *   to the minimum role.
 * - **Event roles** (`event_members.role`): `staff < leader`. `EVENT_PERMISSIONS` maps every
 *   event-level action to the minimum event role. `core_team` and `admin` act as `leader` in
 *   every event, so the Kernteam can run any camp without being added to it.
 *
 * Handlers call `PermissionHelper.can(...)` / `canInEvent(...)` and turn `false` into
 * `APIResponse.forbidden`. Coarse router guards (`requireOrgRole`) only reject unauthenticated
 * or unverified callers early.
 */
export class PermissionHelper {
	static readonly ORG_ROLE_RANK: Record<UserAccountSettings.Role, number> = {
		unverified: 0,
		volunteer: 1,
		core_team: 2,
		admin: 3,
	};

	static readonly EVENT_ROLE_RANK: Record<PermissionHelper.EventRole, number> = {
		staff: 1,
		leader: 2,
	};

	static readonly ORG_PERMISSIONS = {
		/** Use the portal at all (dashboard, chats, calendar, events you belong to). */
		"portal:use": "volunteer",
		"users:directory": "volunteer",
		"org_documents:read": "volunteer",
		"org_announcements:read": "volunteer",
		"org_resources:read": "volunteer",

		"events:create": "core_team",
		"events:view_all": "core_team",
		"events:delete": "core_team",
		"org_documents:write": "core_team",
		"org_announcements:write": "core_team",
		"org_resources:write": "core_team",
		"org_finances:read": "core_team",
		"org_stats:read": "core_team",
		"core_team:space": "core_team",

		"admin:users": "admin",
		"admin:invitations": "admin",
		"admin:audit_log": "admin",
	} as const satisfies Record<string, UserAccountSettings.Role>;

	static readonly EVENT_PERMISSIONS = {
		"event:view": "staff",
		"event:edit": "leader",

		"members:view": "staff",
		"members:manage": "leader",
		"members:view_leader_notes": "leader",

		"groups:view": "staff",
		"groups:manage": "leader",

		"participants:view": "staff",
		/** Health data and staff notes — additionally needs real staff membership, see below. */
		"participants:view_medical": "staff",
		"participants:manage": "leader",
		"participants:add_note": "staff",

		"rooms:view": "staff",
		"rooms:manage": "leader",

		"program:view": "staff",
		"program:manage": "leader",

		"responsibilities:view": "staff",
		"responsibilities:manage": "leader",

		"tasks:view": "staff",
		"tasks:create": "staff",
		"tasks:manage_all": "leader",

		"notes:view": "staff",
		"notes:create": "staff",
		"notes:manage_all": "leader",

		"announcements:view": "staff",
		"announcements:manage": "leader",

		"files:view": "staff",
		"files:upload": "staff",
		"files:manage_all": "leader",

		"expenses:submit": "staff",
		"expenses:view_all": "leader",
		"expenses:review": "leader",
		"budget:view": "leader",
		"budget:manage": "leader",

		"stats:view": "leader",
		"audit_log:view": "leader",
	} as const satisfies Record<string, PermissionHelper.EventRole>;

	/**
	 * Event permissions that need actual staff membership of the event. The implicit `leader` role
	 * core team and admins get in every event is not enough: participants' health data and the
	 * staff's notes about them are special-category data (GDPR Art. 9), so only the people on the
	 * event's team see them (data minimisation). Core team can add themselves to the team.
	 */
	static readonly MEMBER_ONLY_EVENT_PERMISSIONS: ReadonlySet<PermissionHelper.EventPermission> =
		new Set(["participants:view_medical"]);

	static hasOrgRole(role: UserAccountSettings.Role, minimum: UserAccountSettings.Role) {
		return PermissionHelper.ORG_ROLE_RANK[role] >= PermissionHelper.ORG_ROLE_RANK[minimum];
	}

	/** Org-level check. Unauthenticated callers never pass. */
	static can({
		authContext,
		permission,
	}: {
		authContext: AuthHandler.AuthContext;
		permission: PermissionHelper.OrgPermission;
	}): boolean {
		if (authContext.type === "unauthenticated") return false;
		return PermissionHelper.hasOrgRole(
			authContext.user_role,
			PermissionHelper.ORG_PERMISSIONS[permission],
		);
	}

	/**
	 * The role a user effectively has inside an event: their membership role, or `leader` for
	 * core team / admins. `null` = no access.
	 */
	static getEffectiveEventRole(
		orgRole: UserAccountSettings.Role,
		membership: Pick<DB.Models.EventMember, "role"> | null | undefined,
	): PermissionHelper.EventRole | null {
		if (PermissionHelper.hasOrgRole(orgRole, "core_team")) return "leader";
		if (!PermissionHelper.hasOrgRole(orgRole, "volunteer")) return null;
		return membership?.role ?? null;
	}

	/** Event-level check against the access resolved by the event loader. */
	static canInEvent({
		access,
		permission,
	}: {
		/** `membership`: the caller's own staff row, or null (only its presence matters). */
		access: { role: PermissionHelper.EventRole | null; membership: object | null };
		permission: PermissionHelper.EventPermission;
	}): boolean {
		if (!access.role) return false;
		if (PermissionHelper.MEMBER_ONLY_EVENT_PERMISSIONS.has(permission) && !access.membership) {
			return false;
		}
		return (
			PermissionHelper.EVENT_ROLE_RANK[access.role] >=
			PermissionHelper.EVENT_ROLE_RANK[PermissionHelper.EVENT_PERMISSIONS[permission]]
		);
	}

	/** All event permissions a role has — sent to the frontend so it can hide controls. */
	static listEventPermissions(role: PermissionHelper.EventRole | null, membership: object | null) {
		return (
			Object.keys(PermissionHelper.EVENT_PERMISSIONS) as PermissionHelper.EventPermission[]
		).filter((permission) => PermissionHelper.canInEvent({ access: { role, membership }, permission }));
	}
}

export namespace PermissionHelper {
	export type EventRole = DB.Models.EventMember["role"];
	export type OrgPermission = keyof typeof PermissionHelper.ORG_PERMISSIONS;
	export type EventPermission = keyof typeof PermissionHelper.EVENT_PERMISSIONS;

	export interface EventAccess {
		readonly userId: number;
		readonly orgRole: UserAccountSettings.Role;
		/** Effective role in the event (`leader` for core team/admins); null = no access. */
		readonly role: EventRole | null;
		/** The caller's own membership row, if they are staff of this event. */
		readonly membership: DB.Models.EventMember | null;
	}
}
