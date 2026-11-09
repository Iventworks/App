import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";

/** One file of an archive: in memory (manifest) or on disk (database snapshot, uploads). */
export type TarEntry =
	| { readonly name: string; readonly data: Uint8Array; readonly mtime?: number }
	| { readonly name: string; readonly path: string; readonly size: number; readonly mtime?: number };

const BLOCK = 512;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function writeString(header: Uint8Array, value: string, offset: number, length: number) {
	const bytes = encoder.encode(value);
	if (bytes.length > length) throw new Error(`Tar header field too long: ${value}`);
	header.set(bytes, offset);
}

function writeOctal(header: Uint8Array, value: number, offset: number, length: number) {
	// `length - 1` octal digits plus a NUL terminator.
	writeString(header, value.toString(8).padStart(length - 1, "0"), offset, length - 1);
}

/** POSIX ustar header; names up to 255 bytes via the prefix field. */
function header(name: string, size: number, mtime: number): Uint8Array {
	const block = new Uint8Array(BLOCK);
	let prefix = "";
	let base = name;
	if (encoder.encode(name).length > 100) {
		const cut = name.lastIndexOf("/", 155);
		if (cut <= 0 || encoder.encode(name.slice(cut + 1)).length > 100) {
			throw new Error(`Path too long for the backup archive: ${name}`);
		}
		prefix = name.slice(0, cut);
		base = name.slice(cut + 1);
	}

	writeString(block, base, 0, 100);
	writeOctal(block, 0o644, 100, 8);
	writeOctal(block, 0, 108, 8);
	writeOctal(block, 0, 116, 8);
	writeOctal(block, size, 124, 12);
	writeOctal(block, Math.floor(mtime / 1000), 136, 12);
	block.fill(0x20, 148, 156); // checksum placeholder: spaces
	block[156] = 0x30; // "0": regular file
	writeString(block, "ustar", 257, 6);
	writeString(block, "00", 263, 2);
	writeString(block, prefix, 345, 155);

	let checksum = 0;
	for (const byte of block) checksum += byte;
	writeString(block, `${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
	return block;
}

function padding(size: number): Uint8Array {
	const rest = size % BLOCK;
	return new Uint8Array(rest === 0 ? 0 : BLOCK - rest);
}

/**
 * A tar archive as a stream of chunks — files are read while the archive is written, so the
 * uploads directory never has to fit into memory.
 */
export async function* tarStream(entries: Iterable<TarEntry> | AsyncIterable<TarEntry>) {
	for await (const entry of entries) {
		const mtime = entry.mtime ?? Date.now();
		if ("data" in entry) {
			yield header(entry.name, entry.data.byteLength, mtime);
			yield entry.data;
			yield padding(entry.data.byteLength);
			continue;
		}

		yield header(entry.name, entry.size, mtime);
		let written = 0;
		for await (const chunk of Bun.file(entry.path).stream()) {
			// A file that grew while archiving: only what the header promised.
			const part =
				written + chunk.byteLength > entry.size ? chunk.subarray(0, entry.size - written) : chunk;
			written += part.byteLength;
			yield part;
			if (written >= entry.size) break;
		}
		if (written < entry.size) {
			// A file that shrank: keep the archive consistent.
			yield new Uint8Array(entry.size - written);
		}
		yield padding(entry.size);
	}
	yield new Uint8Array(BLOCK * 2);
}

function readString(block: Uint8Array, offset: number, length: number) {
	const field = block.subarray(offset, offset + length);
	const end = field.indexOf(0);
	return decoder.decode(end === -1 ? field : field.subarray(0, end));
}

/** Where `name` lands under `targetDir`; refuses absolute paths and `..` (path traversal). */
function safeTarget(targetDir: string, name: string) {
	const relative = normalize(name);
	if (isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) {
		throw new Error(`Refusing unsafe path in backup archive: ${name}`);
	}
	const target = join(targetDir, relative);
	if (!target.startsWith(normalize(targetDir) + sep) && target !== normalize(targetDir)) {
		throw new Error(`Refusing unsafe path in backup archive: ${name}`);
	}
	return target;
}

/**
 * Extract a tar stream (as written by {@link tarStream}) into `targetDir`. Only regular files;
 * returns their names, and the contents of the (small) files named in `capture`. With
 * `targetDir = null` the archive is only read (verification).
 */
export async function extractTar(
	chunks: AsyncIterable<Uint8Array>,
	targetDir: string | null,
	capture: readonly string[] = [],
): Promise<{ names: string[]; captured: Map<string, Uint8Array> }> {
	const names: string[] = [];
	const captured = new Map<string, Uint8Array>();
	let buffer = new Uint8Array(0);
	let current: {
		name: string;
		remaining: number;
		padding: number;
		out: ReturnType<typeof createWriteStream> | null;
		parts: Uint8Array[] | null;
	} | null = null;
	let finished = false;

	const append = (chunk: Uint8Array) => {
		const next = new Uint8Array(buffer.length + chunk.length);
		next.set(buffer);
		next.set(chunk, buffer.length);
		buffer = next;
	};

	const endFile = async (out: ReturnType<typeof createWriteStream> | null) => {
		if (!out) return;
		await new Promise<void>((resolve, reject) =>
			out.end((error?: Error | null) => (error ? reject(error) : resolve())),
		);
	};

	for await (const chunk of chunks) {
		if (finished) continue;
		append(chunk);

		for (;;) {
			if (current) {
				if (current.remaining > 0) {
					if (buffer.length === 0) break;
					const take = Math.min(current.remaining, buffer.length);
					const part = buffer.subarray(0, take);
					current.parts?.push(part.slice());
					if (current.out && !current.out.write(part)) {
						await new Promise((resolve) => current!.out!.once("drain", resolve));
					}
					current.remaining -= take;
					buffer = buffer.slice(take);
					continue;
				}
				if (buffer.length < current.padding) break;
				buffer = buffer.slice(current.padding);
				await endFile(current.out);
				if (current.parts) captured.set(current.name, concat(current.parts));
				current = null;
				continue;
			}

			if (buffer.length < BLOCK) break;
			const block = buffer.subarray(0, BLOCK);
			if (block.every((byte) => byte === 0)) {
				finished = true;
				break;
			}

			const name = readString(block, 0, 100);
			const prefix = readString(block, 345, 155);
			const fullName = prefix ? `${prefix}/${name}` : name;
			const size = Number.parseInt(readString(block, 124, 12).trim() || "0", 8);
			const type = String.fromCharCode(block[156] ?? 0x30);
			buffer = buffer.slice(BLOCK);

			let out: ReturnType<typeof createWriteStream> | null = null;
			if (type === "0" || type === "\0") {
				names.push(fullName);
				if (targetDir) {
					const target = safeTarget(targetDir, fullName);
					await mkdir(dirname(target), { recursive: true });
					out = createWriteStream(target);
				}
			}
			const keep = capture.includes(fullName) && size <= 1024 * 1024;
			current = {
				name: fullName,
				remaining: size,
				padding: (BLOCK - (size % BLOCK)) % BLOCK,
				out,
				parts: keep ? [] : null,
			};
		}
	}

	if (current) throw new Error("The backup archive ends in the middle of a file");
	if (!finished) throw new Error("The backup archive has no end marker");
	return { names, captured };
}

function concat(parts: Uint8Array[]) {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}
