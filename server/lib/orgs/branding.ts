import { and, eq } from "drizzle-orm";
import { DB } from "../db";
import type { ORG_ASSET_KINDS } from "../db/schema";
import { inOrg, OrgContext } from "./context";
import { OrgRegistry } from "./registry";

export type OrgAssetKind = (typeof ORG_ASSET_KINDS)[number];

export class BrandingError extends Error {
	constructor(
		readonly code: "too_large" | "unsupported_type" | "unsafe_svg" | "icon_size",
		message: string,
	) {
		super(message);
		this.name = "BrandingError";
	}
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The org's logo and icon. The type is taken from the bytes, never from the client. SVGs are
 * stored only when they contain no script, event handlers, `javascript:` URLs or external
 * references, and are served with a sandbox CSP on top (see the instance routes).
 */
export class OrgBranding {
	static readonly MAX_ASSET_BYTES = 512 * 1024;

	/** Minimum edge of a PNG icon: Chrome needs 144 px for install, 192 px looks right on Android. */
	static readonly MIN_ICON_PX = 192;

	static readonly TYPES: Record<OrgAssetKind, readonly string[]> = {
		logo: ["image/svg+xml", "image/png", "image/webp", "image/jpeg"],
		icon: ["image/svg+xml", "image/png"],
	};

	/** Store (or replace) the current org's `kind` asset. */
	static async set(kind: OrgAssetKind, bytes: Uint8Array) {
		if (bytes.byteLength > OrgBranding.MAX_ASSET_BYTES) {
			throw new BrandingError(
				"too_large",
				`The image may be at most ${OrgBranding.MAX_ASSET_BYTES / 1024} KB`,
			);
		}

		const mimeType = OrgBranding.sniff(bytes);
		if (!mimeType || !OrgBranding.TYPES[kind].includes(mimeType)) {
			throw new BrandingError(
				"unsupported_type",
				kind === "icon"
					? "The icon must be an SVG or PNG file"
					: "The logo must be an SVG, PNG, WebP or JPEG file",
			);
		}

		if (mimeType === "image/svg+xml") OrgBranding.assertSafeSvg(bytes);

		let sizePx: number | null = null;
		if (kind === "icon" && mimeType === "image/png") {
			const { width, height } = OrgBranding.pngSize(bytes);
			if (width !== height || width < OrgBranding.MIN_ICON_PX) {
				throw new BrandingError(
					"icon_size",
					`The icon must be square and at least ${OrgBranding.MIN_ICON_PX}×${OrgBranding.MIN_ICON_PX} px`,
				);
			}
			sizePx = width;
		}

		const updatedAt = Date.now();
		await DB.instance()
			.insert(DB.Tables.orgAssets)
			.values({
				org_id: OrgContext.id(),
				kind,
				mime_type: mimeType,
				data: Buffer.from(bytes),
				size_px: sizePx,
				updated_at: updatedAt,
			})
			.onConflictDoUpdate({
				target: [DB.Tables.orgAssets.org_id, DB.Tables.orgAssets.kind],
				set: { mime_type: mimeType, data: Buffer.from(bytes), size_px: sizePx, updated_at: updatedAt },
			})
			.run();
		await OrgRegistry.reload();
	}

	static async remove(kind: OrgAssetKind) {
		await DB.instance()
			.delete(DB.Tables.orgAssets)
			.where(and(inOrg(DB.Tables.orgAssets), eq(DB.Tables.orgAssets.kind, kind)))
			.run();
		await OrgRegistry.reload();
	}

	static async get(kind: OrgAssetKind) {
		return await DB.instance()
			.select()
			.from(DB.Tables.orgAssets)
			.where(and(inOrg(DB.Tables.orgAssets), eq(DB.Tables.orgAssets.kind, kind)))
			.get();
	}

	/** The real image type from the first bytes, or null. */
	static sniff(bytes: Uint8Array): string | null {
		if (PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return "image/png";
		if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
		const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
		if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";

		const head = new TextDecoder().decode(bytes.subarray(0, 1024)).replace(/^﻿/, "").trimStart();
		if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) {
			return "image/svg+xml";
		}
		return null;
	}

	private static assertSafeSvg(bytes: Uint8Array) {
		const text = new TextDecoder().decode(bytes);
		const unsafe = [
			/<script[\s>]/i,
			/<foreignObject[\s>]/i,
			/\son[a-z]+\s*=/i,
			/javascript:/i,
			/<!ENTITY/i,
			// External references (images, fonts, styles) would leak the viewer's address.
			/(?:href|src)\s*=\s*["']\s*(?!#|data:image\/)/i,
			/@import/i,
			/url\(\s*["']?\s*(?!#|data:image\/)/i,
		];
		if (unsafe.some((pattern) => pattern.test(text))) {
			throw new BrandingError(
				"unsafe_svg",
				"The SVG contains scripts, event handlers or external references",
			);
		}
	}

	/** Width and height from a PNG's IHDR chunk. */
	static pngSize(bytes: Uint8Array): { width: number; height: number } {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		if (bytes.byteLength < 24) return { width: 0, height: 0 };
		return { width: view.getUint32(16), height: view.getUint32(20) };
	}
}
