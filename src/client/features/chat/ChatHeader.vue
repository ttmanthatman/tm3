<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount } from "vue";
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  Ellipsis,
  Library,
  PanelLeftOpen,
  Pin,
  Sparkles,
  Settings,
  Trash2,
  Users,
  X
} from "lucide-vue-next";
import type { ChannelDTO, MusicPlaylistDTO, MusicTrackDTO, PinnedDTO } from "@shared/types";
import OverflowMarquee from "../../components/OverflowMarquee.vue";
import ActivityTicker from "../../components/ActivityTicker.vue";
import AppMenu from "../../components/AppMenu.vue";
import AppMenuItem from "../../components/AppMenuItem.vue";
import SermonHub from "../sermon/SermonHub.vue";
import type { MusicPlayer } from "../music/useMusicPlayer";
import type { MusicSleepTimer } from "../music/useMusicSleepTimer";

const MusicMiniPanel = defineAsyncComponent(() => import("../music/MusicMiniPanel.vue"));

// Presentation-only home of the chat header and the pinned/activity notice
// stack, moved verbatim from App.vue. Interactive state stays in App.vue and
// arrives as props; the three flags the template toggles directly are v-model
// pairs.
const showChannels = defineModel<boolean>("showChannels", { required: true });
const channelsCollapsed = defineModel<boolean>("channelsCollapsed", { required: true });
const musicPlayerExpanded = defineModel<boolean>("musicPlayerExpanded", { required: true });

const props = defineProps<{
  otherChannelUnreadCount: number;
  notificationAttentionVisible: boolean;
  notificationNudgeCharacters: readonly string[];
  showBibleFavorites: boolean;
  showGraceFavorites: boolean;
  showFavorites: boolean;
  prayerOnly: boolean;
  graceOnly: boolean;
  currentChannel: ChannelDTO | null;
  chatSubtitleText: string;
  showingFavoriteSurface: boolean;
  musicPlaying: boolean;
  musicPlayer: MusicPlayer;
  favoriteMusicTracks: MusicTrackDTO[];
  musicPlaylists: MusicPlaylistDTO[];
  musicSleepTimer: MusicSleepTimer;
  musicPanelFontSize: number;
  friendProgramsOpen: boolean;
  friendPlaying: boolean;
  canOpenOwnStory: boolean;
  storyAttention: boolean;
  musicScoreTriggerVisible: boolean;
  musicScoreOpen: boolean;
  canDeleteCurrentChannel: boolean;
  showChatToolsMenu: boolean;
  messageFontSize: number;
  minMessageFontSize: number;
  maxMessageFontSize: number;
  messageSelectionMode: boolean;
  isAdmin: boolean;
  visiblePinned: PinnedDTO | null;
  activityTickerText: string;
  activityStatusItems: string[];
  pinnedText: string;
  pinnedTickerBody: string;
  canPinCurrentChannel: boolean;
  handleChatHeaderInteraction: () => void;
  formatUnreadCount: (count: number) => string;
  openNotificationPrompt: () => void;
  openBibleWorkspace: () => void;
  openBookWorkspace: () => void;
  openMusicPlayer: () => void;
  toggleCurrentMusicFavorite: () => void;
  openMusicManagerFromMiniPanel: () => void;
  toggleFriendPrograms: () => void;
  openOwnStory: () => void;
  openSharedStories: () => void;
  toggleMusicScore: () => void;
  requestCloseChannel: () => void;
  deleteChannel: (channel: ChannelDTO) => void;
  toggleChatToolsMenu: () => void;
  adjustMessageFontSize: (delta: number) => void;
  toggleCurrentMemberPane: () => void;
  toggleMessageSelectionMode: () => void;
  loadAdmin: () => void;
  openPinnedFromTicker: () => void;
  openPinnedEditor: () => void;
}>();

let storyHoldTimer: number | null = null;
let storyLongPressed = false;
function clearStoryHold() {
  if (storyHoldTimer !== null) window.clearTimeout(storyHoldTimer);
  storyHoldTimer = null;
}
function beginStoryHold(event: PointerEvent) {
  if (event.button !== 0 || !props.canOpenOwnStory) return;
  clearStoryHold();
  storyLongPressed = false;
  storyHoldTimer = window.setTimeout(() => {
    storyHoldTimer = null;
    storyLongPressed = true;
    props.openOwnStory();
  }, 550);
}
function openStoryFromClick() {
  clearStoryHold();
  if (storyLongPressed) { storyLongPressed = false; return; }
  props.openSharedStories();
}
onBeforeUnmount(clearStoryHold);
</script>

