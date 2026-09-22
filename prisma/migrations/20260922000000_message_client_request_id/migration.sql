-- AlterTable
ALTER TABLE `messages` ADD COLUMN `client_request_hash` CHAR(64) NULL,
    ADD COLUMN `client_request_id` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `messages_sender_actor_id_client_request_id_key` ON `messages`(`sender_actor_id`, `client_request_id`);
