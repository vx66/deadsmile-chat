CREATE TABLE `direct_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`sender_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`image_url` text,
	`reply_to_id` text,
	`edited_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `direct_messages_sender_recipient_idx` ON `direct_messages` (`sender_id`,`recipient_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `direct_messages_recipient_sender_idx` ON `direct_messages` (`recipient_id`,`sender_id`,`created_at`);