-- AlterTable
ALTER TABLE `messages` MODIFY `type` ENUM('text', 'image', 'file', 'music_playlist', 'chain', 'prayer', 'grace', 'sermon_request', 'why_topic_card', 'bible_session', 'bible_copywork', 'chat_record', 'handwriting', 'system') NOT NULL DEFAULT 'text';

-- CreateTable
CREATE TABLE `bible_copyworks` (
    `id` VARCHAR(64) NOT NULL,
    `account_id` INTEGER NOT NULL,
    `source` JSON NOT NULL,
    `translation` VARCHAR(30) NOT NULL,
    `book_code` CHAR(3) NOT NULL,
    `chapter` INTEGER NOT NULL,
    `verse_start` INTEGER NOT NULL,
    `verse_end` INTEGER NOT NULL,
    `spacing` VARCHAR(16) NOT NULL DEFAULT 'normal',
    `completed_at` DATETIME(3) NULL,
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bible_copyworks_translation_book_code_chapter_published_at_idx`(`translation`, `book_code`, `chapter`, `published_at`),
    INDEX `bible_copyworks_account_id_completed_at_idx`(`account_id`, `completed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bible_copywork_glyphs` (
    `work_id` VARCHAR(64) NOT NULL,
    `position` INTEGER NOT NULL,
    `ink` JSON NOT NULL,

    PRIMARY KEY (`work_id`, `position`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bible_copywork_shares` (
    `message_id` INTEGER NOT NULL,
    `work_id` VARCHAR(64) NOT NULL,

    INDEX `bible_copywork_shares_work_id_idx`(`work_id`),
    PRIMARY KEY (`message_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bible_copyworks` ADD CONSTRAINT `bible_copyworks_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bible_copywork_glyphs` ADD CONSTRAINT `bible_copywork_glyphs_work_id_fkey` FOREIGN KEY (`work_id`) REFERENCES `bible_copyworks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bible_copywork_shares` ADD CONSTRAINT `bible_copywork_shares_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bible_copywork_shares` ADD CONSTRAINT `bible_copywork_shares_work_id_fkey` FOREIGN KEY (`work_id`) REFERENCES `bible_copyworks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
