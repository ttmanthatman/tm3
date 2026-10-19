-- CreateTable
CREATE TABLE `bible_audio_versions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `versionId` VARCHAR(40) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `language` VARCHAR(16) NOT NULL,
    `dialect` VARCHAR(16) NULL,
    `style` VARCHAR(24) NULL,
    `translation` VARCHAR(30) NOT NULL,
    `copyright` TEXT NOT NULL,
    `bookCount` INTEGER NOT NULL DEFAULT 0,
    `chapterCount` INTEGER NOT NULL DEFAULT 0,
    `totalBytes` BIGINT NOT NULL DEFAULT 0,
    `completed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bible_audio_versions_versionId_key`(`versionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bible_audio_chapters` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `versionId` INTEGER NOT NULL,
    `book_code` VARCHAR(3) NOT NULL,
    `chapter` INTEGER NOT NULL,
    `fileName` VARCHAR(64) NOT NULL,
    `bytes` BIGINT NOT NULL,
    `md5` CHAR(32) NOT NULL,
    `duration_ms` INTEGER NOT NULL,
    `verses` JSON NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `bible_audio_chapters_versionId_book_code_idx`(`versionId`, `book_code`),
    UNIQUE INDEX `bible_audio_chapters_versionId_book_code_chapter_key`(`versionId`, `book_code`, `chapter`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bible_audio_chapters` ADD CONSTRAINT `bible_audio_chapters_versionId_fkey` FOREIGN KEY (`versionId`) REFERENCES `bible_audio_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
