-- CreateTable
CREATE TABLE `friend_playbacks` (
    `account_id` INTEGER NOT NULL,
    `program_id` VARCHAR(32) NOT NULL,
    `series_title` VARCHAR(190) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `audio_url` VARCHAR(512) NOT NULL,
    `image_url` VARCHAR(512) NULL,
    `progress_ms` INTEGER NOT NULL DEFAULT 0,
    `duration_ms` INTEGER NOT NULL DEFAULT 0,
    `played_at` DATETIME(3) NOT NULL,

    INDEX `friend_playbacks_account_id_played_at_idx`(`account_id`, `played_at`),
    PRIMARY KEY (`account_id`, `program_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `friend_playbacks` ADD CONSTRAINT `friend_playbacks_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