<template>
  <header class="chat-head" @pointerdown="handleChatHeaderInteraction">
    <button
      class="icon-btn mobile-only channel-mobile-trigger"
      @click="showChannels = true"
      :aria-label="otherChannelUnreadCount > 0 ? `频道，其他频道有 ${otherChannelUnreadCount} 条未读消息` : '频道'"
    >
      <span v-if="otherChannelUnreadCount > 0" class="channel-mobile-unread">{{ formatUnreadCount(otherChannelUnreadCount) }}</span>
      <ChevronLeft v-else :size="22" />
    </button>
    <button v-if="channelsCollapsed" class="icon-btn desktop-only" @click="channelsCollapsed = false" aria-label="展开频道"><PanelLeftOpen :size="20" /></button>
    <div class="chat-title">
      <div class="chat-title-line">
        <button
          v-if="notificationAttentionVisible"
          class="notification-nudge"
          type="button"
          aria-label="请打开通知"
          @click="openNotificationPrompt"
        >
          <span class="notification-nudge-characters" aria-hidden="true">
            <span
              v-for="(character, index) in notificationNudgeCharacters"
              :key="character"
              class="notification-nudge-character"
              :style="{ '--notification-char-index': index }"
            >{{ character }}</span>
          </span>
        </button>
        <strong data-testid="active-channel-name">{{ showBibleFavorites ? "经文收藏" : showGraceFavorites ? "恩典收藏" : showFavorites ? "收藏夹" : prayerOnly ? `${currentChannel?.name || "聊天室"} · 代祷事项` : graceOnly ? `${currentChannel?.name || "聊天室"} · 数算恩典` : currentChannel?.name || "聊天室" }}</strong>
      </div>
      <OverflowMarquee v-if="chatSubtitleText" :text="chatSubtitleText" />
    </div>
    <button v-if="!showingFavoriteSurface" class="icon-btn bible-header-trigger" type="button" @click="openBibleWorkspace" aria-label="打开圣经" title="圣经"><BookOpen :size="20" /></button>
    <button v-if="!showingFavoriteSurface" class="icon-btn book-header-trigger" type="button" @click="openBookWorkspace" aria-label="打开图书室" title="图书室"><Library :size="20" /></button>
    <SermonHub v-if="!showingFavoriteSurface" />
    <div v-if="!showingFavoriteSurface" class="music-player-control" data-music-player>
      <button class="icon-btn music-player-trigger" type="button" :class="{ spinning: musicPlaying }" @click.stop="openMusicPlayer()" aria-label="打开音乐播放器">
        <span class="music-player-glyph" aria-hidden="true">歌</span>
      </button>
      <MusicMiniPanel
        v-if="musicPlayerExpanded"
        :player="musicPlayer"
        :favorite-tracks="favoriteMusicTracks"
        :playlists="musicPlaylists"
        :sleep-timer="musicSleepTimer"
        :font-size="musicPanelFontSize"
        @close="musicPlayerExpanded = false"
        @toggle-favorite="toggleCurrentMusicFavorite"
        @open-manager="openMusicManagerFromMiniPanel"
      />
    </div>
    <div v-if="!showingFavoriteSurface" class="friend-player-control">
      <button class="icon-btn friend-player-trigger" type="button" :class="{ active: friendProgramsOpen, spinning: friendPlaying }" @click.stop="toggleFriendPrograms" aria-label="打开良友节目">
        <span class="music-player-glyph friend-player-glyph" aria-hidden="true">友</span>
      </button>
    </div>
    <button
      v-if="!showingFavoriteSurface"
      class="icon-btn story-header-trigger"
      :class="{ 'has-story-attention': storyAttention }"
      type="button"
      :disabled="!canOpenOwnStory"
      aria-label="我们的故事，长按查看我的故事"
      title="我们的故事（长按查看我的故事）"
      @pointerdown.stop="beginStoryHold"
      @pointerup.stop="clearStoryHold"
      @pointercancel.stop="clearStoryHold"
      @pointerleave="clearStoryHold"
      @contextmenu.prevent
      @click.stop="openStoryFromClick"
    ><Sparkles :size="20" /></button>
    <button
      v-if="!showingFavoriteSurface && musicScoreTriggerVisible"
      class="icon-btn message-font-trigger music-score-trigger"
      :class="{ active: musicScoreOpen, 'page-turning': musicPlaying }"
      type="button"
      aria-label="打开或关闭歌谱"
      :aria-expanded="musicScoreOpen"
      @click.stop="toggleMusicScore"
    >
      <span class="message-font-glyph music-score-page-glyph" aria-hidden="true">谱</span>
    </button>
    <button v-if="!showingFavoriteSurface && currentChannel?.directKey" class="icon-btn" @click="requestCloseChannel()" aria-label="关闭私聊"><X :size="20" /></button>
    <button v-if="!showingFavoriteSurface && canDeleteCurrentChannel" class="icon-btn danger" @click="currentChannel && deleteChannel(currentChannel)" aria-label="删除频道"><Trash2 :size="19" /></button>
    <div v-if="!showingFavoriteSurface" class="chat-tools-control" data-chat-tools-menu>
      <button
        class="icon-btn chat-tools-trigger"
        type="button"
        :class="{ active: showChatToolsMenu }"
        aria-label="更多管理功能"
        :aria-expanded="showChatToolsMenu"
        @click.stop="toggleChatToolsMenu"
      ><Ellipsis :size="22" /></button>
      <AppMenu v-if="showChatToolsMenu" class="chat-tools-menu" label="聊天管理功能" @click.stop>
        <div class="chat-tools-font-row" role="group" :aria-label="`消息字体大小，当前 ${messageFontSize} 号`">
          <span class="chat-tools-font-label">字号调节</span>
          <button type="button" :disabled="messageFontSize <= minMessageFontSize" aria-label="减小消息字体" @click="adjustMessageFontSize(-1)">小</button>
          <output :aria-label="`当前消息字号 ${messageFontSize} 像素`" aria-live="polite">{{ messageFontSize }}</output>
          <button type="button" :disabled="messageFontSize >= maxMessageFontSize" aria-label="增大消息字体" @click="adjustMessageFontSize(1)">大</button>
        </div>
        <AppMenuItem @click="toggleCurrentMemberPane"><Users :size="17" /><span>成员列表</span></AppMenuItem>
        <AppMenuItem :active="messageSelectionMode" @click="toggleMessageSelectionMode"><CheckCircle2 :size="17" /><span>{{ messageSelectionMode ? "退出消息多选" : "消息多选" }}</span></AppMenuItem>
        <AppMenuItem v-if="isAdmin" @click="loadAdmin"><Settings :size="17" /><span>系统设置</span></AppMenuItem>
      </AppMenu>
    </div>
  </header>

  <section
    v-if="!showingFavoriteSurface && (visiblePinned || activityTickerText)"
    class="chat-notice-stack"
    :class="{ 'has-pinned': !!visiblePinned, 'has-activity': !!activityTickerText }"
    :role="visiblePinned ? 'button' : undefined"
    :tabindex="visiblePinned ? 0 : undefined"
    :aria-label="visiblePinned ? '查看置顶消息' : '聊天室实时动态'"
    @click="openPinnedFromTicker"
    @keydown.enter="openPinnedFromTicker"
    @keydown.space.prevent="openPinnedFromTicker"
  >
    <span v-if="visiblePinned" class="pinned-ticker-row">
      <span class="pinned-ticker-icon" aria-hidden="true"><Pin :size="14" /></span>
      <span class="pinned-ticker-viewport">
        <span class="pinned-ticker-track">
          <strong>{{ pinnedText }}</strong>
          <span v-if="pinnedTickerBody">{{ pinnedTickerBody }}</span>
        </span>
      </span>
      <button
        v-if="canPinCurrentChannel"
        type="button"
        class="pinned-ticker-action pinned-ticker-edit"
        aria-label="编辑置顶消息"
        @click.stop="openPinnedEditor"
        @keydown.enter.stop
        @keydown.space.stop
      >编辑</button>
      <span v-else class="pinned-ticker-action">查看</span>
    </span>
    <span v-if="activityTickerText" class="chat-activity-ticker" aria-label="聊天室实时动态" aria-live="polite">
      <ActivityTicker :items="activityStatusItems" />
    </span>
  </section>
</template>

<style scoped>
.story-header-trigger.has-story-attention { color: #d85f73; background: linear-gradient(135deg, #ffe16b55, #ff86ad44 52%, #72c7ff44); box-shadow: inset 0 0 0 1px #e985a966, 0 0 12px #f0af6380; }
.story-header-trigger.has-story-attention :deep(svg) { fill: #ffd66b88; stroke: #d75678; }
</style>
