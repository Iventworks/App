import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { DB } from "../db";
import { OrgContext } from "../orgs/context";
import { type OrgInfo, OrgRegistry } from "../orgs/registry";
import { FormFields } from "./fields";

type StarterInput = {
	title: string;
	description: string;
	confirmation_message: string;
	fields: z.input<typeof FormFields.Field>[];
};

const SATISFACTION = { min: 1, max: 5, min_label: "schlecht", max_label: "sehr gut" };

const STARTERS: StarterInput[] = [
	{
		title: "Feedback",
		description:
			"Wie hat es dir gefallen? Deine Rückmeldung hilft uns, beim nächsten Mal noch besser zu werden. Die Antworten sind anonym.",
		confirmation_message: "Danke für dein Feedback!",
		fields: [
			{ id: "gesamt", type: "rating", label: "Wie zufrieden bist du insgesamt?", required: true },
			{
				id: "wieder",
				type: "single_choice",
				label: "Würdest du wieder dabei sein?",
				options: [
					{ id: "ja", label: "Ja" },
					{ id: "vielleicht", label: "Vielleicht" },
					{ id: "nein", label: "Nein" },
				],
			},
			{ id: "gut", type: "long_text", label: "Was hat dir besonders gefallen?" },
			{ id: "besser", type: "long_text", label: "Was können wir besser machen?" },
		],
	},
	{
		title: "Anmeldung",
		description: "Melde dich hier an. Fragen mit * müssen beantwortet werden.",
		confirmation_message: "Danke für deine Anmeldung! Wir melden uns bei dir.",
		fields: [
			{ id: "person", type: "section", label: "Teilnehmende Person" },
			{ id: "vorname", type: "short_text", label: "Vorname", required: true },
			{ id: "nachname", type: "short_text", label: "Nachname", required: true },
			{ id: "geburtsdatum", type: "date", label: "Geburtsdatum", required: true },
			{
				id: "kontakt",
				type: "section",
				label: "Kontakt",
				description: "Bei Minderjährigen die Kontaktdaten einer erziehungsberechtigten Person.",
			},
			{ id: "email", type: "email", label: "E-Mail-Adresse", required: true },
			{
				id: "telefon",
				type: "short_text",
				label: "Telefonnummer",
				description: "Für Rückfragen und Notfälle.",
			},
			{ id: "gesundheit", type: "section", label: "Gesundheit und Ernährung" },
			{
				id: "allergien",
				type: "single_choice",
				label: "Gibt es Allergien oder Unverträglichkeiten?",
				required: true,
				options: [
					{ id: "ja", label: "Ja" },
					{ id: "nein", label: "Nein" },
				],
			},
			{
				id: "allergien_welche",
				type: "long_text",
				label: "Welche Allergien oder Unverträglichkeiten?",
				required: true,
				condition: { field_id: "allergien", option_ids: ["ja"] },
			},
			{
				id: "ernaehrung",
				type: "dropdown",
				label: "Ernährung",
				options: [
					{ id: "keine", label: "Keine Besonderheiten" },
					{ id: "vegetarisch", label: "Vegetarisch" },
					{ id: "vegan", label: "Vegan" },
				],
			},
			{ id: "anmerkungen", type: "long_text", label: "Möchtest du uns noch etwas mitteilen?" },
			{
				id: "einwilligung",
				type: "multiple_choice",
				label: "Einwilligung",
				description:
					"Wir verwenden deine Angaben nur, um die Veranstaltung zu planen und durchzuführen.",
				required: true,
				options: [{ id: "ja", label: "Ich bin mit der Verarbeitung meiner Angaben einverstanden." }],
			},
		],
	},
	{
		title: "Veranstaltungsbewertung",
		description: "Bitte bewerte die Veranstaltung. Die Antworten sind anonym.",
		confirmation_message: "Vielen Dank für deine Bewertung!",
		fields: [
			{ id: "programm", type: "scale", label: "Programm", required: true, ...SATISFACTION },
			{ id: "organisation", type: "scale", label: "Organisation", required: true, ...SATISFACTION },
			{ id: "unterkunft", type: "scale", label: "Unterkunft und Verpflegung", ...SATISFACTION },
			{
				id: "empfehlung",
				type: "scale",
				label: "Wie wahrscheinlich ist es, dass du uns weiterempfiehlst?",
				required: true,
				min: 0,
				max: 10,
				min_label: "unwahrscheinlich",
				max_label: "sehr wahrscheinlich",
			},
			{ id: "anmerkungen", type: "long_text", label: "Was möchtest du uns noch sagen?" },
		],
	},
];

/**
 * The form templates every org starts with (Feedback, Anmeldung, Veranstaltungsbewertung). They
 * are ordinary templates: the Kernteam changes or deletes them like its own. Each org gets them
 * once (`orgs.form_starters_added`) — at startup for orgs that don't have them yet, and when an
 * org is created.
 */
export namespace FormStarters {
	export const TEMPLATES = STARTERS.map((starter) => ({
		...starter,
		fields: FormFields.List.parse(starter.fields),
	}));

	/** Add them to every org that hasn't had them yet (startup, after the registry is loaded). */
	export function addWhereMissing() {
		const T = DB.Tables;
		const rows = OrgContext.unscoped(() =>
			DB.instance()
				.select({ id: T.orgs.id })
				.from(T.orgs)
				.where(and(eq(T.orgs.kind, "org"), eq(T.orgs.form_starters_added, false)))
				.all(),
		);
		for (const row of rows) {
			const org = OrgRegistry.get(row.id);
			if (org) addTo(org);
		}
	}

	/** Add them to `org` and mark it, in one transaction (a crash in between adds nothing). */
	export function addTo(org: OrgInfo) {
		const T = DB.Tables;
		OrgContext.run(org, () =>
			DB.instance().transaction((tx) => {
				const flagged = tx
					.update(T.orgs)
					.set({ form_starters_added: true })
					.where(and(eq(T.orgs.id, org.id), eq(T.orgs.form_starters_added, false)))
					.returning({ id: T.orgs.id })
					.all();
				if (!flagged.length) return;
				const now = Date.now();
				for (const template of TEMPLATES) {
					tx
						.insert(T.forms)
						.values({
							scope: "template",
							title: template.title,
							description: template.description,
							confirmation_message: template.confirmation_message,
							fields: template.fields,
							created_at: now,
							updated_at: now,
							org_id: OrgContext.id(),
						})
						.run();
				}
			}),
		);
	}
}
