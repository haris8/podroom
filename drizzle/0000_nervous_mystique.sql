CREATE TABLE `episodes` (
	`id` text NOT NULL,
	`library_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`title` text NOT NULL,
	`words` integer NOT NULL,
	`voice` text NOT NULL,
	`voice_name` text NOT NULL,
	`engine` text NOT NULL,
	`rate` real NOT NULL,
	`passage_count` integer NOT NULL,
	`progress_index` integer DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`library_id`, `id`),
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_episodes_library_ordinal` ON `episodes` (`library_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `libraries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`source_key` text NOT NULL,
	`source_hash` text NOT NULL,
	`episode_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_libraries_owner_archived_created` ON `libraries` (`owner_id`,`archived`,`created_at`);