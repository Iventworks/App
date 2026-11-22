CREATE TABLE `event_materials` (
	`org_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`kind` text NOT NULL,
	`resource_id` integer,
	`name` text,
	`quantity` integer DEFAULT 1 NOT NULL,
	`location` text,
	`notes` text DEFAULT '' NOT NULL,
	`owner_id` integer,
	`request_id` integer,
	`bought_at` integer,
	`estimated_cents` integer,
	`buyer_id` integer,
	`expense_id` integer,
	`used_quantity` integer,
	`packed_at` integer,
	`returned_at` integer,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `org_resources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`request_id`) REFERENCES `material_requests`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`buyer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `event_materials_event_id_idx` ON `event_materials` (`event_id`);--> statement-breakpoint
CREATE INDEX `event_materials_resource_id_idx` ON `event_materials` (`resource_id`);--> statement-breakpoint
CREATE INDEX `event_materials_request_id_idx` ON `event_materials` (`request_id`);--> statement-breakpoint
CREATE TABLE `material_links` (
	`org_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`program_item_id` integer,
	`occurrence_id` integer,
	`quantity` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`material_id`) REFERENCES `event_materials`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`program_item_id`) REFERENCES `program_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`occurrence_id`) REFERENCES `event_occurrences`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_links_program_unique` ON `material_links` (`material_id`,`program_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_links_occurrence_unique` ON `material_links` (`material_id`,`occurrence_id`);--> statement-breakpoint
CREATE INDEX `material_links_program_item_id_idx` ON `material_links` (`program_item_id`);--> statement-breakpoint
CREATE INDEX `material_links_occurrence_id_idx` ON `material_links` (`occurrence_id`);--> statement-breakpoint
CREATE TABLE `material_requests` (
	`org_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`program_item_id` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`answer` text,
	`requested_by` integer,
	`decided_by` integer,
	`decided_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`program_item_id`) REFERENCES `program_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`requested_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `material_requests_event_id_idx` ON `material_requests` (`event_id`);--> statement-breakpoint
CREATE TABLE `resource_purchases` (
	`org_id` integer NOT NULL,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`estimated_cents` integer,
	`buyer_id` integer,
	`notes` text DEFAULT '' NOT NULL,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `org_resources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`buyer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `resource_purchases_resource_id_idx` ON `resource_purchases` (`resource_id`);--> statement-breakpoint
ALTER TABLE `events` ADD `material_days_before` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `material_days_after` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `org_resources` ADD `brand` text;--> statement-breakpoint
ALTER TABLE `org_resources` ADD `size` text;--> statement-breakpoint
ALTER TABLE `org_resources` ADD `condition` text;--> statement-breakpoint
ALTER TABLE `org_resources` ADD `consumable` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Bookings become the inventory entries of the events' material lists.
INSERT INTO `event_materials` (`org_id`, `event_id`, `kind`, `resource_id`, `quantity`, `notes`, `created_at`, `updated_at`)
SELECT `org_id`, `event_id`, 'inventory', `resource_id`, `quantity`, `notes`, `created_at`, `created_at` FROM `resource_bookings` ORDER BY `id`;
