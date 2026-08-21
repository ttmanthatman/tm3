-- AlterTable
ALTER TABLE `channels` ADD COLUMN `list_color` CHAR(7) NULL;

-- CreateTable
CREATE TABLE `channel_reads` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `channel_id` INTEGER NOT NULL,
    `account_id` INTEGER NOT NULL,
    `last_read_message_id` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `channel_reads_account_id_updated_at_idx`(`account_id`, `updated_at`),
    UNIQUE INDEX `channel_reads_channel_id_account_id_key`(`channel_id`, `account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `channel_reads` ADD CONSTRAINT `channel_reads_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `channel_reads` ADD CONSTRAINT `channel_reads_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
