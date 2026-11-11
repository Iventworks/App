/** Helpers for the chat: emoji sets, link detection, previews and per-person name colours. */

/** The reactions offered first; the picker has the rest. */
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;

function emojiList(...rows: string[]) {
	return rows.flatMap((row) => row.split(" "));
}

export const EMOJI_GROUPS: { label: string; icon: string; emojis: string[] }[] = [
	{
		label: "Smileys",
		icon: "i-lucide-smile",
		emojis: emojiList(
			"😀 😃 😄 😁 😆 😅 😂 🤣 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 🤗 🤭 🤫 🤔 🤨 😐 😑 😶 🙄",
			"😏 😬 😌 😴 🤒 🤕 🥵 🥶 🥳 😎 🤓 😕 😟 🙁 😮 😯 😲 😳 🥺 😢 😭 😱 😤 😡 🤯 😈 💀 🤡 👻 🙈",
		),
	},
	{
		label: "Gesten",
		icon: "i-lucide-hand",
		emojis: emojiList(
			"👍 👎 👌 ✌️ 🤞 🤟 🤙 👈 👉 👆 👇 ☝️ ✋ 🖐️ 👋",
			"👏 🙌 🤝 🙏 💪 ✍️ 🤷 🤦 🙋 🙆 🙅 💁 🫶 🫡 👀",
		),
	},
	{
		label: "Herzen & Symbole",
		icon: "i-lucide-heart",
		emojis: emojiList(
			"❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💖 💯 ✅ ❌ ❗",
			"❓ ⚠️ 🔥 ✨ ⭐ 🌟 💡 📌 📎 🔔 ⏰ 📅 📍 🔒 🆗",
		),
	},
	{
		label: "Feiern & Freizeit",
		icon: "i-lucide-party-popper",
		emojis: emojiList(
			"🎉 🎊 🎈 🎁 🎂 🏆 🥇 🎯 🎵 🎶 🎤 🎸 🥁 🎬 🎮",
			"🎲 ⚽ 🏀 🏐 🏓 🏕️ ⛺ 🔦 🧭 🎒 🚌 🚗 🚲 ✈️ 🏠",
		),
	},
	{
		label: "Essen & Natur",
		icon: "i-lucide-leaf",
		emojis: emojiList(
			"☕ 🍵 🥤 🍺 🍕 🍔 🌭 🍟 🥗 🍝 🍞 🥨 🧀 🍎 🍌",
			"🍓 🍰 🍪 🍫 🍿 ☀️ 🌤️ ⛅ 🌧️ ⛈️ ❄️ 🌈 🌙 🌲 🌻",
		),
	},
];

export type TextPart =
	| { type: "text"; text: string }
	| { type: "link"; text: string; href: string }
	| { type: "mark"; text: string };

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

/**
 * Split a message into plain text and links (http/https only), so links render as real anchors
 * without `v-html`. Trailing punctuation stays outside the link.
 */
export function linkify(text: string): TextPart[] {
	const parts: TextPart[] = [];
	let last = 0;
	for (const match of text.matchAll(URL_PATTERN)) {
		let url = match[0];
		// "…(see https://example.org)." — closing punctuation belongs to the sentence.
		const trailing = url.match(/[.,;:!?)\]}]+$/)?.[0] ?? "";
		if (trailing) url = url.slice(0, -trailing.length);
		if (!url) continue;

		const start = match.index;
		if (start > last) parts.push({ type: "text", text: text.slice(last, start) });
		parts.push({ type: "link", text: url, href: url.startsWith("www.") ? `https://${url}` : url });
		last = start + url.length;
	}
	if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
	return parts;
}

/** Split `text` around occurrences of `term` (case-insensitive) to highlight search hits. */
export function highlightTerm(text: string, term: string): TextPart[] {
	const needle = term.trim().toLowerCase();
	if (!needle) return [{ type: "text", text }];
	const parts: TextPart[] = [];
	const haystack = text.toLowerCase();
	let last = 0;
	for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, last)) {
		if (at > last) parts.push({ type: "text", text: text.slice(last, at) });
		parts.push({ type: "mark", text: text.slice(at, at + needle.length) });
		last = at + needle.length;
	}
	if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
	return parts;
}

/** A short excerpt of `text` around the first occurrence of `term`. */
export function excerptAround(text: string, term: string, radius = 60): string {
	const at = text.toLowerCase().indexOf(term.trim().toLowerCase());
	if (at <= radius) return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
	const end = Math.min(text.length, at + radius);
	return `…${text.slice(at - radius, end)}${end < text.length ? "…" : ""}`;
}

/** What a message without text shows as in previews: "Foto", "3 Fotos", the file name, … */
export function attachmentLabel(count: number, name: string | null | undefined, isImage: boolean) {
	if (count <= 0) return "";
	if (isImage) return count === 1 ? "Foto" : `${count} Fotos`;
	return count === 1 ? (name ?? "Datei") : `${count} Dateien`;
}

// Static class names so Tailwind picks them up.
const SENDER_COLORS = [
	"text-sky-300",
	"text-emerald-300",
	"text-amber-300",
	"text-rose-300",
	"text-violet-300",
	"text-teal-300",
	"text-orange-300",
	"text-pink-300",
	"text-lime-300",
	"text-cyan-300",
];

/** A stable colour per person for their name in group chats. */
export function senderColor(userId: number | null | undefined) {
	if (!userId) return "text-slate-300";
	return SENDER_COLORS[userId % SENDER_COLORS.length] as string;
}
