ALTER TABLE `milestones` ADD `planned_due` text;--> statement-breakpoint
ALTER TABLE `subtasks` ADD `due` text;--> statement-breakpoint
ALTER TABLE `subtasks` ADD `owner_assignee_id` text;--> statement-breakpoint
CREATE INDEX `subtasks_owner_idx` ON `subtasks` (`project_id`,`owner_assignee_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `planned_due` text;--> statement-breakpoint
UPDATE `tasks` SET `planned_due` = `due`;--> statement-breakpoint
UPDATE `milestones` SET `planned_due` = `due`;--> statement-breakpoint
UPDATE `subtasks` SET `due` = (
  SELECT `tasks`.`due` FROM `tasks` WHERE `tasks`.`id` = `subtasks`.`task_id`
) WHERE `due` IS NULL;--> statement-breakpoint
UPDATE `tasks` SET
  `due` = (SELECT max(`subtasks`.`due`) FROM `subtasks` WHERE `subtasks`.`task_id` = `tasks`.`id`),
  `version` = `version` + 1,
  `updated_at` = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM `subtasks` WHERE `subtasks`.`task_id` = `tasks`.`id`)
  AND `due` <> (SELECT max(`subtasks`.`due`) FROM `subtasks` WHERE `subtasks`.`task_id` = `tasks`.`id`);--> statement-breakpoint
UPDATE `milestones` SET
  `due` = (SELECT max(`tasks`.`due`) FROM `tasks` WHERE `tasks`.`milestone_id` = `milestones`.`id`),
  `version` = `version` + 1,
  `updated_at` = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM `tasks` WHERE `tasks`.`milestone_id` = `milestones`.`id`)
  AND `due` <> (SELECT max(`tasks`.`due`) FROM `tasks` WHERE `tasks`.`milestone_id` = `milestones`.`id`);
