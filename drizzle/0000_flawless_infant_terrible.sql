CREATE TABLE `asset_location_conflicts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` integer NOT NULL,
	`existing_location_id` integer,
	`candidate_location_id` integer,
	`distance_meters` real,
	`status` text DEFAULT 'pending' NOT NULL,
	`resolution` text,
	`resolved_by` text,
	`resolved_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`existing_location_id`) REFERENCES `asset_locations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`candidate_location_id`) REFERENCES `asset_locations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolved_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `asset_location_conflicts_asset_idx` ON `asset_location_conflicts` (`asset_id`);--> statement-breakpoint
CREATE INDEX `asset_location_conflicts_status_idx` ON `asset_location_conflicts` (`status`);--> statement-breakpoint
CREATE TABLE `asset_locations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` integer NOT NULL,
	`content_type` text DEFAULT 'media' NOT NULL,
	`label` text,
	`raw_address` text,
	`formatted_address` text,
	`google_place_id` text,
	`lat` real,
	`lng` real,
	`is_primary` integer DEFAULT false NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_ref` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`raw_response_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `asset_locations_asset_idx` ON `asset_locations` (`asset_id`);--> statement-breakpoint
CREATE INDEX `asset_locations_primary_idx` ON `asset_locations` (`asset_id`,`is_primary`);--> statement-breakpoint
CREATE TABLE `collection_assets` (
	`collection_id` integer NOT NULL,
	`asset_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`added_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`collection_id`, `asset_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_assets_position_idx` ON `collection_assets` (`collection_id`,`position`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`kind` text DEFAULT 'collection' NOT NULL,
	`description` text,
	`cover_asset_id` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`cover_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_slug_unique` ON `collections` (`slug`);--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`media_type` text DEFAULT 'image' NOT NULL,
	`storage_id` text NOT NULL,
	`folder_id` integer,
	`object_key` text NOT NULL,
	`original_filename` text,
	`display_filename` text,
	`object_url` text,
	`thumbnail_key` text,
	`thumbnail_url` text,
	`mime_type` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`width` integer,
	`height` integer,
	`checksum` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`lifecycle_status` text DEFAULT 'active' NOT NULL,
	`integrity_status` text DEFAULT 'ok' NOT NULL,
	`integrity_message` text,
	`last_verified_at` integer,
	`trashed_at` integer,
	`published_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`created_by` text,
	`metadata_json` text,
	FOREIGN KEY (`storage_id`) REFERENCES `storage_locations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`folder_id`) REFERENCES `storage_folders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "media_assets_lifecycle_status_check" CHECK("media_assets"."lifecycle_status" in ('active', 'trashed')),
	CONSTRAINT "media_assets_integrity_status_check" CHECK("media_assets"."integrity_status" in ('ok', 'missing', 'warning', 'invalid'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_slug_unique` ON `media_assets` (`slug`);--> statement-breakpoint
CREATE INDEX `media_assets_storage_idx` ON `media_assets` (`storage_id`,`object_key`);--> statement-breakpoint
CREATE INDEX `media_assets_status_idx` ON `media_assets` (`status`);--> statement-breakpoint
CREATE INDEX `media_assets_lifecycle_idx` ON `media_assets` (`lifecycle_status`);--> statement-breakpoint
CREATE INDEX `media_assets_integrity_idx` ON `media_assets` (`integrity_status`);--> statement-breakpoint
CREATE INDEX `media_assets_published_idx` ON `media_assets` (`published_at`);--> statement-breakpoint
CREATE TABLE `media_attributes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` integer NOT NULL,
	`namespace` text DEFAULT 'default' NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_attributes_unique_key` ON `media_attributes` (`asset_id`,`namespace`,`key`);--> statement-breakpoint
CREATE TABLE `media_ingest_job_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`order_index` integer DEFAULT 0 NOT NULL,
	`original_filename` text NOT NULL,
	`stored_object_key` text,
	`external_id` text,
	`detected_media_type` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress_percent` integer DEFAULT 0 NOT NULL,
	`asset_id` integer,
	`warning_message` text,
	`error_message` text,
	`detail_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `media_ingest_jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `media_ingest_job_items_job_idx` ON `media_ingest_job_items` (`job_id`,`order_index`);--> statement-breakpoint
CREATE INDEX `media_ingest_job_items_status_idx` ON `media_ingest_job_items` (`status`);--> statement-breakpoint
CREATE TABLE `media_ingest_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`mode` text DEFAULT 'batch_upload' NOT NULL,
	`spreadsheet_filename` text,
	`total_items` integer DEFAULT 0 NOT NULL,
	`processed_items` integer DEFAULT 0 NOT NULL,
	`completed_items` integer DEFAULT 0 NOT NULL,
	`warning_items` integer DEFAULT 0 NOT NULL,
	`failed_items` integer DEFAULT 0 NOT NULL,
	`unmatched_rows` integer DEFAULT 0 NOT NULL,
	`current_item_label` text,
	`summary_json` text,
	`error_message` text,
	`created_by` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `media_ingest_jobs_status_idx` ON `media_ingest_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `media_ingest_jobs_created_by_idx` ON `media_ingest_jobs` (`created_by`);--> statement-breakpoint
CREATE TABLE `media_renditions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`asset_id` integer NOT NULL,
	`label` text NOT NULL,
	`object_key` text NOT NULL,
	`object_url` text,
	`mime_type` text,
	`width` integer,
	`height` integer,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_renditions_asset_label` ON `media_renditions` (`asset_id`,`label`);--> statement-breakpoint
CREATE TABLE `media_tags` (
	`asset_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	`applied_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`asset_id`, `tag_id`),
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `photo_cameras` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`make` text,
	`model` text NOT NULL,
	`normalized_key` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_cameras_normalized_key_unique` ON `photo_cameras` (`normalized_key`);--> statement-breakpoint
CREATE TABLE `photo_exif` (
	`asset_id` integer PRIMARY KEY NOT NULL,
	`camera_id` integer,
	`lens_id` integer,
	`captured_at` integer,
	`pixel_width` integer,
	`pixel_height` integer,
	`focal_length_mm` real,
	`aperture_f_number` real,
	`exposure_time_text` text,
	`iso` integer,
	`orientation` integer,
	`software` text,
	`gps_lat` real,
	`gps_lng` real,
	`gps_altitude_m` real,
	`metadata_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`camera_id`) REFERENCES `photo_cameras`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`lens_id`) REFERENCES `photo_lenses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `photo_exif_camera_idx` ON `photo_exif` (`camera_id`);--> statement-breakpoint
CREATE INDEX `photo_exif_lens_idx` ON `photo_exif` (`lens_id`);--> statement-breakpoint
CREATE TABLE `photo_lenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`normalized_key` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_lenses_normalized_key_unique` ON `photo_lenses` (`normalized_key`);--> statement-breakpoint
CREATE TABLE `storage_folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`storage_id` text NOT NULL,
	`folder_type` text NOT NULL,
	`prefix` text NOT NULL,
	`description` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`storage_id`) REFERENCES `storage_locations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_folders_type_unique` ON `storage_folders` (`storage_id`,`folder_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `storage_folders_prefix_unique` ON `storage_folders` (`storage_id`,`prefix`);--> statement-breakpoint
CREATE TABLE `storage_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket_name` text NOT NULL,
	`region` text NOT NULL,
	`base_url` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_locations_bucket` ON `storage_locations` (`bucket_name`);--> statement-breakpoint
CREATE TABLE `storage_objects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`storage_id` text NOT NULL,
	`folder_id` integer,
	`folder_type` text NOT NULL,
	`object_key` text NOT NULL,
	`object_url` text,
	`mime_type` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`checksum` text,
	`etag` text,
	`last_modified` integer,
	`synced_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`sync_status` text DEFAULT 'discovered' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`last_error` text,
	`asset_id` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`storage_id`) REFERENCES `storage_locations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `storage_folders`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_objects_storage_key` ON `storage_objects` (`storage_id`,`object_key`);--> statement-breakpoint
CREATE INDEX `storage_objects_folder_idx` ON `storage_objects` (`folder_type`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`slug` text NOT NULL,
	`color` text,
	`description` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_slug_unique` ON `tags` (`slug`);--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`password` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`username` text,
	`display_username` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
