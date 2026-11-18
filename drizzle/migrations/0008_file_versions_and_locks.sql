CREATE TABLE `file_locks` (
	`org_id` integer NOT NULL,
	`file_id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`lock_id` text NOT NULL,
	`user_id` integer,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `file_locks_org_id_idx` ON `file_locks` (`org_id`);--> statement-breakpoint
CREATE TABLE `file_versions` (
	`org_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`storage_key` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`mime_type` text,
	`modified_by` integer,
	`modified_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`modified_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `file_versions_org_id_idx` ON `file_versions` (`org_id`);--> statement-breakpoint
CREATE INDEX `file_versions_file_id_idx` ON `file_versions` (`file_id`);--> statement-breakpoint
ALTER TABLE `files` ADD `modified_by` integer REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
-- Until now the contents of a file were always written by its uploader.
UPDATE `files` SET `modified_by` = `uploaded_by` WHERE `kind` = 'file';