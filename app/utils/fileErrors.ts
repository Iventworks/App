/**
 * German text for the errors of the document routes, which answer in English (the `message` of
 * the API's error envelope). Matched by a distinctive part of the message; unknown messages
 * (validation details, network errors) are passed through.
 */
import { type LibraryScope, managersOf } from "./filePermissions";

export function fileErrorText(message: string, scope: LibraryScope) {
	const managers = managersOf(scope).the;
	const texts: [part: string, text: string][] = [
		// The folder variant first: it also contains "being edited".
		["folder is being edited", "In diesem Ordner wird gerade ein Dokument in Office bearbeitet."],
		["being edited", "Die Datei wird gerade in Office bearbeitet."],
		[
			"their own access",
			`Darin liegen Ordner oder Dateien mit eigenem Zugriff. Diesen Ordner löschen oder verschieben kann nur ${managers}.`,
		],
		["levels deep", "So tief lassen sich Ordner nicht verschachteln."],
		["moved into itself", "Ein Ordner lässt sich nicht in sich selbst verschieben."],
		[
			"in the Papierkorb too",
			"Der Ordner, in dem es lag, ist auch im Papierkorb. Stelle zuerst den Ordner wieder her.",
		],
		["Not in the Papierkorb", "Das liegt nicht (mehr) im Papierkorb."],
		["delete for good", `Endgültig löschen kann nur ${managers}.`],
		["Office editing is not available", "Office ist hier nicht eingerichtet."],
		["can't be opened in the office editor", "Diese Datei lässt sich nicht in Office öffnen."],
		[
			"office server can't be reached",
			"Der Office-Server ist gerade nicht erreichbar. Versuche es gleich noch einmal.",
		],
		["Only available in the browser", "Das geht nur im Browser."],
		["File is too large", "Die Datei ist zu groß."],
		["older not found", "Den Ordner gibt es nicht (mehr)."],
		["File not found", "Die Datei gibt es nicht (mehr)."],
		["Version not found", "Diese Version gibt es nicht (mehr)."],
		["not allowed to add documents here", "Hier darfst du nichts ablegen."],
		["not allowed to edit this file", "Du darfst diese Datei nicht bearbeiten."],
		["not allowed to manage access", `Den Zugriff legt ${managers} fest.`],
		// Share links ("Teilen").
		["Share links are switched off", "Freigabelinks sind in deiner Organisation ausgeschaltet."],
		["not allowed to share", `Freigabelinks erstellt und verwaltet nur ${managers}.`],
		["manage share links", `Freigabelinks erstellt und verwaltet nur ${managers}.`],
		["Share link not found", "Diesen Freigabelink gibt es nicht (mehr)."],
		["Expiry must be in the future", "Das Ablaufdatum muss in der Zukunft liegen."],
		["Mindestens 4 Zeichen", "Das Passwort muss mindestens 4 Zeichen lang sein."],
		["Nothing to change", "Es gibt nichts zu ändern."],
		["not allowed", "Dazu fehlt dir die Berechtigung."],
		["listed once", "Jede Gruppe und jede Person darf nur einmal in der Liste stehen."],
		[
			"people on the event's team",
			"Hinzufügen kannst du nur Personen aus dem Team, nicht die Leitung (sie hat ohnehin Zugriff).",
		],
		["Group not found", "Diese Gruppe gibt es nicht (mehr)."],
		// Before "User not found": the access lists' message names both cases.
		[
			"always has full access as Kernteam",
			"Diese Person kann nicht in die Liste: Es gibt sie nicht (mehr), sie ist nicht aktiv, oder sie gehört zum Kernteam und hat ohnehin Zugriff.",
		],
		["User not found", "Diese Person gibt es nicht (mehr)."],
		// Validation errors (the API doesn't say which field).
		["input is invalid", "Bitte prüfe deine Eingaben."],
		["validation error", "Bitte prüfe deine Eingaben."],
	];
	return texts.find(([part]) => message.includes(part))?.[1] ?? message;
}
