ALTER TABLE `messages` ADD `message_type` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `is_pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `edited_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `is_online` integer DEFAULT false NOT NULL;