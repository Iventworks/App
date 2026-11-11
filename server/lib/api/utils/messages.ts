import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { DB } from "../../db";
import type { DrizzleDB } from "../../db/utils";
import { inOrg, OrgContext } from "../../orgs/context";
import { FileStorage } from "../../utils/fileStorage";
import { FileService } from "./fileService";
import { UserSummary } from "./shared-models/userSummary";

function unique<T>(values: Iterable<T | null | undefined>): T[] {
	return [...new Set(values)].filter((value): value is T => value !== null && value !== undefined);
}

/**
 * Chat messages beyond plain text: attachments (rows of `files` with `scope = message`), emoji
 * reactions, replies and pinned messages. Every change to a message bumps its `updated_at`, which
 * is what `/messages/sync` reports to the other people in the chat.
 */
export class MessageService {
	/** Files per message. */
	static readonly MAX_ATTACHMENTS = 10;
	/** Uploads a person may have waiting (uploaded, not sent yet) per chat. */
	static readonly MAX_PENDING_UPLOADS = 30;
	/** Different emoji on one message. */
	static readonly MAX_REACTION_EMOJIS = 20;
	/** Pinned messages per chat. */
	static readonly MAX_PINNED = 50;
	static readonly PREVIEW_LENGTH = 200;

	static isImage(file: Pick<DB.Models.File, "mime_type">) {
		return (
			FileService.isInlineSafe(file.mime_type) &&
			Boolean(file.mime_type?.toLowerCase().startsWith("image/"))
		);
	}

	static toAttachment(file: DB.Models.File): MessageService.Attachment {
		return {
			id: file.id,
			name: file.name,
			mime_type: file.mime_type,
			size: file.size,
			content_url: FileService.contentPath(file),
			is_image: MessageService.isImage(file),
		};
	}

	static preview(content: string) {
		return content.length > MessageService.PREVIEW_LENGTH
			? `${content.slice(0, MessageService.PREVIEW_LENGTH - 1)}…`
			: content;
	}

	/** Messages as the caller sees them, with attachments, reactions and the quoted message. */
	static async toResponse(
		messages: DB.Models.Message[],
		userId: number,
	): Promise<MessageService.Message[]> {
		if (messages.length === 0) return [];
		const db = DB.instance();
		const ids = messages.map((message) => message.id);

		const files = await db
			.select()
			.from(DB.Tables.files)
			.where(and(inOrg(DB.Tables.files), inArray(DB.Tables.files.message_id, ids)))
			.orderBy(asc(DB.Tables.files.id))
			.all();

		const reactions = await db
			.select()
			.from(DB.Tables.messageReactions)
			.where(
				and(inOrg(DB.Tables.messageReactions), inArray(DB.Tables.messageReactions.message_id, ids)),
			)
			.orderBy(asc(DB.Tables.messageReactions.created_at))
			.all();

		const replyIds = unique(messages.map((message) => message.reply_to_id));
		const replied = replyIds.length
			? await db
					.select()
					.from(DB.Tables.messages)
					.where(and(inOrg(DB.Tables.messages), inArray(DB.Tables.messages.id, replyIds)))
					.all()
			: [];
		const repliedAttachments = replyIds.length
			? await db
					.select({ message_id: DB.Tables.files.message_id, value: count() })
					.from(DB.Tables.files)
					.where(and(inOrg(DB.Tables.files), inArray(DB.Tables.files.message_id, replyIds)))
					.groupBy(DB.Tables.files.message_id)
					.all()
			: [];

		const users = await UserSummary.fetchMap([
			...messages.map((message) => message.sender_id),
			...messages.map((message) => message.pinned_by),
			...reactions.map((reaction) => reaction.user_id),
			...replied.map((message) => message.sender_id),
		]);

		return messages.map((message): MessageService.Message => {
			const original = message.reply_to_id
				? replied.find((entry) => entry.id === message.reply_to_id)
				: undefined;

			// One entry per emoji, in the order the emoji first appeared on the message.
			const byEmoji = new Map<string, MessageService.Reaction>();
			for (const reaction of reactions) {
				if (reaction.message_id !== message.id) continue;
				const entry = byEmoji.get(reaction.emoji) ?? {
					emoji: reaction.emoji,
					count: 0,
					reacted_by_me: false,
					users: [],
				};
				entry.count++;
				if (reaction.user_id === userId) entry.reacted_by_me = true;
				const user = users.get(reaction.user_id);
				if (user) entry.users.push({ id: user.id, display_name: user.display_name });
				byEmoji.set(reaction.emoji, entry);
			}

			const pinnedBy = message.pinned_by ? users.get(message.pinned_by) : undefined;

			return {
				id: message.id,
				conversation_id: message.conversation_id,
				content: message.content,
				created_at: message.created_at,
				edited_at: message.edited_at,
				sender: message.sender_id ? (users.get(message.sender_id) ?? null) : null,
				is_own: message.sender_id === userId,
				reply_to: original
					? {
							id: original.id,
							content: MessageService.preview(original.content),
							sender_name: original.sender_id
								? (users.get(original.sender_id)?.display_name ?? null)
								: null,
							is_deleted: original.deleted_at !== null,
							attachment_count:
								repliedAttachments.find((entry) => entry.message_id === original.id)?.value ?? 0,
						}
					: null,
				attachments: files
					.filter((file) => file.message_id === message.id)
					.map((file) => MessageService.toAttachment(file)),
				reactions: [...byEmoji.values()],
				pinned_at: message.pinned_at,
				pinned_by: pinnedBy ? { id: pinnedBy.id, display_name: pinnedBy.display_name } : null,
			};
		});
	}

