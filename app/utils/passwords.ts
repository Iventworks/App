import * as z from "zod";

export const PASSWORD_HINT = "8–50 Zeichen mit Groß- und Kleinbuchstaben, Zahl und Sonderzeichen.";

/**
 * A new password, rule by rule with German messages. Mirrors the backend's
 * `UserDataPolicies.Password` (whose generated schema only has one combined regex). No `.trim()`:
 * it would silently change the password.
 */
export function newPasswordField() {
	return z
		.string("Passwort ist erforderlich")
		.min(8, "Muss mindestens 8 Zeichen lang sein")
		.max(50, "Darf höchstens 50 Zeichen lang sein")
		.regex(/[A-Z]/, "Muss mindestens einen Großbuchstaben enthalten")
		.regex(/[a-z]/, "Muss mindestens einen Kleinbuchstaben enthalten")
		.regex(/[0-9]/, "Muss mindestens eine Zahl enthalten")
		.regex(/[\W_]/, "Muss mindestens ein Sonderzeichen enthalten");
}

/** Mirrors `UserDataPolicies.Username`. */
export function usernameField() {
	return z
		.string("Benutzername ist erforderlich")
		.trim()
		.min(5, "Mindestens 5 Zeichen")
		.max(40, "Höchstens 40 Zeichen")
		.regex(
			/^(?!.*[.-]{2})[a-z0-9](?:[a-z0-9._-]{3,38}[a-z0-9_])?$/,
			"Nur Kleinbuchstaben, Zahlen, Punkt, Unter- und Bindestrich",
		);
}
