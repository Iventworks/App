CREATE TABLE `form_responses` (
	`org_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`form_id` integer NOT NULL,
	`number` integer NOT NULL,
	`answers` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `form_responses_org_id_idx` ON `form_responses` (`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `form_responses_form_number_idx` ON `form_responses` (`form_id`,`number`);--> statement-breakpoint
CREATE TABLE `forms` (
	`org_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`event_id` integer,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`fields` text DEFAULT '[]' NOT NULL,
	`confirmation_message` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`token` text,
	`closes_at` integer,
	`published_at` integer,
	`closed_at` integer,
	`last_response_number` integer DEFAULT 0 NOT NULL,
	`created_by` integer,
	`updated_by` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `forms_token_unique` ON `forms` (`token`);--> statement-breakpoint
CREATE INDEX `forms_org_id_idx` ON `forms` (`org_id`);--> statement-breakpoint
CREATE INDEX `forms_event_id_idx` ON `forms` (`event_id`);--> statement-breakpoint
ALTER TABLE `orgs` ADD `form_starters_added` integer DEFAULT false NOT NULL;