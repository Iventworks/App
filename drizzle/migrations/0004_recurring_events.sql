CREATE TABLE `event_occurrences` (
	`org_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`date` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`location` text,
	`title` text,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`cancel_reason` text,
	`origin` text DEFAULT 'rule' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_occurrences_event_date_idx` ON `event_occurrences` (`event_id`,`date`);--> statement-breakpoint
CREATE TABLE `occurrence_duties` (
	`org_id` integer NOT NULL,
	`occurrence_id` integer NOT NULL,
	`responsibility_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`occurrence_id`, `responsibility_id`, `user_id`),
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`occurrence_id`) REFERENCES `event_occurrences`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`responsibility_id`) REFERENCES `responsibilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `occurrence_duties_user_id_idx` ON `occurrence_duties` (`user_id`);--> statement-breakpoint
ALTER TABLE `events` ADD `recurrence` text;