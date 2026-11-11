import { Hono } from "hono";
import type { GenerateSpecOptions } from "hono-openapi";
import { AppConstants } from "../../../utils/constants";
import { APIVersionRouter } from "../../utils/apiVersionRouter";
import { DOCS_TAGS } from "./docs";
import { authMiddlewareV1 } from "./middleware/auth";
import { orgMiddlewareV1 } from "./middleware/org";
import { router as accountRouter } from "./routes/account";
import { router as adminRouter } from "./routes/admin";
import { router as authRouter } from "./routes/auth";
import { router as calendarRouter } from "./routes/calendar";
import { router as conversationsRouter } from "./routes/conversations";
import { router as dashboardRouter } from "./routes/dashboard";
import { router as eventsRouter } from "./routes/events";
import { router as filesRouter } from "./routes/files";
import { router as instanceRouter } from "./routes/instance";
import { router as notesRouter } from "./routes/notes";
import { router as notificationsRouter } from "./routes/notifications";
import { router as orgRouter } from "./routes/org";
import { router as sharesRouter } from "./routes/shares";
import { router as systemRouter } from "./routes/system";
import { router as tasksRouter } from "./routes/tasks";
import { router as usersRouter } from "./routes/users";

// [tag, description, parent tag (for nested display in Scalar)]
const TAG_DEFINITIONS: [string, string, string?][] = [
	[DOCS_TAGS.ACCOUNT, "Endpoints for user account management"],
	[DOCS_TAGS.ACCOUNT_API_KEYS, "Endpoints for managing account API keys", DOCS_TAGS.ACCOUNT],
	[DOCS_TAGS.ACCOUNT_PREFERENCES, "Endpoints for managing account preferences", DOCS_TAGS.ACCOUNT],
	[DOCS_TAGS.ACCOUNT_SESSIONS, "List and revoke your active login sessions", DOCS_TAGS.ACCOUNT],
	[DOCS_TAGS.AUTHENTICATION, "Endpoints for authentication and authorization"],
	[
		DOCS_TAGS.AUTH_INVITATIONS,
		"Accept an admin-issued invitation (accounts are invite-only)",
		DOCS_TAGS.AUTHENTICATION,
	],

	[DOCS_TAGS.PERSONAL.DASHBOARD, "The signed-in user's personal overview", DOCS_TAGS.PERSONAL.BASE],
	[
		DOCS_TAGS.PERSONAL.TASKS,
		"Personal to-dos and all tasks assigned to you",
		DOCS_TAGS.PERSONAL.BASE,
	],
	[DOCS_TAGS.PERSONAL.NOTES, "Personal notes", DOCS_TAGS.PERSONAL.BASE],
	[
		DOCS_TAGS.PERSONAL.CALENDAR,
		"Personal calendar entries and the combined calendar feed",
		DOCS_TAGS.PERSONAL.BASE,
	],
	[DOCS_TAGS.PERSONAL.NOTIFICATIONS, "In-app notifications", DOCS_TAGS.PERSONAL.BASE],
	[DOCS_TAGS.MESSAGING, "Direct messages, group chats and event/team channels"],
	[DOCS_TAGS.USERS, "Directory of the organisation's members"],
	[DOCS_TAGS.FILES, "File contents, renaming, moving and deleting"],
	[DOCS_TAGS.FILE_SHARES, "Share links for people without an account", DOCS_TAGS.FILES],
	[
		DOCS_TAGS.PUBLIC_SHARES,
		"What a share link opens: no account, the link's token (and password) decide",
	],

	[DOCS_TAGS.EVENTS.EVENTS, "Camps, events and recurring events"],
	[DOCS_TAGS.EVENTS.MEMBERS, "Leaders and staff of an event", DOCS_TAGS.EVENTS.EVENTS],
	[
		DOCS_TAGS.EVENTS.GROUPS,
		"Staff sub-groups such as Küchenteam or Musikteam",
		DOCS_TAGS.EVENTS.EVENTS,
	],
	[DOCS_TAGS.EVENTS.ROOMS, "Rooms and who sleeps where", DOCS_TAGS.EVENTS.EVENTS],
	[
		DOCS_TAGS.EVENTS.PARTICIPANTS,
		"Participants incl. medical info and emergency contacts",
		DOCS_TAGS.EVENTS.EVENTS,
	],
	[
		DOCS_TAGS.EVENTS.OCCURRENCES,
		"The dates of a recurring event and who is on duty on each",
		DOCS_TAGS.EVENTS.EVENTS,
	],
	[DOCS_TAGS.EVENTS.PROGRAM, "The schedule (Programmpunkte)", DOCS_TAGS.EVENTS.EVENTS],
	[DOCS_TAGS.EVENTS.RESPONSIBILITIES, "Standing responsibilities of staff", DOCS_TAGS.EVENTS.EVENTS],
	[DOCS_TAGS.EVENTS.TASKS, "Event tasks", DOCS_TAGS.EVENTS.EVENTS],
	[DOCS_TAGS.EVENTS.NOTES, "Event-wide and group notes", DOCS_TAGS.EVENTS.EVENTS],
	[DOCS_TAGS.EVENTS.ANNOUNCEMENTS, "News for the event's staff", DOCS_TAGS.EVENTS.EVENTS],
	[DOCS_TAGS.EVENTS.DOCUMENTS, "Event documents and folders", DOCS_TAGS.EVENTS.EVENTS],
	[DOCS_TAGS.EVENTS.EXPENSES, "Expenses and receipts", DOCS_TAGS.EVENTS.EVENTS],
	[DOCS_TAGS.EVENTS.BUDGET, "Budget planning (leaders)", DOCS_TAGS.EVENTS.EVENTS],
	[DOCS_TAGS.EVENTS.INSIGHTS, "Statistics and audit log (leaders)", DOCS_TAGS.EVENTS.EVENTS],

	[DOCS_TAGS.ORG.ANNOUNCEMENTS, "Organisation-wide news", DOCS_TAGS.ORG.BASE],
	[
		DOCS_TAGS.ORG.DOCUMENTS,
		"Organisation-wide documents (read: everyone, write: core team)",
		DOCS_TAGS.ORG.BASE,
	],
	[DOCS_TAGS.ORG.RESOURCES, "Inventory and resource bookings for events", DOCS_TAGS.ORG.BASE],
	[
		DOCS_TAGS.ORG.CORE_TEAM,
		"Core team tools: finances, statistics, staff planning, notes",
		DOCS_TAGS.ORG.BASE,
	],

	[DOCS_TAGS.ADMIN_API.USERS, "Endpoints for user management", DOCS_TAGS.ADMIN_API.BASE],
	[DOCS_TAGS.ADMIN_API.INVITATIONS, "Invite new users", DOCS_TAGS.ADMIN_API.BASE],
	[DOCS_TAGS.ADMIN_API.AUDIT_LOG, "Organisation-wide audit log", DOCS_TAGS.ADMIN_API.BASE],
	[
		DOCS_TAGS.ADMIN_API.ORGANIZATION,
		"Your organisation's name, colour, logo, icon and custom domains",
		DOCS_TAGS.ADMIN_API.BASE,
	],

	[
		DOCS_TAGS.INSTANCE,
		"Public info about the org of the request's host: branding, icons, web app manifest",
	],
	[
		DOCS_TAGS.SYSTEM.ORGS,
		"Create and manage organisations (multi-org mode, system admins on the base domain)",
		DOCS_TAGS.SYSTEM.BASE,
	],
];

