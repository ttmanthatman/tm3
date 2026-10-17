-- AlterTable
ALTER TABLE `book_progress` ADD COLUMN `last_mutation_id` VARCHAR(64) NULL,
    ADD COLUMN `locator` JSON NULL,
    ADD COLUMN `locator_revision` INTEGER NULL,
    ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `books` ADD COLUMN `publication_revision` CHAR(64) NULL;
