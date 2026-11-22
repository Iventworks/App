/**
 * The program as a PDF, for downloading and printing: "Liste" (A4 portrait, day by day with time,
 * title, place, responsible people and description) or "Wochenraster" (A4 landscape, up to seven
 * days per page, laid out like the Wochenplan grid). Built in the browser with jsPDF, loaded only
 * when someone exports. Standard PDF fonts (WinAnsi) — no font files, no network; they cover
 * umlauts, ß, „ “, – and …. jsPDF's `html()`/SVG paths (the only ones with further dynamic imports)
 * are never used.
 */
import type { jsPDF } from "jspdf";
import type {
	GetEventsByEventIdProgramResponses,
	GetEventsByEventIdSmallGroupsResponses,
} from "~/api-client";
import { fileSlug } from "./download";
import {
	formatDate,
	formatDayRange,
	formatLongDay,
	formatShortDay,
	formatTime,
	parseDay,
	toDayString,
} from "./format";

type ProgramItem = GetEventsByEventIdProgramResponses["200"]["data"][number];
type SmallGroup = GetEventsByEventIdSmallGroupsResponses["200"]["data"][number];
type RGB = [number, number, number];

export type ProgramPdfLayout = "list" | "grid";

export interface ProgramPdfOptions {
	layout: ProgramPdfLayout;
	eventName: string;
	/** First day of the event, for "Tag 3". */
	eventStart: string;
	/** Shown at the top right of every page (the org). */
	orgName?: string;
	/** The days to include (`YYYY-MM-DD`, ascending, without gaps). */
	days: string[];
	items: ProgramItem[];
	smallGroups: SmallGroup[];
	/** List layout: the item descriptions. */
	descriptions: boolean;
	responsibles: boolean;
	/** Append the Kleingruppen with meeting point and leaders. */
	smallGroupAppendix: boolean;
	/** The items are only the caller's — said in the page header. */
	onlyMine: boolean;
	/** Let the PDF viewer open the print dialog itself (printing in a new tab). */
	autoPrint?: boolean;
	/** "Stand" in the footer; defaults to now. */
	now?: number;
}

// --- page geometry (mm) and styles ----------------------------------------------------------

const MARGIN_X = 12;
const CONTENT_TOP = 25;
const CONTENT_BOTTOM = 14;
const DEFAULT_ITEM_COLOR = "#f97316";

const TEXT: RGB = [15, 23, 42];
const MUTED: RGB = [100, 116, 139];
const LINE: RGB = [221, 226, 232];
const HEAD_FILL: RGB = [241, 245, 249];
/** Marker colour for "In Kleingruppen" (fixed: the org colour is not known here). */
const SMALL_GROUP_MARK: RGB = [79, 70, 229];
const SMALL_GROUP_LABEL = "In Kleingruppen";

const PT_TO_MM = 25.4 / 72;
const LINE_HEIGHT_FACTOR = 1.15;

/** Line height in mm of a font size in pt. */
function lineHeight(pt: number) {
	return pt * LINE_HEIGHT_FACTOR * PT_TO_MM;
}