const openAPIConfig: Partial<GenerateSpecOptions> = {
	documentation: {
		info: {
			title: `${AppConstants.APP_NAME} API`,
			version: "1.0.0",
			description: `API for ${AppConstants.APP_NAME} Frontend and third-party clients`,
		},
		components: {
			securitySchemes: {
				bearerAuth: {
					type: "http",
					scheme: "bearer",
					description: "Enter your bearer token in the format **Bearer &lt;token&gt;**",
				},
			},
			responses: {
				401: {
					description: "Authentication information is missing or invalid",
				},
			},
		},

		// Disable global security because Scalar could not handle multiple security schemes properly
		security: [
			{
				bearerAuth: [],
			},
		],

		servers: [
			{
				url: `http://localhost:${AppConstants.APP_API_DEFAULT_PORT}/api/v1`,
				description: "Local development server",
			},
			{
				url: `${AppConstants.APP_API_DEFAULT_PROD_URL}/v1`,
				description: "Production server",
			},
		],

		// @ts-ignore OpenAPI vendor extension (Scalar tag groups), not in hono-openapi's types
		"x-tagGroups": [
			{
				name: "Account & Authentication",
				tags: [
					DOCS_TAGS.ACCOUNT,
					DOCS_TAGS.ACCOUNT_API_KEYS,
					DOCS_TAGS.ACCOUNT_PREFERENCES,
					DOCS_TAGS.ACCOUNT_SESSIONS,
					DOCS_TAGS.AUTHENTICATION,
					DOCS_TAGS.AUTH_INVITATIONS,
				],
			},
			{
				name: DOCS_TAGS.PERSONAL.BASE,
				tags: [
					DOCS_TAGS.PERSONAL.DASHBOARD,
					DOCS_TAGS.PERSONAL.TASKS,
					DOCS_TAGS.PERSONAL.NOTES,
					DOCS_TAGS.PERSONAL.CALENDAR,
					DOCS_TAGS.PERSONAL.NOTIFICATIONS,
					DOCS_TAGS.MESSAGING,
					DOCS_TAGS.USERS,
					DOCS_TAGS.FILES,
					DOCS_TAGS.FILE_SHARES,
					DOCS_TAGS.PUBLIC_SHARES,
				],
			},
			{
				name: DOCS_TAGS.EVENTS.BASE,
				tags: Object.entries(DOCS_TAGS.EVENTS)
					.filter(([key]) => key !== "BASE")
					.map(([, tag]) => tag),
			},
			{
				name: DOCS_TAGS.ORG.BASE,
				tags: Object.entries(DOCS_TAGS.ORG)
					.filter(([key]) => key !== "BASE")
					.map(([, tag]) => tag),
			},
			{
				name: DOCS_TAGS.ADMIN_API.BASE,
				tags: [
					DOCS_TAGS.ADMIN_API.USERS,
					DOCS_TAGS.ADMIN_API.INVITATIONS,
					DOCS_TAGS.ADMIN_API.AUDIT_LOG,
					DOCS_TAGS.ADMIN_API.ORGANIZATION,
				],
			},
			{
				name: "Instance & System",
				tags: [DOCS_TAGS.INSTANCE, DOCS_TAGS.SYSTEM.ORGS],
			},
		],

		tags: TAG_DEFINITIONS.map(([name, description, parent]) => ({
			name,
			description,
			...(parent
				? {
						"x-displayName": name.slice(name.lastIndexOf("/") + 1).trim(),
						summary: name.slice(name.lastIndexOf("/") + 1).trim(),
						parent,
					}
				: {}),
		})) as any,
	},
};

const router = new Hono();

// Org first: the auth middleware looks tokens up within the org of the request's host.
router.use(orgMiddlewareV1);
router.use(authMiddlewareV1);

router.route("/", instanceRouter);
router.route("/", systemRouter);

router.route("/", authRouter);
router.route("/", accountRouter);
router.route("/", adminRouter);

router.route("/", dashboardRouter);
router.route("/", tasksRouter);
router.route("/", notesRouter);
router.route("/", calendarRouter);
router.route("/", notificationsRouter);
router.route("/", conversationsRouter);
router.route("/", usersRouter);
router.route("/", filesRouter);
router.route("/", sharesRouter);

router.route("/", eventsRouter);
router.route("/", orgRouter);

export class APIv1Router extends APIVersionRouter {
	constructor() {
		super({
			version: 1,
			openAPIConfig,
			routes: router,
		});
	}
}
