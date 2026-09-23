-- AlterTable
ALTER TABLE `messages` MODIFY `type` ENUM('text', 'image', 'file', 'music_playlist', 'chain', 'prayer', 'grace', 'sermon_request', 'why_topic_card', 'bible_session', 'chat_record', 'handwriting', 'system') NOT NULL DEFAULT 'text';
