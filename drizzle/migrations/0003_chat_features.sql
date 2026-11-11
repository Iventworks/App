CREATE TABLE `message_reactions` (
	`org_id` integer NOT NULL,
	`message_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`message_id`, `user_id`, `emoji`),
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `conversation_members` ADD `pinned_at` integer;--> statement-breakpoint
ALTER TABLE `conversation_members` ADD `muted` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `conversation_id` integer REFERENCES conversations(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `files` ADD `message_id` integer REFERENCES messages(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `files_message_id_idx` ON `files` (`message_id`);--> statement-breakpoint
ALTER TABLE `messages` ADD `reply_to_id` integer REFERENCES messages(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `messages` ADD `pinned_at` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `pinned_by` integer REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `messages` ADD `updated_at` integer;--> statement-breakpoint
CREATE INDEX `messages_conversation_updated_idx` ON `messages` (`conversation_id`,`updated_at`);