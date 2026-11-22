CREATE INDEX `file_access_user_id_idx` ON `file_access` (`user_id`);--> statement-breakpoint
CREATE INDEX `file_access_org_group_id_idx` ON `file_access` (`org_group_id`);--> statement-breakpoint
CREATE INDEX `file_access_event_group_id_idx` ON `file_access` (`event_group_id`);--> statement-breakpoint
CREATE INDEX `wopi_tokens_session_id_idx` ON `wopi_tokens` (`session_id`);