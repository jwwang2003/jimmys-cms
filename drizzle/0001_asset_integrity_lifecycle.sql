ALTER TABLE `media_assets` ADD `lifecycle_status` text CONSTRAINT `media_assets_lifecycle_status_check` CHECK ("lifecycle_status" IN ('active', 'trashed')) NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE `media_assets` ADD `integrity_status` text CONSTRAINT `media_assets_integrity_status_check` CHECK ("integrity_status" IN ('ok', 'missing', 'warning', 'invalid')) NOT NULL DEFAULT 'ok';
--> statement-breakpoint
ALTER TABLE `media_assets` ADD `integrity_message` text;
--> statement-breakpoint
ALTER TABLE `media_assets` ADD `last_verified_at` integer;
--> statement-breakpoint
ALTER TABLE `media_assets` ADD `trashed_at` integer;
--> statement-breakpoint
CREATE INDEX `media_assets_lifecycle_idx` ON `media_assets` (`lifecycle_status`);
--> statement-breakpoint
CREATE INDEX `media_assets_integrity_idx` ON `media_assets` (`integrity_status`);
