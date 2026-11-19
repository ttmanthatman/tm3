-- AlterTable
ALTER TABLE `books` ADD COLUMN `deleted_at` DATETIME(3) NULL,
    ADD COLUMN `is_published` BOOLEAN NOT NULL DEFAULT true;
