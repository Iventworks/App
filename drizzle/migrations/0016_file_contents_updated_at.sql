ALTER TABLE `files` ADD `contents_updated_at` integer;--> statement-breakpoint
-- Until now `updated_at` was the contents' time (renaming and moving changed it too).
UPDATE `files` SET `contents_updated_at` = `updated_at` WHERE `kind` = 'file';