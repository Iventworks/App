/**
 * API-derived types shared across pages. Derive from the generated client
 * (`app/api-client/types.gen.ts`) instead of redeclaring shapes; add a page-local alias when a
 * type is only used in one page.
 */
import type {
	GetAccountApikeysResponses,
	GetAccountResponses,
	GetAdminGroupsResponses,
	GetAdminOrganizationDomainsResponses,
	GetAdminOrganizationResponses,
	GetAdminSharesResponses,
	GetAdminUsersByUserIdResponses,
	GetAdminUsersResponses,
	GetConversationsByConversationIdMembersResponses,
	GetConversationsByConversationIdMessagesResponses,
	GetConversationsResponses,
	GetConversationsSearchResponses,
	GetEventsByEventIdFilesResponses,
	GetEventsByEventIdMaterialsCatalogResponses,
	GetEventsByEventIdMaterialsResponses,
	GetEventsByEventIdMembersResponses,
	GetEventsByEventIdOccurrencesResponses,
	GetEventsByEventIdTasksResponses,
	GetEventsResponses,
	GetFilesByFileIdAccessCandidatesResponses,
	GetFilesByFileIdAccessResponses,
	GetFilesByFileIdSharesResponses,
	GetFilesByFileIdVersionsResponses,
	GetNotificationsResponses,
	GetOrgDocumentsTrashResponses,
	GetPublicDocsByTokenItemsResponses,
	GetPublicDocsByTokenResponses,
	GetSystemDomainsResponses,
	GetSystemOrgsResponses,
	GetUsersResponses,
	PostAccountApikeysData,
	PostAdminUsersByUserIdPasswordLinkResponses,
	PostOrgDocumentsOfficeData,
} from "~/api-client";

export namespace UtilityTypes {
	export type SomePartial<T, K extends keyof T> = Partial<Pick<T, K>> & Omit<T, K>;
}

export type UserInfo = GetAccountResponses["200"]["data"];

export type ChatConversation = GetConversationsResponses["200"]["data"][number];
export type ChatMessage = GetConversationsByConversationIdMessagesResponses["200"]["data"][number];
export type ChatAttachment = ChatMessage["attachments"][number];
export type ChatMember = GetConversationsByConversationIdMembersResponses["200"]["data"][number];
export type ChatSearchHit = GetConversationsSearchResponses["200"]["data"][number];

export type APIKey = GetAccountApikeysResponses["200"]["data"][number];

/** The org's own settings (`/admin/organization`): branding, domains in multi-org mode. */
export type OrgSettings = GetAdminOrganizationResponses["200"]["data"];
export type OrgInfo = OrgSettings["org"];
export type OrgPrimaryColor = OrgInfo["primary_color"];
/** A custom domain with its verification state and the DNS records to create. */
export type OrgDomain = GetAdminOrganizationDomainsResponses["200"]["data"][number];
/** An org as the system admins see it (`/system/orgs`). */
export type SystemOrg = GetSystemOrgsResponses["200"]["data"][number];
/** A custom domain with its org, in the system dashboard's list across all orgs. */
export type SystemDomain = GetSystemDomainsResponses["200"]["data"][number];
export type NewAPIKey = NonNullable<PostAccountApikeysData["body"]>;

/** A user as shown in lists, assignee pickers and chat (`UserSummary` on the server). */
export type UserSummary = GetUsersResponses["200"]["data"][number];

export type EventWithAccess = GetEventsResponses["200"]["data"][number];
export type EventPermission = EventWithAccess["permissions"][number];
export type EventMember = GetEventsByEventIdMembersResponses["200"]["data"][number];

/** A date ("Termin") of a recurring event, and a column of its duty roster. */
export type EventOccurrence =
	GetEventsByEventIdOccurrencesResponses["200"]["data"]["occurrences"][number];
export type OccurrenceResponsibility =
	GetEventsByEventIdOccurrencesResponses["200"]["data"]["responsibilities"][number];

/** An event's material list, one entry of it, a request, and the inventory as the Leitung sees it. */
export type EventMaterials = GetEventsByEventIdMaterialsResponses["200"]["data"];
export type EventMaterial = EventMaterials["items"][number];
export type MaterialKind = EventMaterial["kind"];
export type MaterialLink = EventMaterial["links"][number];
export type MaterialRequest = EventMaterials["requests"][number];
export type MaterialPeriod = NonNullable<EventMaterials["period"]>;
export type MaterialCatalogItem =
	GetEventsByEventIdMaterialsCatalogResponses["200"]["data"][number];

export type EventTask = GetEventsByEventIdTasksResponses["200"]["data"][number];
export type TaskStatus = EventTask["status"];
export type TaskPriority = EventTask["priority"];

export type NotificationItem = GetNotificationsResponses["200"]["data"]["items"][number];

export type FolderListing = GetEventsByEventIdFilesResponses["200"]["data"];
export type FileItem = FolderListing["items"][number];
/** Who has access to a document or folder (own, inherited or the library's default list). */
export type FileAccessView = GetFilesByFileIdAccessResponses["200"]["data"];
export type FileAccessEntry = FileAccessView["entries"][number];
export type FileAccessRights = FileAccessEntry["permissions"];
export type FileAccessCandidate = GetFilesByFileIdAccessCandidatesResponses["200"]["data"][number];

export type OrgGroup = GetAdminGroupsResponses["200"]["data"][number];

/** An earlier version of a file ("Versionen"). */
export type FileVersion = GetFilesByFileIdVersionsResponses["200"]["data"][number];

/** Office documents that can be created empty (with an office server). */
export type OfficeType = PostOrgDocumentsOfficeData["body"]["type"];

/** An item in the Papierkorb of a document library. */
export type TrashItem = GetOrgDocumentsTrashResponses["200"]["data"][number];

/** The Papierkorb calls of one library (org documents or one event's), for `FilesBrowser`. */
export interface TrashAdapter {
	list: () => Promise<TrashItem[] | null>;
	/** The restored item (`parent_id` null: it went to the top level), null when that failed. */
	restore: (fileId: number) => Promise<FileItem | null>;
	purge: (fileId: number) => Promise<boolean>;
	empty: () => Promise<boolean>;
}

/** A full account as admins see it (`/admin/users`). */
export type AdminUser = GetAdminUsersResponses["200"]["data"][number];
export type AdminUserDetail = GetAdminUsersByUserIdResponses["200"]["data"];
/** A one-time "set your password" link, shown to the admin once. */
export type PasswordLink = PostAdminUsersByUserIdPasswordLinkResponses["201"]["data"];

/** A share link of a file or folder, for the people managing it. */
export type FileShare = GetFilesByFileIdSharesResponses["200"]["data"][number];
export type SharePermissions = FileShare["permissions"];
/** A share link with the item it opens (admins' overview). */
export type AdminShare = GetAdminSharesResponses["200"]["data"][number];
/** What a share link's visitors see. */
export type PublicShareInfo = GetPublicDocsByTokenResponses["200"]["data"];
export type PublicShareItem = NonNullable<PublicShareInfo["item"]>;
export type PublicShareListing = GetPublicDocsByTokenItemsResponses["200"]["data"];
