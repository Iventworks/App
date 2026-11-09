import { OrgRegistry } from "../../server/lib/orgs/registry";

/** The org every test request goes to unless it sends another host. */
export const TEST_ORG_SLUG = "test";

/** `IVENTWORKS_APP_URL` in the tests is http://localhost:31316, so orgs live at `<slug>.localhost`. */
export const TEST_HOST = `${TEST_ORG_SLUG}.localhost`;

/** The system admin dashboard's host (multi-org base domain). */
export const SYSTEM_HOST = "localhost";

export function testOrg() {
	const org = OrgRegistry.getBySlug(TEST_ORG_SLUG);
	if (!org) throw new Error("The test org is missing — is the preload running?");
	return org;
}

/** Headers for a request to `host` (another org, the system host, an unknown host). */
export function hostHeaders(host: string) {
	return { "X-Iventworks-Host": host };
}