	/** A message of a chat that has not been deleted, or null. */
	static async find(conversationId: number, messageId: number) {
		return (
			(await DB.instance()
				.select()
				.from(DB.Tables.messages)
				.where(
					and(
						inOrg(DB.Tables.messages),
						eq(DB.Tables.messages.id, messageId),
						eq(DB.Tables.messages.conversation_id, conversationId),
						isNull(DB.Tables.messages.deleted_at),
					),
				)
				.get()) ?? null
		);
	}

	// --- attachments ---------------------------------------------------------------------------

	/** Uploads of `userId` in a chat that are not part of a message yet. */
	static async pendingUploads(
		conversationId: number,
		userId: number,
		tx: DrizzleDB = DB.instance(),
	) {
		return await tx
			.select()
			.from(DB.Tables.files)
			.where(
				and(
					inOrg(DB.Tables.files),
					eq(DB.Tables.files.scope, "message"),
					eq(DB.Tables.files.conversation_id, conversationId),
					eq(DB.Tables.files.uploaded_by, userId),
					isNull(DB.Tables.files.message_id),
				),
			)
			.orderBy(asc(DB.Tables.files.id))
			.all();
	}

	/** Store an upload for a chat. Returns null when the file is too large. */
	static async upload(conversationId: number, file: File, userId: number) {
		if (file.size > FileStorage.maxUploadBytes) return null;

		const { storageKey, size } = await FileStorage.save(file);
		try {
			return await DB.instance()
				.insert(DB.Tables.files)
				.values({
					org_id: OrgContext.id(),
					scope: "message",
					conversation_id: conversationId,
					kind: "file",
					name: FileService.sanitizeName(file.name || "Datei"),
					mime_type: file.type || "application/octet-stream",
					size,
					storage_key: storageKey,
					uploaded_by: userId,
				})
				.returning()
				.get();
		} catch (error) {
			await FileStorage.remove([storageKey]);
			throw error;
		}
	}

	/** Delete attachment rows and their blobs. */
	static async removeFiles(files: DB.Models.File[], tx: DrizzleDB = DB.instance()) {
		if (files.length === 0) return;
		await tx
			.delete(DB.Tables.files)
			.where(
				and(
					inOrg(DB.Tables.files),
					inArray(
						DB.Tables.files.id,
						files.map((file) => file.id),
					),
				),
			)
			.run();
		await FileStorage.remove(files.map((file) => file.storage_key));
	}

	/** Everything attached to a message (for deleting it). */
	static async attachmentsOf(messageId: number, tx: DrizzleDB = DB.instance()) {
		return await tx
			.select()
			.from(DB.Tables.files)
			.where(and(inOrg(DB.Tables.files), eq(DB.Tables.files.message_id, messageId)))
			.all();
	}

	// --- pins ----------------------------------------------------------------------------------

	static async pinnedIds(conversationId: number) {
		const rows = await DB.instance()
			.select({ id: DB.Tables.messages.id })
			.from(DB.Tables.messages)
			.where(
				and(
					inOrg(DB.Tables.messages),
					eq(DB.Tables.messages.conversation_id, conversationId),
					isNotNull(DB.Tables.messages.pinned_at),
					isNull(DB.Tables.messages.deleted_at),
				),
			)
			.all();
		return rows.map((row) => row.id);
	}

