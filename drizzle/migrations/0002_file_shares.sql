CREATE TABLE `file_shares` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`file_id` integer NOT NULL,
	`token` text NOT NULL,
	`label` text,
	`can_read` integer DEFAULT true NOT NULL,
	`can_upload` integer DEFAULT false NOT NULL,
	`can_edit` integer DEFAULT false NOT NULL,
	`can_delete` integer DEFAULT false NOT NULL,
	`password_hash` text,
	`expires_at` integer,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_accessed_at` integer,
	`access_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_shares_token_unique` ON `file_shares` (`token`);--> statement-breakpoint
CREATE INDEX `file_shares_org_id_idx` ON `file_shares` (`org_id`);--> statement-breakpoint
CREATE INDEX `file_shares_file_id_idx` ON `file_shares` (`file_id`);--> statement-breakpoint
ALTER TABLE `orgs` ADD `file_sharing_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `orgs` ADD `share_default_expiry_days` integer;