-- AlterTable
ALTER TABLE `accounts` ADD COLUMN `gender` VARCHAR(16) NOT NULL DEFAULT 'unspecified';

-- CreateTable
CREATE TABLE `stories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `account_id` INTEGER NOT NULL,
    `request_id` VARCHAR(36) NOT NULL,
    `text` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stories_account_id_id_idx`(`account_id`, `id`),
    UNIQUE INDEX `stories_account_id_request_id_key`(`account_id`, `request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `story_media` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `story_id` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `content_type` VARCHAR(80) NOT NULL,
    `file_size` INTEGER NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `duration_ms` INTEGER NULL,

    UNIQUE INDEX `story_media_story_id_position_key`(`story_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `stories` ADD CONSTRAINT `stories_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `story_media` ADD CONSTRAINT `story_media_story_id_fkey` FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
