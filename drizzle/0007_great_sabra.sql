CREATE TABLE `task_dependencies` (
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`predecessor_task_id` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	PRIMARY KEY(`task_id`, `predecessor_task_id`),
	FOREIGN KEY (`project_id`,`task_id`) REFERENCES `tasks`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`predecessor_task_id`) REFERENCES `tasks`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_dependencies_not_self_check" CHECK("task_dependencies"."task_id" <> "task_dependencies"."predecessor_task_id")
);
--> statement-breakpoint
CREATE INDEX `task_dependencies_task_idx` ON `task_dependencies` (`project_id`,`task_id`);--> statement-breakpoint
CREATE INDEX `task_dependencies_predecessor_idx` ON `task_dependencies` (`project_id`,`predecessor_task_id`);