import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import { DB } from "../../../../../db";
import type { DrizzleDB } from "../../../../../db/utils";
import { Logger } from "../../../../../utils/logger";
import { APIResponse } from "../../../../utils/api-res";
import { AuthHandler, SessionHandler } from "../../../../utils/authHandler";
import { getClientIP } from "../../../../utils/clientInfo";
import { APIResponseSpec, APIRouteSpec } from "../../../../utils/specHelpers";
import { DOCS_TAGS } from "../../docs";
import { AuthModel } from "./model";

// Dummy bcrypt hash for timing-normalized login failures — prevents username enumeration
// Generated once at module load so it's a valid, cost-equivalent hash
const DUMMY_PASSWORD_HASH = await Bun.password.hash("dummy-timing-constant");

// In-memory login rate limiting (5-minute window):
// - per client IP + username: blocks password guessing against one account from one client
// - per client IP (failures only): blocks spraying many usernames from one client
// There is deliberately NO hard per-username lock across all clients: that would let anyone keep
// a known account (e.g. `admin`) locked out. Instead, repeated failures for a username from many
// clients only slow responses down (argon2 hashing already makes guessing expensive).
const LOGIN_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const LOGIN_MAX_ATTEMPTS_PER_CLIENT_AND_USER = 5;
const LOGIN_MAX_ATTEMPTS_PER_CLIENT = 30;
const LOGIN_SLOWDOWN_AFTER_USER_FAILURES = 15;
const LOGIN_SLOWDOWN_MS = 1500;

type AttemptEntry = { count: number; resetAt: number };
const clientUserAttempts = new Map<string, AttemptEntry>();
const clientAttempts = new Map<string, AttemptEntry>();
const userFailures = new Map<string, AttemptEntry>();

// Periodic cleanup to prevent unbounded memory growth — runs every 5 minutes
const LOGIN_CLEANUP_INTERVAL = setInterval(() => {
	const now = Date.now();
	for (const map of [clientUserAttempts, clientAttempts, userFailures]) {
		for (const [key, entry] of map) {
			if (entry.resetAt <= now) map.delete(key);
		}
	}
}, LOGIN_WINDOW_MS);
// Allow the process to exit without waiting for this interval
LOGIN_CLEANUP_INTERVAL.unref();

/** Increment a window counter and return the new count (no await between read and write). */
function increment(map: Map<string, AttemptEntry>, key: string): number {
	const now = Date.now();
	let entry = map.get(key);
	if (!entry || entry.resetAt <= now) {
		entry = { count: 1, resetAt: now + LOGIN_WINDOW_MS };
		map.set(key, entry);
	} else {
		entry.count += 1;
	}
	return entry.count;
}

function currentCount(map: Map<string, AttemptEntry>, key: string): number {
	const entry = map.get(key);
	return entry && entry.resetAt > Date.now() ? entry.count : 0;
}

export const router = new Hono().basePath("/auth");

