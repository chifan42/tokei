CREATE TABLE `events` (
    `device_id` text NOT NULL,
    `tool` text NOT NULL,
    `event_uuid` text NOT NULL,
    `ts` integer NOT NULL,
    `model` text,
    `input_tokens` integer DEFAULT 0 NOT NULL,
    `cached_input_tokens` integer DEFAULT 0 NOT NULL,
    `output_tokens` integer DEFAULT 0 NOT NULL,
    `cache_creation_tokens` integer DEFAULT 0 NOT NULL,
    `reasoning_output_tokens` integer DEFAULT 0 NOT NULL,
    `usd_cost` real,
    `used_fallback_price` integer DEFAULT 0 NOT NULL,
    PRIMARY KEY(`device_id`, `tool`, `event_uuid`)
);
CREATE INDEX `idx_events_ts_tool` ON `events` (`ts`, `tool`);

CREATE TABLE `prices` (
    `model` text PRIMARY KEY NOT NULL,
    `input_cost_per_token` real NOT NULL,
    `output_cost_per_token` real NOT NULL,
    `cache_read_input_token_cost` real,
    `cache_creation_input_token_cost` real,
    `updated_at` integer NOT NULL
);

CREATE TABLE `quotes` (
    `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    `text` text NOT NULL,
    `attr` text,
    `category` text NOT NULL,
    `lang` text DEFAULT 'en' NOT NULL,
    `enabled` integer DEFAULT 1 NOT NULL
);
