CREATE TABLE `subtasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'Not started' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`project_id`,`task_id`) REFERENCES `tasks`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "subtasks_status_check" CHECK("subtasks"."status" in ('Not started', 'In progress', 'Blocked', 'Done')),
	CONSTRAINT "subtasks_name_check" CHECK(length(trim("subtasks"."name")) > 0),
	CONSTRAINT "subtasks_version_check" CHECK("subtasks"."version" > 0)
);
--> statement-breakpoint
CREATE INDEX `subtasks_task_idx` ON `subtasks` (`project_id`,`task_id`,`created_at`);