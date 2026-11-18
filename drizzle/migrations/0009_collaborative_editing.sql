CREATE TABLE `file_collab` (
	`org_id` integer NOT NULL,
	`file_id` integer PRIMARY KEY NOT NULL,
	`state` blob,
	`base_seq` integer DEFAULT 0 NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`saved_seq` integer DEFAULT 0 NOT NULL,
	`init_client` integer,
	`init_until` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `file_collab_org_id_idx` ON `file_collab` (`org_id`);--> statement-breakpoint
CREATE TABLE `file_collab_updates` (
	`org_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`data` blob NOT NULL,
	`client_id` integer NOT NULL,
	`user_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `file_collab_updates_org_id_idx` ON `file_collab_updates` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `file_collab_updates_file_seq_unique` ON `file_collab_updates` (`file_id`,`seq`);