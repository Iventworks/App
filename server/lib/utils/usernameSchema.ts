/**
 * Usernames built from a person's name by the org's schema (`orgs.username_schema`), e.g.
 * `{FIRSTNAME}.{LASTNAME}` → `max.mueller`. Pure functions without server imports: the frontend
 * imports this file too, so the preview in the forms is exactly what the server stores.
 *
 * Rules:
 * - `{FIRSTNAME}` is the first of the first names ("Anna Maria" → `anna`; "Hans-Peter" stays
 *   `hans-peter`), `{LASTNAME}` the whole last name ("von der Leyen" → `von-der-leyen`).
 *   `{FIRSTNAME_INITIAL}` / `{LASTNAME_INITIAL}` are their first letters.
 * - Umlauts are spelled out (ä → ae, ß → ss), other accents dropped (é → e), spaces inside a name
 *   become `-`, everything else that a username can't contain is removed.
 * - The result follows `UserDataPolicies.Username`. If the name is taken (or too short), a number
 *   is appended: `max.mueller2`, `max.mueller3`, … (`UsernameSchema.candidate`).
 */
export namespace UsernameSchema {
	export const DEFAULT = "{FIRSTNAME}.{LASTNAME}";
	export const MAX_SCHEMA_LENGTH = 60;

	export const PLACEHOLDERS = [
		{ token: "{FIRSTNAME}", label: "Vorname (der erste)" },
		{ token: "{LASTNAME}", label: "Nachname" },
		{ token: "{FIRSTNAME_INITIAL}", label: "Erster Buchstabe des Vornamens" },
		{ token: "{LASTNAME_INITIAL}", label: "Erster Buchstabe des Nachnamens" },
	] as const;

	/** Mirrors `UserDataPolicies.Username` (5–40 characters). */
	export const MIN_LENGTH = 5;
	export const MAX_LENGTH = 40;
	export const USERNAME_REGEX =
		/^(?!.*[.-]{2})(?!.*--)(?!.*\.\.)[a-z0-9](?:[a-z0-9._-]{3,38}[a-z0-9_])?$/;

	const PLACEHOLDER_REGEX = /\{(FIRSTNAME|LASTNAME|FIRSTNAME_INITIAL|LASTNAME_INITIAL)\}/gi;
	/** What a schema may contain between its placeholders. */
	const LITERAL_REGEX = /^[a-z0-9._-]*$/;

	const SPELLED_OUT: Record<string, string> = {
		ä: "ae",
		ö: "oe",
		ü: "ue",
		ß: "ss",
		ẞ: "ss",
		æ: "ae",
		œ: "oe",
		ø: "oe",
		å: "aa",
		ł: "l",
		đ: "d",
		ð: "d",
		þ: "th",
		ı: "i",
	};

	/** A name part as username characters: lower case, ASCII, spaces → `-`. */
	export function normalizePart(value: string): string {
		return value
			.trim()
			.toLowerCase()
			.replace(/[äöüßẞæœøåłđðþı]/g, (char) => SPELLED_OUT[char] ?? "")
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")
			.replace(/['’`´]/g, "")
			.replace(/\s+/g, "-")
			.replace(/[^a-z0-9._-]/g, "")
			.replace(/[._-]{2,}/g, (run) => run[0] as string)
			.replace(/^[._-]+|[._-]+$/g, "");
	}

	/** The first of several first names ("Anna Maria" → "Anna"). */
	export function firstOfFirstNames(firstName: string): string {
		return firstName.trim().split(/\s+/)[0] ?? "";
	}

	/** Why a schema can't be used (German, for the settings form), or null. */
	export function validate(schema: string): string | null {
		const trimmed = schema.trim();
		if (!trimmed) return "Bitte gib ein Schema an.";
		if (trimmed.length > MAX_SCHEMA_LENGTH) {
			return `Das Schema darf höchstens ${MAX_SCHEMA_LENGTH} Zeichen lang sein.`;
		}
		const placeholders = trimmed.match(PLACEHOLDER_REGEX) ?? [];
		const names = placeholders.map((token) => token.toUpperCase());
		if (!names.includes("{FIRSTNAME}") && !names.includes("{LASTNAME}")) {
			return "Das Schema muss {FIRSTNAME} oder {LASTNAME} enthalten.";
		}
		const literals = trimmed.replace(PLACEHOLDER_REGEX, "");
		if (/[{}]/.test(literals)) {
			return "Unbekannter Platzhalter. Erlaubt sind {FIRSTNAME}, {LASTNAME}, {FIRSTNAME_INITIAL} und {LASTNAME_INITIAL}.";
		}
		if (!LITERAL_REGEX.test(literals)) {
			return "Außer den Platzhaltern sind nur Kleinbuchstaben, Zahlen, Punkt, Unter- und Bindestrich erlaubt.";
		}
		const sample = generate(trimmed, "Maximilian", "Mustermann");
		if (!sample) return "Mit diesem Schema entsteht kein gültiger Benutzername.";
		return null;
	}

	/**
	 * The username for a name, without uniqueness (see `candidate`). Empty when the name gives
	 * nothing usable (e.g. only characters a username can't contain).
	 */
	export function generate(schema: string, firstName: string, lastName: string): string {
		const first = normalizePart(firstOfFirstNames(firstName));
		const last = normalizePart(lastName);
		const raw = schema.trim().replace(PLACEHOLDER_REGEX, (_, name: string) => {
			switch (name.toUpperCase()) {
				case "FIRSTNAME":
					return first;
				case "LASTNAME":
					return last;
				case "FIRSTNAME_INITIAL":
					return first.slice(0, 1);
				case "LASTNAME_INITIAL":
					return last.slice(0, 1);
				default:
					return "";
			}
		});
		return tidy(raw.toLowerCase());
	}

	/**
	 * The `attempt`-th candidate for a base username: `attempt` 0 is the base itself, then
	 * `base2`, `base3`, … — shortened so the number still fits. Null when it isn't a valid
	 * username (e.g. a base shorter than 5 characters without a number).
	 */
	export function candidate(base: string, attempt: number): string | null {
		const suffix = attempt === 0 ? "" : String(attempt + 1);
		const value = attempt === 0 ? base : tidy(base.slice(0, MAX_LENGTH - suffix.length)) + suffix;
		return isValid(value) ? value : null;
	}

	export function isValid(username: string): boolean {
		return (
			username.length >= MIN_LENGTH && username.length <= MAX_LENGTH && USERNAME_REGEX.test(username)
		);
	}

	/** Separators collapsed and trimmed, cut to the maximum length. */
	function tidy(value: string): string {
		let result = value
			.replace(/[._-]{2,}/g, (run) => run[0] as string)
			.replace(/^[._-]+/, "")
			.slice(0, MAX_LENGTH);
		// A username may end with `_`, not with `.` or `-`.
		result = result.replace(/[.-]+$/, "");
		return result;
	}
}
