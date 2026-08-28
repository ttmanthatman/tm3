-- AlterTable
ALTER TABLE `accounts` ADD COLUMN `sermon_presenter_until` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `messages` MODIFY `type` ENUM('text', 'image', 'file', 'music_playlist', 'chain', 'prayer', 'sermon_request', 'why_topic_card', 'system') NOT NULL DEFAULT 'text';
