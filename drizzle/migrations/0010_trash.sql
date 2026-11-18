ALTER TABLE `files` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `files` ADD `deleted_by` integer REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `files_deleted_at_idx` ON `files` (`deleted_at`);