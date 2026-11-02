CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`parent_type` text NOT NULL,
	`parent_id` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`uploaded_user_id` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "attachments_parent_type_check" CHECK("attachments"."parent_type" in ('task', 'milestone')),
	CONSTRAINT "attachments_size_check" CHECK("attachments"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE INDEX `attachments_parent_idx` ON `attachments` (`parent_type`,`parent_id`);--> statement-breakpoint
CREATE INDEX `attachments_project_idx` ON `attachments` (`project_id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`parent_type` text NOT NULL,
	`parent_id` text NOT NULL,
	`body` text NOT NULL,
	`author_user_id` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "notes_parent_type_check" CHECK("notes"."parent_type" in ('task', 'subtask')),
	CONSTRAINT "notes_body_check" CHECK(length(trim("notes"."body")) > 0)
);
--> statement-breakpoint
CREATE INDEX `notes_parent_idx` ON `notes` (`parent_type`,`parent_id`);--> statement-breakpoint
CREATE INDEX `notes_project_idx` ON `notes` (`project_id`);