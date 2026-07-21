/*
  Warnings:

  - The column `track_id` on the `music_score_pages` table is dropped after its data is migrated
    into the new `music_scores` table (one score per track, titled by the track file name).
  - A unique constraint covering the columns `[score_id,page_index]` on the table `music_score_pages` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE `music_scores` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `track_id` INTEGER NULL,
    `title` VARCHAR(255) NOT NULL,
    `uploaded_by_account_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `music_scores_track_id_idx`(`track_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable (add the new column as nullable first so existing pages can be backfilled)
ALTER TABLE `music_score_pages` ADD COLUMN `score_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `music_lyrics` ADD COLUMN `uploaded_by_account_id` INTEGER NULL,
    MODIFY `track_id` INTEGER NULL;

-- DataMigration: create one score per track that has score pages, titled by the track file name without extension
INSERT INTO `music_scores` (`track_id`, `title`, `uploaded_by_account_id`, `created_at`, `updated_at`)
SELECT page_groups.track_id,
    COALESCE(
        NULLIF(TRIM(
            CASE
                WHEN LOCATE('.', track_messages.file_name) = 0 THEN track_messages.file_name
                ELSE LEFT(track_messages.file_name, CHAR_LENGTH(track_messages.file_name) - CHAR_LENGTH(SUBSTRING_INDEX(track_messages.file_name, '.', -1)) - 1)
            END
        ), ''),
        '歌谱'
    ),
    NULL,
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
FROM (SELECT DISTINCT `track_id` FROM `music_score_pages`) AS page_groups
JOIN `messages` AS track_messages ON track_messages.`id` = page_groups.track_id;

-- DataMigration: attach existing pages to their new score
UPDATE `music_score_pages` AS pages
JOIN `music_scores` AS scores ON scores.`track_id` = pages.`track_id`
SET pages.`score_id` = scores.`id`;

-- DropForeignKey
ALTER TABLE `music_score_pages` DROP FOREIGN KEY `music_score_pages_track_id_fkey`;

-- DropIndex
DROP INDEX `music_score_pages_track_id_idx` ON `music_score_pages`;

-- DropIndex
DROP INDEX `music_score_pages_track_id_page_index_key` ON `music_score_pages`;

-- AlterTable (drop the migrated column and require the backfilled one)
ALTER TABLE `music_score_pages` DROP COLUMN `track_id`,
    MODIFY `score_id` INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX `music_score_pages_score_id_idx` ON `music_score_pages`(`score_id`);

-- CreateIndex
CREATE UNIQUE INDEX `music_score_pages_score_id_page_index_key` ON `music_score_pages`(`score_id`, `page_index`);

-- AddForeignKey
ALTER TABLE `music_scores` ADD CONSTRAINT `music_scores_track_id_fkey` FOREIGN KEY (`track_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `music_score_pages` ADD CONSTRAINT `music_score_pages_score_id_fkey` FOREIGN KEY (`score_id`) REFERENCES `music_scores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
