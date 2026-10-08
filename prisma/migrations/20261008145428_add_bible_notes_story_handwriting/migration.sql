-- AlterTable
ALTER TABLE `story_comments` ADD COLUMN `handwriting` JSON NULL;

-- CreateTable
CREATE TABLE `bible_notes` (
    `id` VARCHAR(64) NOT NULL,
    `account_id` INTEGER NOT NULL,
    `source` JSON NOT NULL,
    `translation` VARCHAR(30) NOT NULL,
    `book_code` CHAR(3) NOT NULL,
    `chapter` INTEGER NOT NULL,
    `verse` INTEGER NOT NULL,
    `text` TEXT NOT NULL,
    `published_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `bible_notes_translation_book_code_chapter_published_at_idx`(`translation`, `book_code`, `chapter`, `published_at`),
    INDEX `bible_notes_account_id_updated_at_idx`(`account_id`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bible_note_shares` (
    `message_id` INTEGER NOT NULL,
    `note_id` VARCHAR(64) NOT NULL,

    INDEX `bible_note_shares_note_id_idx`(`note_id`),
    PRIMARY KEY (`message_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bible_notes` ADD CONSTRAINT `bible_notes_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bible_note_shares` ADD CONSTRAINT `bible_note_shares_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bible_note_shares` ADD CONSTRAINT `bible_note_shares_note_id_fkey` FOREIGN KEY (`note_id`) REFERENCES `bible_notes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
