CREATE TABLE `build_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`artifact` text NOT NULL,
	`artifact_hash` text NOT NULL,
	`generator_version` text NOT NULL,
	`object_key` text NOT NULL,
	`object_url` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`built_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `build_state_artifact_unique` ON `build_state` (`artifact`);--> statement-breakpoint
CREATE INDEX `build_state_hash_idx` ON `build_state` (`artifact_hash`);--> statement-breakpoint
ALTER TABLE `media_assets` ADD `country_code` text;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `region_code` text;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `content_hash` text;--> statement-breakpoint
CREATE INDEX `media_assets_country_idx` ON `media_assets` (`country_code`);--> statement-breakpoint
CREATE INDEX `media_assets_region_idx` ON `media_assets` (`region_code`);--> statement-breakpoint
CREATE INDEX `media_assets_content_hash_idx` ON `media_assets` (`content_hash`);