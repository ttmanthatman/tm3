-- AlterTable
ALTER TABLE `messages` ADD COLUMN `calendar_owner_actor_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `calendar_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `channel_id` INTEGER NOT NULL,
    `owner_account_id` INTEGER NOT NULL,
    `owner_actor_id` INTEGER NOT NULL,
    `title` VARCHAR(160) NOT NULL,
    `description` TEXT NOT NULL,
    `start_at` DATETIME(3) NOT NULL,
    `end_at` DATETIME(3) NOT NULL,
    `time_zone` VARCHAR(80) NOT NULL,
    `all_day` BOOLEAN NOT NULL DEFAULT false,
    `visibility` VARCHAR(16) NOT NULL DEFAULT 'private',
    `repeat` VARCHAR(16) NOT NULL DEFAULT 'none',
    `weekdays` JSON NOT NULL,
    `until_at` DATETIME(3) NULL,
    `excluded_dates` JSON NOT NULL,
    `reminders` JSON NOT NULL,
    `reminder_mode` VARCHAR(16) NOT NULL DEFAULT 'private',
    `reminder_text` TEXT NOT NULL,
    `chain_config` JSON NULL,
    `paused` BOOLEAN NOT NULL DEFAULT false,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `calendar_events_channel_id_start_at_idx`(`channel_id`, `start_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calendar_grants` (
    `event_id` INTEGER NOT NULL,
    `account_id` INTEGER NOT NULL,

    PRIMARY KEY (`event_id`, `account_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calendar_deliveries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_id` INTEGER NOT NULL,
    `revision` INTEGER NOT NULL,
    `occurrence_at` DATETIME(3) NOT NULL,
    `reminder_index` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'sent',
    `message_id` INTEGER NULL,
    `broadcasted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `calendar_deliveries_message_id_key`(`message_id`),
    INDEX `calendar_deliveries_broadcasted_at_message_id_idx`(`broadcasted_at`, `message_id`),
    UNIQUE INDEX `calendar_deliveries_event_id_revision_occurrence_at_reminder_key`(`event_id`, `revision`, `occurrence_at`, `reminder_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calendar_notices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `delivery_id` INTEGER NOT NULL,
    `account_id` INTEGER NOT NULL,
    `read_at` DATETIME(3) NULL,

    INDEX `calendar_notices_account_id_read_at_idx`(`account_id`, `read_at`),
    UNIQUE INDEX `calendar_notices_delivery_id_account_id_key`(`delivery_id`, `account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `calendar_events` ADD CONSTRAINT `calendar_events_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calendar_events` ADD CONSTRAINT `calendar_events_owner_account_id_fkey` FOREIGN KEY (`owner_account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calendar_grants` ADD CONSTRAINT `calendar_grants_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `calendar_events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calendar_deliveries` ADD CONSTRAINT `calendar_deliveries_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `calendar_events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calendar_notices` ADD CONSTRAINT `calendar_notices_delivery_id_fkey` FOREIGN KEY (`delivery_id`) REFERENCES `calendar_deliveries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `calendar_notices` ADD CONSTRAINT `calendar_notices_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
