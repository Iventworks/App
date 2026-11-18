CREATE TABLE `file_access` (
	`org_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`principal` text NOT NULL,
	`org_group_id` integer,
	`event_group_id` integer,
	`user_id` integer,
	`can_read` integer DEFAULT true NOT NULL,
	`can_upload` integer DEFAULT false NOT NULL,
	`can_edit` integer DEFAULT false NOT NULL,
	`can_delete` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_group_id`) REFERENCES `org_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_group_id`) REFERENCES `event_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `file_access_org_id_idx` ON `file_access` (`org_id`);--> statement-breakpoint
CREATE INDEX `file_access_file_id_idx` ON `file_access` (`file_id`);--> statement-breakpoint
CREATE TABLE `org_group_members` (
	`org_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `org_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `org_group_members_user_id_idx` ON `org_group_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `org_groups` (
	`org_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `org_groups_org_id_idx` ON `org_groups` (`org_id`);--> statement-breakpoint
ALTER TABLE `files` ADD `custom_access` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- The org library used to be readable by every member. New items are Kernteam-only by default, so
-- everything that already exists keeps its visibility: its top level gets "Alle Mitglieder: ansehen".
UPDATE `files` SET `custom_access` = 1 WHERE `scope` = 'org' AND `parent_id` IS NULL;--> statement-breakpoint
INSERT INTO `file_access` (`org_id`, `file_id`, `principal`, `can_read`, `can_upload`, `can_edit`, `can_delete`)
SELECT `org_id`, `id`, 'members', 1, 0, 0, 0 FROM `files` WHERE `scope` = 'org' AND `parent_id` IS NULL;
