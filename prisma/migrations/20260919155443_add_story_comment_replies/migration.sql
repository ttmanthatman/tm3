-- AlterTable
ALTER TABLE `story_comments` ADD COLUMN `reply_to_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `story_comments_reply_to_id_idx` ON `story_comments`(`reply_to_id`);

-- AddForeignKey
ALTER TABLE `story_comments` ADD CONSTRAINT `story_comments_reply_to_id_fkey` FOREIGN KEY (`reply_to_id`) REFERENCES `story_comments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
