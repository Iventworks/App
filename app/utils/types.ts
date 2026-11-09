/**
 * API-derived types shared across pages. Derive from the generated client
 * (`app/api-client/types.gen.ts`) instead of redeclaring shapes; add a page-local alias when a
 * type is only used in one page.
 */
import type {
	GetAccountApikeysResponses,
	GetAccountResponses,
	GetAdminOrganizationDomainsResponses,
	GetAdminOrganizationResponses,
	GetAdminUsersByUserIdResponses,
	GetAdminUsersResponses,
	GetEventsByEventIdFilesResponses,
	GetEventsByEventIdMembersResponses,
	GetEventsByEventIdTasksResponses,
	GetEventsResponses,
	GetNotificationsResponses,
	GetSystemOrgsResponses,
	GetUsersResponses,
	PostAccountApikeysData,
	PostAdminUsersByUserIdPasswordLinkResponses,
} from "~/api-client";

export namespace UtilityTypes {
	export type SomePartial<T, K extends keyof T> = Partial<Pick<T, K>> & Omit<T, K>;
}

export type UserInfo = GetAccountResponses["200"]["data"];

export type APIKey = GetAccountApikeysResponses["200"]["data"][number];

/** The org's own settings (`/admin/organization`): branding, domains in multi-org mode. */
export type OrgSettings = GetAdminOrganizationResponses["200"]["data"];
export type OrgInfo = OrgSettings["org"];
export type OrgPrimaryColor = OrgInfo["primary_color"];
/** A custom domain with its verification state and the DNS records to create. */
export type OrgDomain = GetAdminOrganizationDomainsResponses["200"]["data"][number];
/** An org as the system admins see it (`/system/orgs`). */
export type SystemOrg = GetSystemOrgsResponses["200"]["data"][number];
export type NewAPIKey = NonNullable<PostAccountApikeysData["body"]>;

/** A user as shown in lists, assignee pickers and chat (`UserSummary` on the server). */
export type UserSummary = GetUsersResponses["200"]["data"][number];

export type EventWithAccess = GetEventsResponses["200"]["data"][number];
export type EventPermission = EventWithAccess["permissions"][number];
export type EventMember = GetEventsByEventIdMembersResponses["200"]["data"][number];

export type EventTask = GetEventsByEventIdTasksResponses["200"]["data"][number];
export type TaskStatus = EventTask["status"];
export type TaskPriority = EventTask["priority"];

export type NotificationItem = GetNotificationsResponses["200"]["data"]["items"][number];

export type FolderListing = GetEventsByEventIdFilesResponses["200"]["data"];
export type FileItem = FolderListing["items"][number];

/** A full account as admins see it (`/admin/users`). */
export type AdminUser = GetAdminUsersResponses["200"]["data"][number];
export type AdminUserDetail = GetAdminUsersByUserIdResponses["200"]["data"];
/** A one-time "set your password" link, shown to the admin once. */
export type PasswordLink = PostAdminUsersByUserIdPasswordLinkResponses["201"]["data"];