	/** Pinned messages, the latest pin first. */
	static async pinned(conversationId: number) {
		return await DB.instance()
			.select()
			.from(DB.Tables.messages)
			.where(
				and(
					inOrg(DB.Tables.messages),
					eq(DB.Tables.messages.conversation_id, conversationId),
					isNotNull(DB.Tables.messages.pinned_at),
					isNull(DB.Tables.messages.deleted_at),
				),
			)
			.orderBy(desc(DB.Tables.messages.pinned_at))
			.all();
	}

	// --- search --------------------------------------------------------------------------------

	/**
	 * Messages in the given chats whose text or attachment names contain `term`, newest first.
	 * `before` pages further back.
	 */
	static async search(
		conversationIds: number[],
		term: string,
		options: { limit: number; before?: number },
	): Promise<DB.Models.Message[]> {
		if (conversationIds.length === 0) return [];
		const db = DB.instance();
		const pattern = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

		// Attachment names first: a subquery would need its own org filter for the tenant guard.
		const byFileName = unique(
			(
				await db
					.select({ message_id: DB.Tables.files.message_id })
					.from(DB.Tables.files)
					.where(
						and(
							inOrg(DB.Tables.files),
							eq(DB.Tables.files.scope, "message"),
							inArray(DB.Tables.files.conversation_id, conversationIds),
							isNotNull(DB.Tables.files.message_id),
							sql`${DB.Tables.files.name} LIKE ${pattern} ESCAPE '\\'`,
						),
					)
					.orderBy(desc(DB.Tables.files.id))
					.limit(500)
					.all()
			).map((row) => row.message_id),
		);

		const table = DB.Tables.messages;
		const textMatch = sql`${table.content} LIKE ${pattern} ESCAPE '\\'`;

		return await db
			.select()
			.from(table)
			.where(
				and(
					inOrg(table),
					inArray(table.conversation_id, conversationIds),
					isNull(table.deleted_at),
					options.before !== undefined ? lt(table.id, options.before) : undefined,
					byFileName.length ? or(textMatch, inArray(table.id, byFileName)) : textMatch,
				),
			)
			.orderBy(desc(table.id))
			.limit(options.limit)
			.all();
	}
}

export namespace MessageService {
	export const AttachmentSchema = z.object({
		id: z.number(),
		name: z.string(),
		mime_type: z.string().nullable(),
		size: z.number(),
		/** `GET` path of the contents (the session cookie authenticates it; `?download=1` downloads). */
		content_url: z.string(),
		/** An image the browser can show inline (a preview); everything else is a download. */
		is_image: z.boolean(),
	});
	export type Attachment = z.infer<typeof AttachmentSchema>;

	export const ReactionSchema = z.object({
		emoji: z.string(),
		count: z.number(),
		reacted_by_me: z.boolean(),
		users: z.array(z.object({ id: z.number(), display_name: z.string() })),
	});
	export type Reaction = z.infer<typeof ReactionSchema>;

	export const MessageSchema = z.object({
		id: z.number(),
		conversation_id: z.number(),
		/** Empty when the message only carries attachments. */
		content: z.string(),
		created_at: z.number(),
		edited_at: z.number().nullable(),
		/** Null when the sender's account was deleted. */
		sender: UserSummary.Schema.nullable(),
		is_own: z.boolean(),
		/** The message this one answers; `is_deleted` when it has been deleted since. */
		reply_to: z
			.object({
				id: z.number(),
				content: z.string(),
				sender_name: z.string().nullable(),
				is_deleted: z.boolean(),
				attachment_count: z.number(),
			})
			.nullable(),
		attachments: z.array(AttachmentSchema),
		reactions: z.array(ReactionSchema),
		/** Set while the message is pinned for everyone in the chat. */
		pinned_at: z.number().nullable(),
		pinned_by: z.object({ id: z.number(), display_name: z.string() }).nullable(),
	});
	export type Message = z.infer<typeof MessageSchema>;

	/**
	 * One emoji: pictographs, flags and their modifiers/joiners (skin tones, ZWJ sequences) — no
	 * letters or digits on their own.
	 */
	export const Emoji = z
		.string()
		.min(1)
		.max(32)
		// Emoji_Component covers joiners, variation selectors, skin tones and flag letters.
		.regex(/^[\p{Extended_Pictographic}\p{Emoji_Component}]+$/u, "Expected an emoji")
		.regex(/\p{Extended_Pictographic}|\p{Regional_Indicator}/u, "Expected an emoji");
}
