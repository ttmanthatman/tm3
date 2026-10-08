/*
  Warnings:

  - A unique constraint covering the columns `[account_id,client_request_id]` on the table `story_comments` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `story_comments` ADD COLUMN `client_request_id` VARCHAR(36) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `story_comments_account_id_client_request_id_key` ON `story_comments`(`account_id`, `client_request_id`);
