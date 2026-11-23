ALTER TABLE `forms` ADD `leaders_only` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Event forms were for the Leitung only so far: they stay that way.
UPDATE `forms` SET `leaders_only` = true WHERE `scope` = 'event';
