/**
 * Empty office documents for "Neu → Textdokument / Tabelle / Präsentation": the smallest valid
 * OOXML packages (Word A4 page, one empty sheet, one blank 16:9 slide), zipped here without
 * compression — no template files, no zip library.
 */
export namespace OfficeTemplates {
	export const TYPES = ["docx", "xlsx", "pptx"] as const;
	export type Type = (typeof TYPES)[number];

	export const MIME_TYPES: Record<Type, string> = {
		docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	};

	const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
	const NS = {
		types: "http://schemas.openxmlformats.org/package/2006/content-types",
		rels: "http://schemas.openxmlformats.org/package/2006/relationships",
		r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
		w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
		s: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
		a: "http://schemas.openxmlformats.org/drawingml/2006/main",
		p: "http://schemas.openxmlformats.org/presentationml/2006/main",
	};
	const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

	function contentTypes(overrides: [string, string][]) {
		return `${XML}<Types xmlns="${NS.types}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides
			.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`)
			.join("")}</Types>`;
	}

	function relationships(entries: [string, string, string][]) {
		return `${XML}<Relationships xmlns="${NS.rels}">${entries
			.map(
				([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`,
			)
			.join("")}</Relationships>`;
	}

	const EMPTY_TREE =
		'<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>';
	const P_NS = `xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"`;

	function theme() {
		const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
		const colors: [string, string][] = [
			["dk2", "44546A"],
			["lt2", "E7E6E6"],
			["accent1", "4472C4"],
			["accent2", "ED7D31"],
			["accent3", "A5A5A5"],
			["accent4", "FFC000"],
			["accent5", "5B9BD5"],
			["accent6", "70AD47"],
			["hlink", "0563C1"],
			["folHlink", "954F72"],
		];
		return `${XML}<a:theme xmlns:a="${NS.a}" name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>${colors
			.map(([name, value]) => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`)
			.join(
				"",
			)}</a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst>${solid}${solid}${solid}</a:fillStyleLst><a:lnStyleLst><a:ln w="6350">${solid}</a:ln><a:ln w="12700">${solid}</a:ln><a:ln w="19050">${solid}</a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${solid}${solid}${solid}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
	}

	/** The parts of an empty document, in zip order. */
	export function parts(type: Type): [string, string][] {
		switch (type) {
			case "docx":
				return [
					[
						"[Content_Types].xml",
						contentTypes([
							[
								"/word/document.xml",
								"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
							],
						]),
					],
					["_rels/.rels", relationships([["rId1", "officeDocument", "word/document.xml"]])],
					[
						"word/document.xml",
						`${XML}<w:document xmlns:w="${NS.w}"><w:body><w:p/><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
					],
				];
			case "xlsx":
				return [
					[
						"[Content_Types].xml",
						contentTypes([
							[
								"/xl/workbook.xml",
								"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
							],
							[
								"/xl/worksheets/sheet1.xml",
								"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
							],
						]),
					],
					["_rels/.rels", relationships([["rId1", "officeDocument", "xl/workbook.xml"]])],
					[
						"xl/workbook.xml",
						`${XML}<workbook xmlns="${NS.s}" xmlns:r="${NS.r}"><sheets><sheet name="Tabelle1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
					],
					[
						"xl/_rels/workbook.xml.rels",
						relationships([["rId1", "worksheet", "worksheets/sheet1.xml"]]),
					],
					["xl/worksheets/sheet1.xml", `${XML}<worksheet xmlns="${NS.s}"><sheetData/></worksheet>`],
				];
			case "pptx":
				return [
					[
						"[Content_Types].xml",
						contentTypes([
							[
								"/ppt/presentation.xml",
								"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
							],
							[
								"/ppt/slideMasters/slideMaster1.xml",
								"application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml",
							],
							[
								"/ppt/slideLayouts/slideLayout1.xml",
								"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml",
							],
							[
								"/ppt/slides/slide1.xml",
								"application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
							],
							["/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"],
						]),
					],
					["_rels/.rels", relationships([["rId1", "officeDocument", "ppt/presentation.xml"]])],
					[
						"ppt/presentation.xml",
						`${XML}<p:presentation ${P_NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
					],
					[
						"ppt/_rels/presentation.xml.rels",
						relationships([
							["rId1", "slideMaster", "slideMasters/slideMaster1.xml"],
							["rId2", "slide", "slides/slide1.xml"],
							["rId3", "theme", "theme/theme1.xml"],
						]),
					],
					[
						"ppt/slideMasters/slideMaster1.xml",
						`${XML}<p:sldMaster ${P_NS}>${EMPTY_TREE}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
					],
					[
						"ppt/slideMasters/_rels/slideMaster1.xml.rels",
						relationships([
							["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
							["rId2", "theme", "../theme/theme1.xml"],
						]),
					],
					[
						"ppt/slideLayouts/slideLayout1.xml",
						`${XML}<p:sldLayout ${P_NS} type="blank" preserve="1">${EMPTY_TREE.replace("<p:cSld>", '<p:cSld name="Leer">')}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
					],
					[
						"ppt/slideLayouts/_rels/slideLayout1.xml.rels",
						relationships([["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"]]),
					],
					[
						"ppt/slides/slide1.xml",
						`${XML}<p:sld ${P_NS}>${EMPTY_TREE}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
					],
					[
						"ppt/slides/_rels/slide1.xml.rels",
						relationships([["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"]]),
					],
					["ppt/theme/theme1.xml", theme()],
				];
		}
	}

	// --- zip (stored, no compression) ---------------------------------------------------------------

	const CRC_TABLE = (() => {
		const table = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			table[n] = c >>> 0;
		}
		return table;
	})();

	export function crc32(data: Uint8Array) {
		let crc = 0xffffffff;
		for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
		return (crc ^ 0xffffffff) >>> 0;
	}

	/** A zip archive of `files`, stored without compression (1980-01-01 as their date). */
	export function zip(files: [string, string | Uint8Array][]): Uint8Array<ArrayBuffer> {
		const encoder = new TextEncoder();
		const local: Uint8Array[] = [];
		const central: Uint8Array[] = [];
		let offset = 0;
		const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01

		for (const [name, content] of files) {
			const nameBytes = encoder.encode(name);
			const data = typeof content === "string" ? encoder.encode(content) : content;
			const crc = crc32(data);

			const header = new DataView(new ArrayBuffer(30));
			header.setUint32(0, 0x04034b50, true);
			header.setUint16(4, 20, true);
			header.setUint16(6, 0x0800, true); // UTF-8 names
			header.setUint16(8, 0, true); // stored
			header.setUint16(10, 0, true);
			header.setUint16(12, DOS_DATE, true);
			header.setUint32(14, crc, true);
			header.setUint32(18, data.length, true);
			header.setUint32(22, data.length, true);
			header.setUint16(26, nameBytes.length, true);
			header.setUint16(28, 0, true);
			local.push(new Uint8Array(header.buffer), nameBytes, data);

			const entry = new DataView(new ArrayBuffer(46));
			entry.setUint32(0, 0x02014b50, true);
			entry.setUint16(4, 20, true);
			entry.setUint16(6, 20, true);
			entry.setUint16(8, 0x0800, true);
			entry.setUint16(10, 0, true);
			entry.setUint16(12, 0, true);
			entry.setUint16(14, DOS_DATE, true);
			entry.setUint32(16, crc, true);
			entry.setUint32(20, data.length, true);
			entry.setUint32(24, data.length, true);
			entry.setUint16(28, nameBytes.length, true);
			entry.setUint32(42, offset, true);
			central.push(new Uint8Array(entry.buffer), nameBytes);

			offset += 30 + nameBytes.length + data.length;
		}

		const centralSize = central.reduce((sum, part) => sum + part.length, 0);
		const end = new DataView(new ArrayBuffer(22));
		end.setUint32(0, 0x06054b50, true);
		end.setUint16(8, files.length, true);
		end.setUint16(10, files.length, true);
		end.setUint32(12, centralSize, true);
		end.setUint32(16, offset, true);

		const parts = [...local, ...central, new Uint8Array(end.buffer)];
		const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
		let position = 0;
		for (const part of parts) {
			result.set(part, position);
			position += part.length;
		}
		return result;
	}

	/** An empty document of `type`. */
	export function blank(type: Type) {
		return zip(parts(type));
	}
}
