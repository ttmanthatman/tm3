-- CreateTable
CREATE TABLE `books` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(200) NOT NULL,
    `author` VARCHAR(120) NOT NULL DEFAULT '',
    `language` VARCHAR(20) NOT NULL DEFAULT '',
    `file_name` VARCHAR(64) NOT NULL,
    `cover_name` VARCHAR(64) NULL,
    `file_size` INTEGER NOT NULL,
    `created_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `books_file_name_key`(`file_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `book_progress` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `book_id` INTEGER NOT NULL,
    `account_id` INTEGER NOT NULL,
    `fraction` DOUBLE NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `book_progress_account_id_updated_at_idx`(`account_id`, `updated_at`),
    UNIQUE INDEX `book_progress_book_id_account_id_key`(`book_id`, `account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `books` ADD CONSTRAINT `books_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `book_progress` ADD CONSTRAINT `book_progress_book_id_fkey` FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `book_progress` ADD CONSTRAINT `book_progress_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
