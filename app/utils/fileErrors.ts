/**
 * German text for the errors of the document routes, which answer in English. Unknown messages are
 * passed through.
 */
export function fileErrorText(message: string, scope: "org" | "event") {
	const managers = scope === "org" ? "das Kernteam" : "die Leitung";
	if (message.includes("folder is being edited")) {
		return "In diesem Ordner wird gerade ein Dokument bearbeitet.";
	}
	if (message.includes("being edited")) return "Die Datei wird gerade bearbeitet.";
	if (message.includes("their own access")) {
		return `Darin liegen Ordner oder Dateien mit eigenem Zugriff. Diesen Ordner löschen oder verschieben kann nur ${managers}.`;
	}
	if (message.includes("levels deep")) return "So tief lassen sich Ordner nicht verschachteln.";
	if (message.includes("in the Papierkorb too")) {
		return "Der Ordner, in dem es lag, ist auch im Papierkorb. Stelle zuerst den Ordner wieder her.";
	}
	return message;
}
