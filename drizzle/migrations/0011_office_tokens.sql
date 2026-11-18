CREATE TABLE `wopi_tokens` (
	`org_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`file_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`session_id` text NOT NULL,
	`can_write` integer DEFAULT false NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wopi_tokens_token_hash_unique` ON `wopi_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `wopi_tokens_org_id_idx` ON `wopi_tokens` (`org_id`);--> statement-breakpoint
CREATE INDEX `wopi_tokens_file_id_idx` ON `wopi_tokens` (`file_id`);