<script setup lang="ts">
import { MessageSquareQuote, Sparkles, X } from "lucide-vue-next";
import type { GraceFavoriteDTO } from "@shared/types";
import AvatarImage from "../../components/ui/AvatarImage.vue";
import { adminDate } from "../admin/adminFormat";
import GraceCard from "./GraceCard.vue";

defineProps<{
  favorites: GraceFavoriteDTO[];
  loading: boolean;
  avatarText: (name: string) => string;
}>();

const emit = defineEmits<{
  remove: [favorite: GraceFavoriteDTO];
  open: [favorite: GraceFavoriteDTO];
  "open-image": [favorite: GraceFavoriteDTO, imageMessageId: number, event: MouseEvent];
}>();
</script>

<template>
  <div class="messages-viewport favorites-viewport grace-favorites-viewport">
    <div class="favorites-main-scroll">
      <div class="favorites-main-head grace-favorites-main-head">
        <span class="favorites-main-icon grace-favorites-main-icon"><Sparkles :size="22" /></span>
        <div>
          <strong>恩典收藏</strong>
          <small>自动收录自己发出的恩典卡；长按别人的恩典卡并点爱心，也会收藏到这里。</small>
        </div>
      </div>
      <p v-if="loading" class="favorites-empty">正在加载恩典收藏…</p>
      <p v-else-if="!favorites.length" class="favorites-empty">还没有恩典卡。可以从消息输入框右边的“+”开始记录。</p>
      <div v-else class="favorites-main-list grace-favorites-list">
        <article v-for="favorite in favorites" :key="favorite.id" class="favorite-message-card grace-favorite-card">
          <header class="favorite-message-head">
            <div class="avatar" :class="{ bot: favorite.message.sender.kind === 'virtual' }">
              <AvatarImage :path="favorite.message.sender.avatarPath"><span>{{ avatarText(favorite.message.sender.displayName) }}</span></AvatarImage>
            </div>
            <div>
              <strong>{{ favorite.message.sender.displayName }}</strong>
              <small>{{ favorite.channel.name }} · {{ favorite.own ? "自动收录" : `收藏于 ${adminDate(favorite.savedAt)}` }}</small>
            </div>
            <button
              v-if="!favorite.own && favorite.favorited"
              class="favorite-remove"
              type="button"
              aria-label="取消收藏这张恩典卡"
              @click="emit('remove', favorite)"
            ><X :size="16" /></button>
          </header>
          <div class="grace-favorite-card-content">
            <GraceCard
              :message="favorite.message"
              @open-image="(imageMessageId, event) => emit('open-image', favorite, imageMessageId, event)"
            />
          </div>
          <footer class="favorite-message-actions">
            <span>{{ favorite.own ? "我发出的恩典" : "收藏的恩典" }}</span>
            <button class="mini-btn secondary" type="button" @click="emit('open', favorite)"><MessageSquareQuote :size="15" />查看上下文</button>
          </footer>
        </article>
      </div>
    </div>
  </div>
</template>
