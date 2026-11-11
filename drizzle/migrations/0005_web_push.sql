CREATE TABLE `push_subscriptions` (
	`org_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`session_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`label` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_success_at` integer,
	`failure_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_org_endpoint_unique` ON `push_subscriptions` (`org_id`,`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_id_idx` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
DROP INDEX `event_occurrences_event_date_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `event_occurrences_event_date_unique` ON `event_occurrences` (`event_id`,`date`);--> statement-breakpoint
ALTER TABLE `users` ADD `last_seen_at` integer;--> statement-breakpoint
CREATE INDEX `files_conversation_id_idx` ON `files` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `messages_reply_to_id_idx` ON `messages` (`reply_to_id`);