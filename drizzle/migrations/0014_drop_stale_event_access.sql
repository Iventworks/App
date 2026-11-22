-- People who left an event's team stayed on its document access lists, which may only name the
-- team (the Leitung's next save of such a list failed, and rejoining brought the access back).
-- Removing a member now drops them from the lists; this clears what is left from before.
DELETE FROM `file_access`
WHERE `principal` = 'user'
	AND `file_id` IN (SELECT `id` FROM `files` WHERE `event_id` IS NOT NULL)
	AND NOT EXISTS (
		SELECT 1 FROM `files` AS f
		INNER JOIN `event_members` AS m ON m.`event_id` = f.`event_id`
		WHERE f.`id` = `file_access`.`file_id` AND m.`user_id` = `file_access`.`user_id`
	);
