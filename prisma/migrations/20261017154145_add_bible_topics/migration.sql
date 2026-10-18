-- CreateTable
CREATE TABLE `bible_topics` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `account_id` INTEGER NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `bible_topics_account_id_updated_at_idx`(`account_id`, `updated_at`),
    UNIQUE INDEX `bible_topics_account_id_name_key`(`account_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bible_topic_entries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `topic_id` INTEGER NOT NULL,
    `sort_order` INTEGER NOT NULL,
    `book_code` CHAR(3) NOT NULL,
    `start_chapter` INTEGER NOT NULL,
    `start_verse` INTEGER NOT NULL,
    `end_chapter` INTEGER NOT NULL,
    `end_verse` INTEGER NOT NULL,

    INDEX `bible_topic_entries_topic_id_sort_order_idx`(`topic_id`, `sort_order`),
    UNIQUE INDEX `bible_topic_entries_topic_id_book_code_start_chapter_start_v_key`(`topic_id`, `book_code`, `start_chapter`, `start_verse`, `end_chapter`, `end_verse`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bible_topics` ADD CONSTRAINT `bible_topics_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bible_topic_entries` ADD CONSTRAINT `bible_topic_entries_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `bible_topics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