router.post(
	"/login",

	APIRouteSpec.unauthenticated({
		summary: "User Login",
		description: "Authenticate a user with their username and password",
		tags: [DOCS_TAGS.AUTHENTICATION],

		responses: APIResponseSpec.describeWithWrongInputs(
			APIResponseSpec.success("Login successful", AuthModel.Login.Response),
			APIResponseSpec.unauthorized("Unauthorized: Invalid username or password"),
			APIResponseSpec.tooManyRequests("Too many login attempts. Try again later."),
		),
	}),

	zValidator("json", AuthModel.Login.Body),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c) as AuthHandler.UnauthenticatedAuthContext;
		if (authContext.type !== "unauthenticated") {
			return APIResponse.forbidden(c, "You are already authenticated");
		}

		const { username, password } = c.req.valid("json");

		try {
			const clientIP = getClientIP(c);
			const usernameKey = username.toLowerCase();
			const clientUserKey = `${clientIP}:${usernameKey}`;

			// Increment the per-account counter FIRST, then check limits — eliminates TOCTOU race.
			// The per-client counter only counts failures, so many people logging in from one
			// network (e.g. the camp Wi-Fi) are not throttled.
			const perClientUser = increment(clientUserAttempts, clientUserKey);

			if (
				perClientUser > LOGIN_MAX_ATTEMPTS_PER_CLIENT_AND_USER ||
				currentCount(clientAttempts, clientIP) >= LOGIN_MAX_ATTEMPTS_PER_CLIENT
			) {
				const retrySeconds = Math.max(1, Math.ceil(LOGIN_WINDOW_MS / 1000));
				c.header("Retry-After", retrySeconds.toString());
				return APIResponse.tooManyRequests(c, `Too many login attempts. Try again in ${retrySeconds}s`);
			}

			if (currentCount(userFailures, usernameKey) >= LOGIN_SLOWDOWN_AFTER_USER_FAILURES) {
				await Bun.sleep(LOGIN_SLOWDOWN_MS);
			}

			const user = DB.instance()
				.select()
				.from(DB.Tables.users)
				.where(eq(DB.Tables.users.username, username))
				.get();
			if (!user) {
				// Timing-normalized: always run a bcrypt call to prevent username enumeration
				await Bun.password.verify("dummy-timing-constant", DUMMY_PASSWORD_HASH);
				increment(userFailures, usernameKey);
				increment(clientAttempts, clientIP);
				return APIResponse.unauthorized(c, "Invalid username or password");
			}

			const passwordMatch = await Bun.password.verify(password, user.password_hash);
			if (!passwordMatch) {
				increment(userFailures, usernameKey);
				increment(clientAttempts, clientIP);
				return APIResponse.unauthorized(c, "Invalid username or password");
			}

			// Successful login — clear this client's counter for the account
			clientUserAttempts.delete(clientUserKey);

			const session = await DB.instance().transaction(async (tx: DrizzleDB) => {
				return await SessionHandler.createSession(user.id, tx);
			});

			return APIResponse.success(c, "Login successful", session satisfies AuthModel.Login.Response);
		} catch (error: any) {
			Logger.error("Failed to create session", error.stack || error.message || error);
			return APIResponse.serverError(c, "Failed to create session");
		}
	},
);

router.get(
	"/session",

	APIRouteSpec.authenticated({
		summary: "Get Current Session",
		description: "Retrieve the current user's session information",
		tags: [DOCS_TAGS.AUTHENTICATION],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.success("Session info retrieved successfully", AuthModel.Session.Response),
			APIResponseSpec.unauthorized(
				"Unauthorized: Invalid or missing session token / Your Auth Context is not a session",
			),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);
		if (authContext.type !== "session") {
			return APIResponse.unauthorized(c, "Your Auth Context is not a session");
		}

		return APIResponse.success(c, "Session info retrieved successfully", {
			user_id: authContext.user_id,
			user_role: authContext.user_role,
			created_at: authContext.created_at,
			expires_at: authContext.expires_at,
		} satisfies AuthModel.Session.Response);
	},
);

router.post(
	"/logout",

	APIRouteSpec.authenticated({
		summary: "User Logout",
		description: "Invalidate the current user's session",
		tags: [DOCS_TAGS.AUTHENTICATION],

		responses: APIResponseSpec.describeBasic(
			APIResponseSpec.successNoData("Logout successful"),
			APIResponseSpec.unauthorized(
				"Unauthorized: Invalid or missing session token / Your Auth Context is not a session",
			),
		),
	}),

	async (c) => {
		const authContext = AuthHandler.AuthContext.get(c);

		if (authContext.type !== "session") {
			return APIResponse.unauthorized(c, "Your Auth Context is not a session");
		}

		await SessionHandler.inValidateSession(authContext.id);

		return APIResponse.successNoData(c, "Logout successful");
	},
);

router.route("/", (await import("./reset-password")).router);
router.route("/", (await import("./invitations")).router);
