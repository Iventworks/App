import { Hono } from "hono";

/**
 * Everything people without an account reach through a link, one path per kind: document share
 * links (`/public/docs/{token}`, page `/s/doc/<token>`) and forms (`/public/forms/{token}`, page
 * `/s/form/<token>`). The token in the path is the only key; the login middleware skips
 * `/v1/public/`. A new kind of link gets its own `/public/<kind>/` router here.
 */
export const router = new Hono().basePath("/public");

router.route("/", (await import("./docs")).router);
router.route("/", (await import("./forms")).router);