function hexToRgb(hex: string | null | undefined): RGB {
	const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
	const value = Number.parseInt(match?.[1] ?? DEFAULT_ITEM_COLOR.slice(1), 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** `color` mixed with white — the light background of a box in the grid. */
function tint([r, g, b]: RGB, amount: number): RGB {
	return [
		Math.round(255 - (255 - r) * amount),
		Math.round(255 - (255 - g) * amount),
		Math.round(255 - (255 - b) * amount),
	];
}

// --- data helpers -----------------------------------------------------------------------------

function dayBounds(day: string) {
	const start = parseDay(day);
	const end = parseDay(day);
	end.setDate(end.getDate() + 1);
	return { start: start.getTime(), end: end.getTime() };
}

function minutesOfDay(ts: number) {
	const date = new Date(ts);
	return date.getHours() * 60 + date.getMinutes();
}

function dayNumber(day: string, eventStart: string) {
	return Math.round((parseDay(day).getTime() - parseDay(eventStart).getTime()) / 86_400_000) + 1;
}

/** Items of the list's `day`: starting that day; on the first day also those still running. */
function listItemsOfDay(items: ProgramItem[], day: string, isFirstDay: boolean) {
	const { start, end } = dayBounds(day);
	return items
		.filter(
			(item) =>
				(item.start_at >= start && item.start_at < end) ||
				(isFirstDay && item.start_at < start && item.end_at > start),
		)
		.sort((a, b) => a.start_at - b.start_at || a.end_at - b.end_at);
}

/** `09:00 – 10:30`, with the day where start or end is not on `day`. */
function listTimeLabel(item: ProgramItem, day: string) {
	const { start, end } = dayBounds(day);
	const from =
		item.start_at < start
			? `${formatShortDay(item.start_at)} ${formatTime(item.start_at)}`
			: formatTime(item.start_at);
	// An item ending at midnight still belongs to its day.
	const to =
		item.end_at > end
			? `${formatShortDay(item.end_at)} ${formatTime(item.end_at)}`
			: formatTime(item.end_at);
	return `${from} – ${to}`;
}

/** Markdown (as the editor stores it) as plain lines for the PDF. */
function markdownToPlainText(markdown: string): string {
	return markdown
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((line) =>
			line
				.replace(/^\s{0,3}#{1,6}\s+/, "")
				.replace(/^\s*>\s?/, "")
				.replace(/^(\s*)[-*+]\s+\[[xX]\]\s+/, "$1[x] ")
				.replace(/^(\s*)[-*+]\s+\[\s\]\s+/, "$1[ ] ")
				.replace(/^(\s*)[-*+]\s+/, "$1• ")
				.replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, "$1")
				.replace(/(\*\*|__)(.+?)\1/g, "$2")
				.replace(/(\*|_)(.+?)\1/g, "$2")
				.replace(/~~(.+?)~~/g, "$1")
				.replace(/`([^`]*)`/g, "$1")
				.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1")
				.trimEnd(),
		)
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * The standard fonts only know WinAnsi (Latin-1 plus „ “ ‚ ‘ ’ – — … • € ™ …): anything else
 * (emoji, arrows) would come out as garbage, so it is dropped.
 */
const NOT_WIN_ANSI = /[^\n -~ -ÿŒœŠšŸŽžƒˆ˜–—‘-‚“-„†-•…‰‹›€™]/gu;

function pdfText(value: string): string {
	return value
		.replace(/\t/g, "  ")
		.replace(NOT_WIN_ANSI, "")
		.replace(/(\S) {2,}(?=\S)/g, "$1 ");
}

function names(item: ProgramItem) {
	return item.responsible.map((person) => person.display_name).join(", ");
}

/** Lines of `text` that fit `maxLines`, the last one ending in "…" when cut. */
function clampLines(doc: jsPDF, text: string, width: number, maxLines: number): string[] {
	if (maxLines <= 0) return [];
	const lines = doc.splitTextToSize(text, width) as string[];
	if (lines.length <= maxLines) return lines;
	const kept = lines.slice(0, maxLines);
	let last = `${kept[maxLines - 1] ?? ""}…`;
	while (last.length > 1 && doc.getTextWidth(last) > width) last = `${last.slice(0, -2)}…`;
	kept[maxLines - 1] = last;
	return kept;
}

// --- page chrome --------------------------------------------------------------------------

function drawChrome(doc: jsPDF, options: ProgramPdfOptions, subtitle: string) {
	const total = doc.getNumberOfPages();
	const stamp = `Stand: ${formatDate(options.now ?? Date.now())}`;
	for (let page = 1; page <= total; page++) {
		doc.setPage(page);
		const width = doc.internal.pageSize.getWidth();
		const height = doc.internal.pageSize.getHeight();

		doc.setFont("helvetica", "bold");
		doc.setFontSize(13);
		doc.setTextColor(...TEXT);
		const orgWidth = options.orgName ? 60 : 0;
		const title = clampLines(doc, pdfText(options.eventName), width - 2 * MARGIN_X - orgWidth, 1);
		doc.text(title, MARGIN_X, 10, { baseline: "top" });

		doc.setFont("helvetica", "normal");
		doc.setFontSize(8.5);
		doc.setTextColor(...MUTED);
		doc.text(pdfText(subtitle), MARGIN_X, 16, { baseline: "top" });
		if (options.orgName) {
			doc.text(clampLines(doc, pdfText(options.orgName), orgWidth - 4, 1), width - MARGIN_X, 11, {
				baseline: "top",
				align: "right",
			});
		}

		doc.setDrawColor(...LINE);
		doc.setLineWidth(0.3);
		doc.line(MARGIN_X, 21, width - MARGIN_X, 21);

		doc.setFontSize(7.5);
		doc.text(stamp, MARGIN_X, height - 8, { baseline: "top" });
		doc.text(`Seite ${page} von ${total}`, width - MARGIN_X, height - 8, {
			baseline: "top",
			align: "right",
		});
	}
}

// --- layout: list -------------------------------------------------------------------------

type AutoTable = typeof import("jspdf-autotable").autoTable;

function renderList(doc: jsPDF, autoTable: AutoTable, options: ProgramPdfOptions) {
	const pageWidth = doc.internal.pageSize.getWidth();
	const pageHeight = doc.internal.pageSize.getHeight();
	const contentWidth = pageWidth - 2 * MARGIN_X;
	const markAppendix = options.smallGroupAppendix && options.smallGroups.length > 0;

	const timeWidth = 27;
	const placeWidth = 34;
	const peopleWidth = options.responsibles ? 38 : 0;
	const titleWidth = contentWidth - timeWidth - placeWidth - peopleWidth;
	const padding = 1.6;

	const TITLE_PT = 9.5;
	const META_PT = 7.5;
	const DESCRIPTION_PT = 8;
	const MAX_DESCRIPTION_LINES = 14;

	let y = CONTENT_TOP;

	options.days.forEach((day, index) => {
		const items = listItemsOfDay(options.items, day, index === 0);

		// Keep a day's heading together with (at least the start of) its table.
		if (y > pageHeight - CONTENT_BOTTOM - 28) {
			doc.addPage("a4", "portrait");
			y = CONTENT_TOP;
		}

		doc.setFont("helvetica", "bold");
		doc.setFontSize(11);
		doc.setTextColor(...TEXT);
		const heading = formatLongDay(day);
		const headingWidth = doc.getTextWidth(heading);
		doc.text(heading, MARGIN_X, y, { baseline: "top" });
		doc.setFont("helvetica", "normal");
		doc.setFontSize(8.5);
		doc.setTextColor(...MUTED);
		doc.text(`Tag ${dayNumber(day, options.eventStart)}`, MARGIN_X + headingWidth + 2.5, y + 0.8, {
			baseline: "top",
		});
		y += 6.5;

		if (!items.length) {
			doc.setFont("helvetica", "italic");
			doc.setFontSize(8.5);
			doc.setTextColor(...MUTED);
			doc.text("Kein Programm geplant.", MARGIN_X, y, { baseline: "top" });
			y += 9;
			return;
		}

		// The title cell is drawn by hand (title, category / marker, description in their own
		// fonts); its height is measured here and given to the table as the minimum cell height.
		const titleCells = items.map((item) => {
			doc.setFont("helvetica", "bold");
			doc.setFontSize(TITLE_PT);
			const title = doc.splitTextToSize(pdfText(item.title), titleWidth - 2 * padding) as string[];

			const meta = [item.category ? pdfText(item.category) : null].filter(Boolean) as string[];
			const marker = item.in_small_groups
				? `${SMALL_GROUP_LABEL}${markAppendix ? " (siehe Übersicht)" : ""}`
				: null;

			doc.setFont("helvetica", "normal");
			doc.setFontSize(DESCRIPTION_PT);
			const description =
				options.descriptions && item.description.trim()
					? clampLines(
							doc,
							pdfText(markdownToPlainText(item.description)),
							titleWidth - 2 * padding,
							MAX_DESCRIPTION_LINES,
						)
					: [];

			const metaLine = meta.length || marker ? 1 : 0;
			const height =
				2 * padding +
				title.length * lineHeight(TITLE_PT) +
				metaLine * (lineHeight(META_PT) + 0.4) +
				(description.length ? description.length * lineHeight(DESCRIPTION_PT) + 0.8 : 0);
			return { item, title, meta: meta.join(" · "), marker, description, height };
		});

		const head = [
			["Zeit", "Programmpunkt", "Ort", ...(options.responsibles ? ["Verantwortlich"] : [])],
		];
		const body = items.map((item, row) => [
			listTimeLabel(item, day),
			{ content: "", styles: { minCellHeight: titleCells[row]?.height ?? 0 } },
			pdfText(item.location ?? ""),
			...(options.responsibles ? [pdfText(names(item))] : []),
		]);

		autoTable(doc, {
			startY: y,
			head,
			body,
			theme: "plain",
			margin: { left: MARGIN_X, right: MARGIN_X, top: CONTENT_TOP, bottom: CONTENT_BOTTOM },
			rowPageBreak: "avoid",
			styles: {
				font: "helvetica",
				fontSize: 8.5,
				textColor: TEXT,
				cellPadding: padding,
				lineColor: LINE,
				lineWidth: { bottom: 0.2 },
				valign: "top",
				overflow: "linebreak",
			},
			headStyles: {
				fontStyle: "bold",
				fontSize: 8,
				textColor: MUTED,
				fillColor: HEAD_FILL,
				lineWidth: 0,
			},
			columnStyles: {
				0: {
					cellWidth: timeWidth,
					cellPadding: { left: padding + 1.6, top: padding, right: padding, bottom: padding },
				},
				1: { cellWidth: titleWidth },
				2: { cellWidth: placeWidth },
				...(options.responsibles ? { 3: { cellWidth: peopleWidth } } : {}),
			},
			didDrawCell: (data) => {
				if (data.section !== "body") return;
				const cell = titleCells[data.row.index];
				if (!cell) return;

				if (data.column.index === 0) {
					// The item's colour as a bar in front of the time.
					doc.setFillColor(...hexToRgb(cell.item.color));
					doc.rect(data.cell.x + 0.6, data.cell.y + padding, 1, data.cell.height - 2 * padding, "F");
					return;
				}
				if (data.column.index !== 1) return;

				const x = data.cell.x + padding;
				let lineY = data.cell.y + padding;

				doc.setFont("helvetica", "bold");
				doc.setFontSize(TITLE_PT);
				doc.setTextColor(...TEXT);
				doc.text(cell.title, x, lineY, { baseline: "top" });
				lineY += cell.title.length * lineHeight(TITLE_PT);

				if (cell.meta || cell.marker) {
					lineY += 0.4;
					doc.setFont("helvetica", "normal");
					doc.setFontSize(META_PT);
					let metaX = x;
					if (cell.marker) {
						doc.setFillColor(...SMALL_GROUP_MARK);
						doc.circle(metaX + 0.9, lineY + lineHeight(META_PT) / 2 - 0.1, 0.8, "F");
						metaX += 2.6;
						doc.setTextColor(...SMALL_GROUP_MARK);
						doc.text(cell.marker, metaX, lineY, { baseline: "top" });
						metaX += doc.getTextWidth(cell.marker) + 2;
					}
					if (cell.meta) {
						doc.setTextColor(...MUTED);
						doc.text(cell.marker ? `· ${cell.meta}` : cell.meta, metaX, lineY, { baseline: "top" });
					}
					lineY += lineHeight(META_PT);
				}

				if (cell.description.length) {
					lineY += 0.8;
					doc.setFont("helvetica", "normal");
					doc.setFontSize(DESCRIPTION_PT);
					doc.setTextColor(...MUTED);
					doc.text(cell.description, x, lineY, { baseline: "top" });
				}
			},
		});

		y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y) + 7;
	});
}

// --- layout: week grid --------------------------------------------------------------------

interface Segment {
	item: ProgramItem;
	dayIndex: number;
	startMin: number;
	endMin: number;
	continuesBefore: boolean;
	continuesAfter: boolean;
	column: number;
	columns: number;
}

/** Items cut into one segment per day (as in `WeekGrid.vue`); lanes come from `assignLanes`. */
function gridSegments(items: ProgramItem[], days: string[]): Segment[] {
	const bounds = days.map(dayBounds);
	const result: Segment[] = [];

	for (const item of items) {
		bounds.forEach((day, dayIndex) => {
			if (item.start_at >= day.end || item.end_at <= day.start) return;
			const segStart = Math.max(item.start_at, day.start);
			const segEnd = Math.min(item.end_at, day.end);
			result.push({
				item,
				dayIndex,
				startMin: segStart === day.start ? 0 : minutesOfDay(segStart),
				endMin: segEnd === day.end ? 24 * 60 : minutesOfDay(segEnd),
				continuesBefore: item.start_at < day.start,
				continuesAfter: item.end_at > day.end,
				column: 0,
				columns: 1,
			});
		});
	}
	return result;
}

/** Side by side where segments overlap: greedy columns inside overlapping clusters, per day. */
function assignLanes(segments: Segment[], dayCount: number) {
	for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
		const daySegments = segments
			.filter((segment) => segment.dayIndex === dayIndex)
			.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

		let cluster: Segment[] = [];
		let columnEnds: number[] = [];
		let clusterEnd = -1;
		const closeCluster = () => {
			for (const segment of cluster) segment.columns = columnEnds.length;
			cluster = [];
			columnEnds = [];
		};

		for (const segment of daySegments) {
			if (segment.startMin >= clusterEnd) closeCluster();
			let column = columnEnds.findIndex((end) => end <= segment.startMin);
			if (column === -1) {
				column = columnEnds.length;
				columnEnds.push(segment.endMin);
			} else {
				columnEnds[column] = segment.endMin;
			}
			segment.column = column;
			cluster.push(segment);
			clusterEnd = Math.max(clusterEnd, segment.endMin);
		}
		closeCluster();
	}
}

function renderGrid(doc: jsPDF, options: ProgramPdfOptions) {
	const weeks: string[][] = [];
	for (let index = 0; index < options.days.length; index += 7) {
		weeks.push(options.days.slice(index, index + 7));
	}
	weeks.forEach((days, index) => {
		if (index > 0) doc.addPage("a4", "landscape");
		renderWeek(doc, days, options);
	});
}

function renderWeek(doc: jsPDF, days: string[], options: ProgramPdfOptions) {
	const pageWidth = doc.internal.pageSize.getWidth();
	const pageHeight = doc.internal.pageSize.getHeight();
	const segments = gridSegments(options.items, days);
	const hasMarker = segments.some((segment) => segment.item.in_small_groups);
	// The hours shown: from 7:00 (or earlier, for an earlier start) to 21:00 (or later). The night
	// part of an item from the evening before (a night hike until 1:30) doesn't stretch them.
	const firstHour = Math.max(
		0,
		Math.min(
			7,
			...segments
				.filter((segment) => !segment.continuesBefore)
				.map((segment) => Math.floor(segment.startMin / 60)),
		),
	);
	const lastHour = Math.min(
		24,
		Math.max(21, firstHour + 1, ...segments.map((segment) => Math.ceil(segment.endMin / 60))),
	);

	const axisWidth = 11;
	const headerHeight = 9;
	const x0 = MARGIN_X + axisWidth;
	const x1 = pageWidth - MARGIN_X;
	const gridTop = CONTENT_TOP + headerHeight;
	const gridBottom = pageHeight - CONTENT_BOTTOM - (hasMarker ? 5 : 1);
	const columnWidth = (x1 - x0) / Math.max(days.length, 1);
	const hourHeight = (gridBottom - gridTop) / (lastHour - firstHour);
	const yOf = (minutes: number) => gridTop + ((minutes - firstHour * 60) / 60) * hourHeight;

	// Segments before the first hour shown become a strip at its top (title + time).
	const firstMinute = firstHour * 60;
	const stripMinutes = Math.ceil((7.6 / hourHeight) * 60);
	for (const segment of segments) {
		if (segment.endMin <= firstMinute) {
			segment.startMin = firstMinute;
			segment.endMin = firstMinute + stripMinutes;
		} else {
			segment.startMin = Math.max(segment.startMin, firstMinute);
		}
	}
	assignLanes(segments, days.length);

	// Day headings.
	days.forEach((day, index) => {
		const center = x0 + columnWidth * (index + 0.5);
		doc.setFont("helvetica", "bold");
		doc.setFontSize(9);
		doc.setTextColor(...TEXT);
		doc.text(formatShortDay(day), center, CONTENT_TOP, { baseline: "top", align: "center" });
		doc.setFont("helvetica", "normal");
		doc.setFontSize(7);
		doc.setTextColor(...MUTED);
		doc.text(`Tag ${dayNumber(day, options.eventStart)}`, center, CONTENT_TOP + 4.2, {
			baseline: "top",
			align: "center",
		});
	});

	// Hour lines and labels, day separators.
	doc.setLineWidth(0.15);
	doc.setDrawColor(...LINE);
	doc.setFontSize(7);
	doc.setTextColor(...MUTED);
	for (let hour = firstHour; hour <= lastHour; hour++) {
		const y = yOf(hour * 60);
		doc.line(x0, y, x1, y);
		if (hour < lastHour) {
			doc.text(`${String(hour).padStart(2, "0")}:00`, x0 - 1.5, y + 0.6, {
				baseline: "top",
				align: "right",
			});
		}
	}
	for (let index = 0; index <= days.length; index++) {
		const x = x0 + columnWidth * index;
		doc.line(x, gridTop, x, gridBottom);
	}

	// Program items.
	for (const segment of segments) {
		const laneWidth = columnWidth / segment.columns;
		const x = x0 + columnWidth * segment.dayIndex + laneWidth * segment.column + 0.4;
		const width = laneWidth - 0.8;
		const top = yOf(segment.startMin) + 0.3;
		const bottom = yOf(Math.min(segment.endMin, lastHour * 60)) - 0.3;
		const height = Math.max(bottom - top, 3.2);
		const color = hexToRgb(segment.item.color);

		doc.setFillColor(...tint(color, 0.2));
		doc.rect(x, top, width, height, "F");
		doc.setFillColor(...color);
		doc.rect(x, top, 0.9, height, "F");
		if (segment.item.in_small_groups) {
			doc.setFillColor(...SMALL_GROUP_MARK);
			doc.circle(x + width - 1.4, top + 1.4, 0.8, "F");
		}

		const textX = x + 2;
		const textWidth = width - 2.8 - (segment.item.in_small_groups ? 2 : 0);
		const textBottom = top + height - 0.5;
		let lineY = top + 0.7;
		const fits = (pt: number) => lineY + lineHeight(pt) <= textBottom + 0.01;
		const linesThatFit = (pt: number) => Math.floor((textBottom - lineY) / lineHeight(pt));

		// Narrow lanes (several items side by side) get a smaller title.
		const TITLE_PT = laneWidth < 20 ? 6.5 : 7.5;
		const SMALL_PT = 6.5;
		if (textWidth < 3) continue;

		// Title first: short boxes show at least that (the position already tells the time).
		doc.setFont("helvetica", "bold");
		doc.setFontSize(TITLE_PT);
		doc.setTextColor(...TEXT);
		const titleText = pdfText(segment.item.title);
		// A word wider than the lane would be broken mid-word ("Klein / grupp / enzeit"): show one
		// line cut with "…" instead.
		const wordTooWide = titleText.split(/\s+/).some((word) => doc.getTextWidth(word) > textWidth);
		const title = clampLines(
			doc,
			titleText,
			textWidth,
			wordTooWide ? 1 : Math.max(1, Math.min(3, linesThatFit(TITLE_PT))),
		);
		doc.text(title, textX, lineY, { baseline: "top" });
		lineY += title.length * lineHeight(TITLE_PT);

		doc.setFont("helvetica", "normal");
		doc.setFontSize(SMALL_PT);
		const time = segment.continuesBefore
			? `bis ${formatTime(segment.item.end_at)}`
			: segment.continuesAfter
				? `ab ${formatTime(segment.item.start_at)}`
				: `${formatTime(segment.item.start_at)}–${formatTime(segment.item.end_at)}`;
		const details: { text: string; color: RGB }[] = [
			{
				text: [time, segment.item.location].filter(Boolean).join(" · "),
				color: MUTED,
			},
			...(segment.item.in_small_groups ? [{ text: SMALL_GROUP_LABEL, color: SMALL_GROUP_MARK }] : []),
			...(options.responsibles && segment.item.responsible.length
				? [{ text: names(segment.item), color: MUTED }]
				: []),
		];
		for (const detail of details) {
			if (!fits(SMALL_PT)) break;
			const lines = clampLines(
				doc,
				pdfText(detail.text),
				textWidth,
				Math.min(2, linesThatFit(SMALL_PT)),
			);
			doc.setTextColor(...detail.color);
			doc.text(lines, textX, lineY, { baseline: "top" });
			lineY += lines.length * lineHeight(SMALL_PT);
		}
	}

	if (hasMarker) {
		doc.setFillColor(...SMALL_GROUP_MARK);
		doc.circle(x0 + 0.8, gridBottom + 2.6, 0.8, "F");
		doc.setFont("helvetica", "normal");
		doc.setFontSize(7);
		doc.setTextColor(...MUTED);
		doc.text("findet in Kleingruppen statt", x0 + 2.6, gridBottom + 1.4, { baseline: "top" });
	}
}

// --- appendix: Kleingruppen -----------------------------------------------------------------

function renderSmallGroups(
	doc: jsPDF,
	autoTable: AutoTable,
	options: ProgramPdfOptions,
	orientation: "portrait" | "landscape",
) {
	doc.addPage("a4", orientation);
	doc.setFont("helvetica", "bold");
	doc.setFontSize(11);
	doc.setTextColor(...TEXT);
	doc.text("Kleingruppen", MARGIN_X, CONTENT_TOP, { baseline: "top" });
	doc.setFont("helvetica", "normal");
	doc.setFontSize(8.5);
	doc.setTextColor(...MUTED);
	doc.text(
		"Treffpunkt und Leitung für alle Programmpunkte „In Kleingruppen“.",
		MARGIN_X,
		CONTENT_TOP + 5.5,
		{ baseline: "top" },
	);

	const groups = [...options.smallGroups].sort((a, b) => a.name.localeCompare(b.name, "de"));
	autoTable(doc, {
		startY: CONTENT_TOP + 11,
		head: [["Kleingruppe", "Treffpunkt", "Leitung", "Teilnehmende"]],
		body: groups.map((group) => [
			pdfText(group.name),
			pdfText(group.meeting_point ?? "–"),
			pdfText(group.leaders.map((leader) => leader.display_name).join(", ") || "–"),
			String(group.participant_count),
		]),
		theme: "plain",
		margin: { left: MARGIN_X, right: MARGIN_X, top: CONTENT_TOP, bottom: CONTENT_BOTTOM },
		rowPageBreak: "avoid",
		styles: {
			font: "helvetica",
			fontSize: 9,
			textColor: TEXT,
			cellPadding: { left: 1.6, top: 1.8, right: 1.6, bottom: 1.8 },
			lineColor: LINE,
			lineWidth: { bottom: 0.2 },
			valign: "top",
		},
		headStyles: {
			fontStyle: "bold",
			fontSize: 8,
			textColor: MUTED,
			fillColor: HEAD_FILL,
			lineWidth: 0,
		},
		columnStyles: {
			0: { fontStyle: "bold", cellPadding: { left: 4.2, top: 1.8, right: 1.6, bottom: 1.8 } },
			3: { halign: "right", cellWidth: 26 },
		},
		didParseCell: (data) => {
			// The heading of the number column right-aligned like its numbers.
			if (data.section === "head" && data.column.index === 3) data.cell.styles.halign = "right";
		},
		didDrawCell: (data) => {
			if (data.section !== "body" || data.column.index !== 0) return;
			const group = groups[data.row.index];
			if (!group) return;
			doc.setFillColor(...hexToRgb(group.color ?? "#64748b"));
			doc.rect(data.cell.x + 0.6, data.cell.y + 1.8, 1, data.cell.height - 3.6, "F");
		},
	});
}

// --- entry points ---------------------------------------------------------------------------

/** The PDF as a Blob. Loads jsPDF on first use. */
export async function buildProgramPdf(options: ProgramPdfOptions): Promise<Blob> {
	const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);

	const orientation = options.layout === "grid" ? "landscape" : "portrait";
	const doc = new jsPDF({ orientation, unit: "mm", format: "a4", compress: true });
	doc.setLineHeightFactor(LINE_HEIGHT_FACTOR);
	doc.setProperties({
		title: `Programm – ${options.eventName}`,
		subject: "Programm",
		creator: options.orgName ?? "Iventworks",
	});

	const firstDay = options.days[0] ?? toDayString();
	const lastDay = options.days[options.days.length - 1] ?? firstDay;
	const range = dayBounds(firstDay);
	const rangeEnd = dayBounds(lastDay).end;
	const items = options.items.filter(
		(item) => item.end_at > range.start && item.start_at < rangeEnd,
	);
	const filtered = { ...options, items };

	if (options.layout === "grid") renderGrid(doc, filtered);
	else renderList(doc, autoTable, filtered);

	if (
		options.smallGroupAppendix &&
		options.smallGroups.length > 0 &&
		items.some((item) => item.in_small_groups)
	) {
		renderSmallGroups(doc, autoTable, filtered, orientation);
	}

	const subtitle = [
		`Programm · ${options.layout === "grid" ? "Wochenraster" : "Liste"}`,
		formatDayRange(firstDay, lastDay),
		options.onlyMine ? "nur meine Programmpunkte" : null,
	]
		.filter(Boolean)
		.join(" · ");
	drawChrome(doc, filtered, subtitle);

	if (options.autoPrint) doc.autoPrint();
	return doc.output("blob");
}

/** `programm-sommerfreizeit-2027-liste.pdf` */
export function programPdfFileName(eventName: string, layout: ProgramPdfLayout): string {
	const slug = fileSlug(eventName, "event");
	return `programm-${slug}-${layout === "grid" ? "wochenraster" : "liste"}.pdf`;
}

/**
 * Where a PDF is printed: in a hidden frame (desktop Chrome, Edge, Firefox) or in a new tab whose
 * viewer opens the print dialog itself (`autoPrint`) — Safari and mobile browsers print a PDF in a
 * frame blank or not at all. Decide before the PDF is built: the tab has to be opened while the
 * click still counts as a user gesture.
 */
export function pdfPrintTarget(): "frame" | "tab" {
	const agent = navigator.userAgent;
	const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(agent) || navigator.maxTouchPoints > 1;
	const safari = /^((?!chrome|chromium|crios|fxios|edg|android).)*safari/i.test(agent);
	return mobile || safari ? "tab" : "frame";
}

let printFrame: HTMLIFrameElement | null = null;

/** Print a PDF Blob in a hidden frame. Falls back to `onFailure` if the browser refuses. */
export function printPdfBlobInFrame(blob: Blob, onFailure: () => void) {
	printFrame?.remove();
	const url = URL.createObjectURL(blob);
	const frame = document.createElement("iframe");
	frame.setAttribute("aria-hidden", "true");
	frame.tabIndex = -1;
	frame.style.cssText =
		"position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
	frame.onload = () => {
		// The PDF viewer needs a moment after `load` before it can print.
		setTimeout(() => {
			try {
				frame.contentWindow?.focus();
				frame.contentWindow?.print();
			} catch {
				onFailure();
			}
		}, 250);
	};
	frame.src = url;
	document.body.appendChild(frame);
	printFrame = frame;
	// The print dialog may stay open a while; clean up much later (or at the next print).
	setTimeout(() => {
		frame.remove();
		if (printFrame === frame) printFrame = null;
		URL.revokeObjectURL(url);
	}, 10 * 60_000);
}
