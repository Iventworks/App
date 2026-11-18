/** The frontend's preview helpers (`app/utils/filePreview.ts`): pure functions, no Nuxt needed. */
import { describe, expect, test } from "bun:test";
import { filePreviewKind, parseCsv } from "../app/utils/filePreview";

describe("filePreviewKind", () => {
	test("picks the preview by MIME type and extension", () => {
		expect(filePreviewKind("foto.jpg", "image/jpeg")).toBe("image");
		expect(filePreviewKind("plan.pdf", "application/octet-stream")).toBe("pdf");
		expect(filePreviewKind("README.md", "text/markdown")).toBe("markdown");
		expect(filePreviewKind("liste.CSV", null)).toBe("csv");
		expect(filePreviewKind("notiz.txt", "text/plain")).toBe("text");
		expect(filePreviewKind("brief.docx", "application/octet-stream")).toBe("office");
		expect(filePreviewKind("archiv.zip", "application/zip")).toBe("none");
	});

	test("SVG and HTML are never previewed", () => {
		expect(filePreviewKind("logo.svg", "image/svg+xml")).toBe("none");
		expect(filePreviewKind("seite.html", "text/html")).toBe("none");
	});
});

describe("parseCsv", () => {
	test("commas, quotes and line breaks inside quotes", () => {
		expect(parseCsv('Name,Notiz\r\n"Müller, Max","sagt ""hallo""\nzweimal"\nAnna,\n')).toEqual([
			["Name", "Notiz"],
			["Müller, Max", 'sagt "hallo"\nzweimal'],
			["Anna", ""],
		]);
	});

	test("semicolons when the header uses them (German Excel)", () => {
		expect(parseCsv("Name;Betrag\nZelt;12,50")).toEqual([
			["Name", "Betrag"],
			["Zelt", "12,50"],
		]);
	});

	test("stops after maxRows", () => {
		expect(parseCsv("a\nb\nc\nd", 2)).toEqual([["a"], ["b"]]);
	});
});
