PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_file_locks` (
	`org_id` integer NOT NULL,
	`file_id` integer PRIMARY KEY NOT NULL,
	`lock_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_file_locks`("org_id", "file_id", "lock_id", "expires_at", "created_at") SELECT "org_id", "file_id", "lock_id", "expires_at", "created_at" FROM `file_locks`;--> statement-breakpoint
DROP TABLE `file_locks`;--> statement-breakpoint
ALTER TABLE `__new_file_locks` RENAME TO `file_locks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `file_locks_org_id_idx` ON `file_locks` (`org_id`);