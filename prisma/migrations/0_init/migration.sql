-- CreateTable
CREATE TABLE `accounts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(64) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `display_name` VARCHAR(80) NOT NULL,
    `avatar_path` VARCHAR(255) NULL,
    `role` ENUM('user', 'admin') NOT NULL DEFAULT 'user',
    `theme` VARCHAR(32) NOT NULL DEFAULT 'wechat',
    `bible_preferences` JSON NULL,
    `can_pin_messages` BOOLEAN NOT NULL DEFAULT false,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `accounts_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_sessions` (
    `id` VARCHAR(64) NOT NULL,
    `account_id` INTEGER NOT NULL,
    `device_kind` ENUM('desktop', 'mobile', 'tablet') NOT NULL,
    `device_name` VARCHAR(120) NOT NULL,
    `user_agent` TEXT NULL,
    `ip_address` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,

    INDEX `account_sessions_account_id_device_kind_revoked_at_idx`(`account_id`, `device_kind`, `revoked_at`),
    INDEX `account_sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_login_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(32) NOT NULL,
    `account_id` INTEGER NOT NULL,
    `session_id` VARCHAR(64) NULL,
    `device_kind` VARCHAR(16) NULL,
    `device_name` VARCHAR(120) NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `account_login_logs_created_at_idx`(`created_at`),
    INDEX `account_login_logs_account_id_idx`(`account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_activity_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` VARCHAR(48) NOT NULL,
    `account_id` INTEGER NOT NULL,
    `session_id` VARCHAR(64) NULL,
    `channel_id` INTEGER NULL,
    `track_id` INTEGER NULL,
    `playback_id` CHAR(36) NULL,
    `device_kind` VARCHAR(16) NULL,
    `device_name` VARCHAR(120) NULL,
    `ip_address` VARCHAR(64) NULL,
    `user_agent` TEXT NULL,
    `app_version` VARCHAR(32) NULL,
    `latest_version` VARCHAR(32) NULL,
    `is_latest_version` BOOLEAN NULL,
    `event_state` VARCHAR(32) NULL,
    `progress_ms` INTEGER NULL,
    `listened_ms` INTEGER NULL,
    `duration_ms` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `account_activity_logs_created_at_idx`(`created_at`),
    INDEX `account_activity_logs_account_created_idx`(`account_id`, `created_at`),
    INDEX `account_activity_logs_kind_created_idx`(`kind`, `created_at`),
    INDEX `account_activity_logs_track_created_idx`(`track_id`, `created_at`),
    INDEX `account_activity_logs_playback_created_idx`(`playback_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `actors` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` ENUM('human', 'virtual', 'system') NOT NULL,
    `account_id` INTEGER NULL,
    `username` VARCHAR(80) NOT NULL,
    `display_name` VARCHAR(80) NOT NULL,
    `avatar_path` VARCHAR(255) NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `actors_account_id_key`(`account_id`),
    UNIQUE INDEX `actors_username_key`(`username`),
    INDEX `actors_kind_idx`(`kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `channels` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` ENUM('standard', 'direct', 'why', 'aiLounge', 'music') NOT NULL DEFAULT 'standard',
    `name` VARCHAR(80) NOT NULL,
    `description` VARCHAR(255) NOT NULL DEFAULT '',
    `icon` VARCHAR(16) NOT NULL DEFAULT '#',
    `is_private` BOOLEAN NOT NULL DEFAULT false,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `direct_key` VARCHAR(120) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `channels_direct_key_key`(`direct_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `channel_members` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `channel_id` INTEGER NOT NULL,
    `account_id` INTEGER NOT NULL,
    `role` ENUM('owner', 'admin', 'member', 'viewer') NOT NULL DEFAULT 'member',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `channel_members_channel_id_account_id_key`(`channel_id`, `account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `channel_notification_preferences` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `channel_id` INTEGER NOT NULL,
    `account_id` INTEGER NOT NULL,
    `muted` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `channel_notification_preferences_account_id_muted_idx`(`account_id`, `muted`),
    UNIQUE INDEX `channel_notification_preferences_channel_id_account_id_key`(`channel_id`, `account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `channel_id` INTEGER NOT NULL,
    `sender_actor_id` INTEGER NOT NULL,
    `content` TEXT NULL,
    `type` ENUM('text', 'image', 'file', 'music_playlist', 'chain', 'prayer', 'why_topic_card', 'system') NOT NULL DEFAULT 'text',
    `payload` JSON NULL,
    `file_name` VARCHAR(255) NULL,
    `file_path` VARCHAR(255) NULL,
    `file_size` INTEGER NULL,
    `reply_to_id` INTEGER NULL,
    `chain_root_id` INTEGER NULL,
    `chain_version` INTEGER NULL,
    `music_order` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `messages_channel_id_id_idx`(`channel_id`, `id`),
    INDEX `messages_reply_to_id_idx`(`reply_to_id`),
    INDEX `messages_chain_root_id_idx`(`chain_root_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `music_score_pages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `track_id` INTEGER NOT NULL,
    `page_index` INTEGER NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `file_path` VARCHAR(255) NOT NULL,
    `file_size` INTEGER NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `music_score_pages_file_path_key`(`file_path`),
    INDEX `music_score_pages_track_id_idx`(`track_id`),
    UNIQUE INDEX `music_score_pages_track_id_page_index_key`(`track_id`, `page_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `music_lyrics` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `track_id` INTEGER NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `music_lyrics_track_id_key`(`track_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `music_plays` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `track_id` INTEGER NOT NULL,
    `account_id` INTEGER NOT NULL,
    `playback_id` CHAR(36) NOT NULL,
    `duration_ms` INTEGER NOT NULL,
    `listened_ms` INTEGER NOT NULL,
    `qualified_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `music_plays_playback_id_key`(`playback_id`),
    INDEX `music_plays_track_id_qualified_at_idx`(`track_id`, `qualified_at`),
    INDEX `music_plays_account_id_qualified_at_idx`(`account_id`, `qualified_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `music_favorites` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `track_id` INTEGER NOT NULL,
    `account_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `music_favorites_account_id_created_at_idx`(`account_id`, `created_at`),
    UNIQUE INDEX `music_favorites_track_id_account_id_key`(`track_id`, `account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `music_playlists` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `account_id` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `music_playlists_account_id_updated_at_idx`(`account_id`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `music_playlist_tracks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `playlist_id` INTEGER NOT NULL,
    `track_id` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `music_playlist_tracks_track_id_idx`(`track_id`),
    UNIQUE INDEX `music_playlist_tracks_playlist_id_track_id_key`(`playlist_id`, `track_id`),
    UNIQUE INDEX `music_playlist_tracks_playlist_id_position_key`(`playlist_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `music_playlist_shares` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `playlist_id` INTEGER NOT NULL,
    `message_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `music_playlist_shares_message_id_key`(`message_id`),
    INDEX `music_playlist_shares_playlist_id_idx`(`playlist_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `music_playback_states` (
    `account_id` INTEGER NOT NULL,
    `source_kind` VARCHAR(16) NOT NULL DEFAULT 'library',
    `playlist_id` INTEGER NULL,
    `track_id` INTEGER NULL,
    `progress_ms` INTEGER NOT NULL DEFAULT 0,
    `playback_mode` VARCHAR(16) NOT NULL DEFAULT 'shuffle',
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `music_playback_states_playlist_id_idx`(`playlist_id`),
    INDEX `music_playback_states_track_id_idx`(`track_id`),
    PRIMARY KEY (`account_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_likes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `message_id` INTEGER NOT NULL,
    `account_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dismissed_at` DATETIME(3) NULL,

    INDEX `message_likes_account_id_created_at_idx`(`account_id`, `created_at`),
    INDEX `message_likes_dismissed_at_created_at_idx`(`dismissed_at`, `created_at`),
    UNIQUE INDEX `message_likes_message_id_account_id_key`(`message_id`, `account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_favorites` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `message_id` INTEGER NOT NULL,
    `account_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `message_favorites_account_id_created_at_idx`(`account_id`, `created_at`),
    UNIQUE INDEX `message_favorites_message_id_account_id_key`(`message_id`, `account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bible_favorites` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `account_id` INTEGER NOT NULL,
    `book_code` CHAR(3) NOT NULL,
    `chapter` INTEGER NOT NULL,
    `verse` INTEGER NOT NULL,
    `color` CHAR(7) NOT NULL DEFAULT '#f28b82',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bible_favorites_account_id_created_at_idx`(`account_id`, `created_at`),
    UNIQUE INDEX `bible_favorites_account_id_book_code_chapter_verse_key`(`account_id`, `book_code`, `chapter`, `verse`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `why_topics` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `owner_account_id` INTEGER NOT NULL,
    `channel_id` INTEGER NOT NULL,
    `source_channel_id` INTEGER NULL,
    `source_message_id` INTEGER NULL,
    `card_message_id` INTEGER NULL,
    `title` VARCHAR(160) NOT NULL,
    `summary` TEXT NOT NULL,
    `original_question` TEXT NOT NULL,
    `completion_note` TEXT NULL,
    `status` ENUM('active', 'completed', 'deleted') NOT NULL DEFAULT 'active',
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `why_topics_channel_id_key`(`channel_id`),
    UNIQUE INDEX `why_topics_card_message_id_key`(`card_message_id`),
    INDEX `why_topics_owner_account_id_status_updated_at_idx`(`owner_account_id`, `status`, `updated_at`),
    INDEX `why_topics_source_channel_id_created_at_idx`(`source_channel_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `why_topic_members` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `topic_id` INTEGER NOT NULL,
    `account_id` INTEGER NOT NULL,
    `role` ENUM('owner', 'member', 'requested') NOT NULL DEFAULT 'member',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `why_topic_members_account_id_role_idx`(`account_id`, `role`),
    UNIQUE INDEX `why_topic_members_topic_id_account_id_key`(`topic_id`, `account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `why_assistant_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `topic_id` INTEGER NOT NULL,
    `trigger_message_id` INTEGER NULL,
    `status` ENUM('pending', 'running', 'success', 'failed') NOT NULL DEFAULT 'pending',
    `prompt_text` TEXT NOT NULL,
    `context_text` TEXT NOT NULL,
    `response_text` TEXT NULL,
    `sources` JSON NULL,
    `error_text` TEXT NULL,
    `model` VARCHAR(120) NULL,
    `base_url` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `why_assistant_runs_topic_id_status_created_at_idx`(`topic_id`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `why_topic_reads` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `topic_id` INTEGER NOT NULL,
    `account_id` INTEGER NOT NULL,
    `last_read_message_id` INTEGER NULL,
    `read_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `why_topic_reads_account_id_read_at_idx`(`account_id`, `read_at`),
    UNIQUE INDEX `why_topic_reads_topic_id_account_id_key`(`topic_id`, `account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `voice_listens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `message_id` INTEGER NOT NULL,
    `account_id` INTEGER NOT NULL,
    `listened_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `voice_listens_account_id_listened_at_idx`(`account_id`, `listened_at`),
    UNIQUE INDEX `voice_listens_message_id_account_id_key`(`message_id`, `account_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prayer_actions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `message_id` INTEGER NOT NULL,
    `account_id` INTEGER NOT NULL,
    `prayed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `prayer_actions_message_id_prayed_at_idx`(`message_id`, `prayed_at`),
    INDEX `prayer_actions_account_id_prayed_at_idx`(`account_id`, `prayed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `message_ai_suggestions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `message_id` INTEGER NOT NULL,
    `kind` VARCHAR(64) NOT NULL DEFAULT 'prayer_related_verses',
    `status` VARCHAR(24) NOT NULL DEFAULT 'success',
    `prompt_command` TEXT NOT NULL,
    `context_text` TEXT NOT NULL,
    `response_text` TEXT NULL,
    `references` JSON NULL,
    `error_text` TEXT NULL,
    `model` VARCHAR(120) NULL,
    `base_url` VARCHAR(255) NULL,
    `created_by_account_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `message_ai_suggestions_message_id_kind_status_created_at_idx`(`message_id`, `kind`, `status`, `created_at`),
    INDEX `message_ai_suggestions_created_by_account_id_created_at_idx`(`created_by_account_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settings` (
    `key` VARCHAR(80) NOT NULL,
    `value` TEXT NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pinned_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `channel_id` INTEGER NOT NULL,
    `kind` ENUM('notice', 'message') NOT NULL,
    `title` VARCHAR(160) NULL,
    `content` TEXT NULL,
    `body` JSON NULL,
    `message_id` INTEGER NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `pinned_items_channel_id_active_idx`(`channel_id`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pinned_seens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `account_id` INTEGER NOT NULL,
    `channel_id` INTEGER NOT NULL,
    `pinned_item_id` INTEGER NOT NULL,
    `pinned_version` INTEGER NOT NULL,
    `seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `pinned_seens_account_id_channel_id_idx`(`account_id`, `channel_id`),
    UNIQUE INDEX `pinned_seens_account_id_pinned_item_id_pinned_version_key`(`account_id`, `pinned_item_id`, `pinned_version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `push_subscriptions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `account_id` INTEGER NOT NULL,
    `endpoint` VARCHAR(512) NOT NULL,
    `origin` VARCHAR(255) NOT NULL DEFAULT '',
    `keys_p256dh` VARCHAR(255) NOT NULL,
    `keys_auth` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `push_subscriptions_endpoint_key`(`endpoint`),
    INDEX `push_subscriptions_account_id_origin_idx`(`account_id`, `origin`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `virtual_characters` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actor_id` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `config` JSON NOT NULL,
    `state` JSON NULL,
    `engine_binding` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `virtual_characters_actor_id_key`(`actor_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `character_memories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `character_id` INTEGER NOT NULL,
    `subject_type` VARCHAR(32) NOT NULL,
    `subject_id` VARCHAR(80) NOT NULL,
    `content` TEXT NOT NULL,
    `confidence` DOUBLE NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `character_memories_character_id_subject_type_subject_id_idx`(`character_id`, `subject_type`, `subject_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `engine_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kind` ENUM('message_created', 'idle_tick', 'manual_test', 'active_topic_due') NOT NULL,
    `channel_id` INTEGER NULL,
    `message_id` INTEGER NULL,
    `character_id` INTEGER NULL,
    `payload` JSON NOT NULL,
    `claimed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `engine_events_id_kind_idx`(`id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `engine_actions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `event_id` INTEGER NULL,
    `idempotency_key` VARCHAR(120) NOT NULL,
    `action_type` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `result` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `engine_actions_idempotency_key_key`(`idempotency_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `account_id` INTEGER NULL,
    `action` VARCHAR(120) NOT NULL,
    `target` VARCHAR(120) NULL,
    `payload` JSON NULL,
    `ip` VARCHAR(80) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_account_id_created_at_idx`(`account_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `account_sessions` ADD CONSTRAINT `account_sessions_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `actors` ADD CONSTRAINT `actors_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `channel_members` ADD CONSTRAINT `channel_members_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `channel_members` ADD CONSTRAINT `channel_members_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `channel_notification_preferences` ADD CONSTRAINT `channel_notification_preferences_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `channel_notification_preferences` ADD CONSTRAINT `channel_notification_preferences_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_sender_actor_id_fkey` FOREIGN KEY (`sender_actor_id`) REFERENCES `actors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_reply_to_id_fkey` FOREIGN KEY (`reply_to_id`) REFERENCES `messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `music_score_pages` ADD CONSTRAINT `music_score_pages_track_id_fkey` FOREIGN KEY (`track_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `music_lyrics` ADD CONSTRAINT `music_lyrics_track_id_fkey` FOREIGN KEY (`track_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `music_plays` ADD CONSTRAINT `music_plays_track_id_fkey` FOREIGN KEY (`track_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `music_plays` ADD CONSTRAINT `music_plays_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `music_favorites` ADD CONSTRAINT `music_favorites_track_id_fkey` FOREIGN KEY (`track_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `music_favorites` ADD CONSTRAINT `music_favorites_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `music_playlists` ADD CONSTRAINT `music_playlists_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `music_playlist_tracks` ADD CONSTRAINT `music_playlist_tracks_playlist_id_fkey` FOREIGN KEY (`playlist_id`) REFERENCES `music_playlists`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `music_playlist_tracks` ADD CONSTRAINT `music_playlist_tracks_track_id_fkey` FOREIGN KEY (`track_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `music_playlist_shares` ADD CONSTRAINT `music_playlist_shares_playlist_id_fkey` FOREIGN KEY (`playlist_id`) REFERENCES `music_playlists`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `music_playlist_shares` ADD CONSTRAINT `music_playlist_shares_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `music_playback_states` ADD CONSTRAINT `music_playback_states_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `music_playback_states` ADD CONSTRAINT `music_playback_states_playlist_id_fkey` FOREIGN KEY (`playlist_id`) REFERENCES `music_playlists`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `music_playback_states` ADD CONSTRAINT `music_playback_states_track_id_fkey` FOREIGN KEY (`track_id`) REFERENCES `messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_likes` ADD CONSTRAINT `message_likes_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_likes` ADD CONSTRAINT `message_likes_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_favorites` ADD CONSTRAINT `message_favorites_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_favorites` ADD CONSTRAINT `message_favorites_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bible_favorites` ADD CONSTRAINT `bible_favorites_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `why_topic_members` ADD CONSTRAINT `why_topic_members_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `why_topics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `why_assistant_runs` ADD CONSTRAINT `why_assistant_runs_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `why_topics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `why_topic_reads` ADD CONSTRAINT `why_topic_reads_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `why_topics`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `why_topic_reads` ADD CONSTRAINT `why_topic_reads_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `why_topic_reads` ADD CONSTRAINT `why_topic_reads_last_read_message_id_fkey` FOREIGN KEY (`last_read_message_id`) REFERENCES `messages`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voice_listens` ADD CONSTRAINT `voice_listens_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voice_listens` ADD CONSTRAINT `voice_listens_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prayer_actions` ADD CONSTRAINT `prayer_actions_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prayer_actions` ADD CONSTRAINT `prayer_actions_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_ai_suggestions` ADD CONSTRAINT `message_ai_suggestions_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_ai_suggestions` ADD CONSTRAINT `message_ai_suggestions_created_by_account_id_fkey` FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pinned_items` ADD CONSTRAINT `pinned_items_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pinned_seens` ADD CONSTRAINT `pinned_seens_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `pinned_seens` ADD CONSTRAINT `pinned_seens_pinned_item_id_fkey` FOREIGN KEY (`pinned_item_id`) REFERENCES `pinned_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `virtual_characters` ADD CONSTRAINT `virtual_characters_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `character_memories` ADD CONSTRAINT `character_memories_character_id_fkey` FOREIGN KEY (`character_id`) REFERENCES `virtual_characters`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `engine_actions` ADD CONSTRAINT `engine_actions_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `engine_events`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
