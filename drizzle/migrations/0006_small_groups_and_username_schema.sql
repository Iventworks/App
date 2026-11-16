CREATE TABLE `room_responsibles` (
	`org_id` integer NOT NULL,
	`room_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	PRIMARY KEY(`room_id`, `user_id`),
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `room_responsibles_user_id_idx` ON `room_responsibles` (`user_id`);--> statement-breakpoint
CREATE TABLE `small_group_leaders` (
	`org_id` integer NOT NULL,
	`small_group_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	PRIMARY KEY(`small_group_id`, `user_id`),
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`small_group_id`) REFERENCES `small_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `small_group_leaders_user_id_idx` ON `small_group_leaders` (`user_id`);--> statement-breakpoint
CREATE TABLE `small_groups` (
	`org_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`meeting_point` text,
	`color` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `small_groups_event_id_idx` ON `small_groups` (`event_id`);--> statement-breakpoint
ALTER TABLE `orgs` ADD `username_mode` text DEFAULT 'schema' NOT NULL;--> statement-breakpoint
ALTER TABLE `orgs` ADD `username_schema` text DEFAULT '{FIRSTNAME}.{LASTNAME}' NOT NULL;--> statement-breakpoint
ALTER TABLE `participants` ADD `small_group_id` integer REFERENCES small_groups(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `program_items` ADD `in_small_groups` integer DEFAULT false NOT NULL;