CREATE TABLE `pending_task_assignments` (
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`email` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	PRIMARY KEY(`task_id`, `email`),
	FOREIGN KEY (`project_id`,`task_id`) REFERENCES `tasks`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pending_task_assignments_normalized_email_check" CHECK("pending_task_assignments"."email" = lower(trim("pending_task_assignments"."email")))
);
--> statement-breakpoint
CREATE INDEX `pending_task_assignments_email_idx` ON `pending_task_assignments` (`project_id`,`email`);