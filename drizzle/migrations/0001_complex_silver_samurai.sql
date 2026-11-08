CREATE TABLE `announcements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `announcements_event_id_idx` ON `announcements` (`event_id`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`event_id` integer,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer,
	`summary` text NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_logs_event_created_idx` ON `audit_logs` (`event_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `budget_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`kind` text DEFAULT 'expense' NOT NULL,
	`category` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`planned_cents` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `budget_items_event_id_idx` ON `budget_items` (`event_id`);--> statement-breakpoint
CREATE TABLE `calendar_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location` text,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`color` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_entries_user_start_idx` ON `calendar_entries` (`user_id`,`start_at`);--> statement-breakpoint
CREATE TABLE `conversation_members` (
	`conversation_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`is_member` integer DEFAULT true NOT NULL,
	`last_read_at` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`conversation_id`, `user_id`),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conversation_members_user_id_idx` ON `conversation_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`name` text,
	`event_id` integer,
	`group_id` integer,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_message_at` integer,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `event_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `conversations_event_id_idx` ON `conversations` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_group_id_unique` ON `conversations` (`group_id`);--> statement-breakpoint
CREATE TABLE `event_group_members` (
	`group_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `event_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `event_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_groups_event_id_idx` ON `event_groups` (`event_id`);--> statement-breakpoint
CREATE TABLE `event_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text DEFAULT 'staff' NOT NULL,
	`position` text,
	`room_id` integer,
	`leader_notes` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_members_event_user_unique` ON `event_members` (`event_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `event_members_user_id_idx` ON `event_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'camp' NOT NULL,
	`status` text DEFAULT 'planning' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location` text,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`color` text,
	`max_participants` integer,
	`participant_fee_cents` integer,
	`budget_cents` integer DEFAULT 0 NOT NULL,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`submitted_by` integer,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'Sonstiges' NOT NULL,
	`amount_cents` integer NOT NULL,
	`spent_on` text NOT NULL,
	`receipt_file_id` integer,
	`status` text DEFAULT 'submitted' NOT NULL,
	`reviewed_by` integer,
	`reviewed_at` integer,
	`review_note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`receipt_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `expenses_event_id_idx` ON `expenses` (`event_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`event_id` integer,
	`parent_id` integer,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text,
	`size` integer DEFAULT 0 NOT NULL,
	`storage_key` text,
	`uploaded_by` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `files_scope_event_idx` ON `files` (`scope`,`event_id`);--> statement-breakpoint
CREATE INDEX `files_parent_id_idx` ON `files` (`parent_id`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`role` text DEFAULT 'volunteer' NOT NULL,
	`invited_by` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_user_id` integer,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`sender_id` integer,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`edited_at` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `messages_conversation_created_idx` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`user_id` integer,
	`event_id` integer,
	`group_id` integer,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`created_by` integer,
	`updated_by` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `event_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `notes_scope_idx` ON `notes` (`scope`);--> statement-breakpoint
CREATE INDEX `notes_user_id_idx` ON `notes` (`user_id`);--> statement-breakpoint
CREATE INDEX `notes_event_id_idx` ON `notes` (`event_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`link` text,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_created_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `org_resources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'Allgemein' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`location` text,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `participant_emergency_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`participant_id` integer NOT NULL,
	`name` text NOT NULL,
	`relation` text,
	`phone` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `participant_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`participant_id` integer NOT NULL,
	`author_id` integer,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`participant_id`) REFERENCES `participants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`birth_date` text,
	`gender` text,
	`email` text,
	`phone` text,
	`address` text,
	`guardian_name` text,
	`guardian_phone` text,
	`allergies` text DEFAULT '' NOT NULL,
	`medications` text DEFAULT '' NOT NULL,
	`dietary_requirements` text DEFAULT '' NOT NULL,
	`medical_notes` text DEFAULT '' NOT NULL,
	`can_swim` integer,
	`photo_consent` integer DEFAULT false NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`room_id` integer,
	`status` text DEFAULT 'registered' NOT NULL,
	`fee_paid` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `participants_event_id_idx` ON `participants` (`event_id`);--> statement-breakpoint
CREATE TABLE `program_item_files` (
	`program_item_id` integer NOT NULL,
	`file_id` integer NOT NULL,
	PRIMARY KEY(`program_item_id`, `file_id`),
	FOREIGN KEY (`program_item_id`) REFERENCES `program_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `program_item_responsibles` (
	`program_item_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	PRIMARY KEY(`program_item_id`, `user_id`),
	FOREIGN KEY (`program_item_id`) REFERENCES `program_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `program_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location` text,
	`category` text,
	`color` text,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `program_items_event_start_idx` ON `program_items` (`event_id`,`start_at`);--> statement-breakpoint
CREATE TABLE `resource_bookings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_id` integer NOT NULL,
	`event_id` integer NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `org_resources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `resource_bookings_resource_id_idx` ON `resource_bookings` (`resource_id`);--> statement-breakpoint
CREATE INDEX `resource_bookings_event_id_idx` ON `resource_bookings` (`event_id`);--> statement-breakpoint
CREATE TABLE `responsibilities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `responsibilities_event_id_idx` ON `responsibilities` (`event_id`);--> statement-breakpoint
CREATE TABLE `responsibility_assignees` (
	`responsibility_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	PRIMARY KEY(`responsibility_id`, `user_id`),
	FOREIGN KEY (`responsibility_id`) REFERENCES `responsibilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`name` text NOT NULL,
	`capacity` integer,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rooms_event_id_idx` ON `rooms` (`event_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer,
	`user_id` integer,
	`group_id` integer,
	`assignee_id` integer,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`due_at` integer,
	`completed_at` integer,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `event_groups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_event_id_idx` ON `tasks` (`event_id`);--> statement-breakpoint
CREATE INDEX `tasks_user_id_idx` ON `tasks` (`user_id`);--> statement-breakpoint
CREATE INDEX `tasks_assignee_id_idx` ON `tasks` (`assignee_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `phone` text;