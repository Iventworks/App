DROP TABLE `file_collab`;--> statement-breakpoint
DROP TABLE `file_collab_updates`;--> statement-breakpoint
-- Locks of Markdown editing sessions (kind `editor`) are gone with the feature.
DELETE FROM `file_locks` WHERE `kind` = 'editor';