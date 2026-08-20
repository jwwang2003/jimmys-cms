ALTER TABLE `media_assets` ADD `kind` text DEFAULT 'support' NOT NULL;--> statement-breakpoint
CREATE INDEX `media_assets_kind_idx` ON `media_assets` (`kind`);