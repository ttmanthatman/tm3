-- AlterTable
ALTER TABLE `messages` MODIFY `type` ENUM('text', 'image', 'file', 'music_playlist', 'chain', 'prayer', 'sermon_request', 'why_topic_card', 'bible_session', 'system') NOT NULL DEFAULT 'text';
