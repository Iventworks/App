/**
 * Usernames built from a person's name by the org's schema (`orgs.username_schema`), e.g.
 * `{FIRSTNAME}.{LASTNAME}` → `max.mueller`. Pure functions without server imports: the frontend
 * imports this file too, so the preview in the forms is exactly what the server stores.
 *
 * Rules:
 * - `{FIRSTNAME}` is the first of the first names ("Anna Maria" → `anna`; "Hans-Peter" stays
 *   `hans-peter`), `{LASTNAME}` the whole last name ("von der Leyen" → `von-der-leyen`).
 *   `{FIRSTNAME_INITIAL}` / `{LASTNAME_INITIAL}` are their first letters.
 * - Umlauts are spelled out (ä → ae, ß → ss), other accents dropped (é → e), Cyrillic and Greek
 *   written in Latin letters as in passports (ICAO 9303: Иван → ivan), spaces inside a name
 *   become `-`, everything else that a username can't contain is removed.
 * - A name in another script (e.g. Chinese, Arabic) gives no username: then the person picks one
 *   (`needsChosenUsername`).
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

	/**
	 * Cyrillic and Greek in Latin letters (ICAO 9303, as in passports). Letters with accents or a
	 * breve (й, ё, ї, ў, ά) lose them first and use their base letter, as ICAO does.
	 */
	const TRANSLITERATED: Record<string, string> = {
		а: "a",
		б: "b",
		в: "v",
		г: "g",
		ґ: "g",
		д: "d",
		ђ: "d",
		е: "e",
		є: "ie",
		ж: "zh",
		з: "z",
		ѕ: "dz",
		и: "i",
		і: "i",
		ј: "j",
		к: "k",
		л: "l",
		љ: "lj",
		м: "m",
		н: "n",
		њ: "nj",
		о: "o",
		п: "p",
		р: "r",
		с: "s",
		т: "t",
		ћ: "c",
		у: "u",
		ф: "f",
		х: "kh",
		ц: "ts",
		ч: "ch",
		џ: "dz",
		ш: "sh",
		щ: "shch",
		ъ: "ie",
		ы: "y",
		ь: "",
		э: "e",
		ю: "iu",
		я: "ia",
		α: "a",
		β: "v",
		γ: "g",
		δ: "d",
		ε: "e",
		ζ: "z",
		η: "i",
		θ: "th",
		ι: "i",
		κ: "k",
		λ: "l",
		μ: "m",
		ν: "n",
		ξ: "x",
		ο: "o",
		π: "p",
		ρ: "r",
		σ: "s",
		ς: "s",
		τ: "t",
		υ: "y",
		φ: "f",
		χ: "ch",
		ψ: "ps",
		ω: "o",
	};

	/** Greek vowel pairs ICAO spells as one sound (Παπαδόπουλος → papadopoulos). */
	const GREEK_DIGRAPHS: Record<string, string> = { ου: "ou", αυ: "av", ευ: "ev" };

	/** A name part as username characters: lower case, ASCII, spaces → `-`. */
	export function normalizePart(value: string): string {
		return (
			value
				// Composed first: an "ü" pasted as u + ¨ (macOS, PDFs) must still become "ue".
				.normalize("NFC")
				.trim()
				.toLowerCase()
				.replace(/[äöüßẞæœøåłđðþı]/g, (char) => SPELLED_OUT[char] ?? "")
				.normalize("NFKD")
				.replace(/[\u0300-\u036f]/g, "")
				.replace(/[\u03bf\u03b1\u03b5]\u03c5/g, (pair) => GREEK_DIGRAPHS[pair] ?? pair)
				.replace(/[\u0370-\u03ff\u0400-\u04ff]/g, (char) => TRANSLITERATED[char] ?? "")
				.replace(/['’`´]/g, "")
				.replace(/\s+/g, "-")
				.replace(/[^a-z0-9._-]/g, "")
				.replace(/[._-]{2,}/g, (run) => run[0] as string)
				.replace(/^[._-]+|[._-]+$/g, "")
		);
	}

	/**
	 * True when a real name gives no username under `schema`: it is written in a script these rules
	 * can't spell in Latin letters (e.g. Chinese, Arabic). The person then picks the username, as in
	 * free mode. Names without any letters ("!!!") don't count — they are simply invalid.
	 */
	export function needsChosenUsername(schema: string, firstName: string, lastName: string): boolean {
		return (
			/\p{L}/u.test(firstName) && /\p{L}/u.test(lastName) && !generate(schema, firstName, lastName)
		);
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
	 * `base2`, `base3`, … — shortened so the number still fits. A base too short to be a username
	 * on its own counts from 1 instead, padded to the minimum length: `li` → `li001`, `li002`, …;
	 * `a.li` → `a.li1`. Null when the candidate isn't a valid username.
	 */
	export function candidate(base: string, attempt: number): string | null {
		if (attempt === 0) return isValid(base) ? base : null;
		const suffix =
			base.length < MIN_LENGTH
				? String(attempt).padStart(MIN_LENGTH - base.length, "0")
				: String(attempt + 1);
		const value = tidy(base.slice(0, MAX_LENGTH - suffix.length)) + suffix;
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
