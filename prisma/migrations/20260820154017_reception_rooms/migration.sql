/*
  Warnings:

  - A unique constraint covering the columns `[reception_token_hash]` on the table `channels` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `accounts` ADD COLUMN `guest_expires_at` DATETIME(3) NULL,
    ADD COLUMN `is_guest` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `channels` ADD COLUMN `reception_expires_at` DATETIME(3) NULL,
    ADD COLUMN `reception_owner_account_id` INTEGER NULL,
    ADD COLUMN `reception_token_hash` CHAR(64) NULL,
    MODIFY `kind` ENUM('standard', 'direct', 'reception', 'why', 'aiLounge', 'music') NOT NULL DEFAULT 'standard';

-- CreateIndex
CREATE UNIQUE INDEX `channels_reception_token_hash_key` ON `channels`(`reception_token_hash`);
