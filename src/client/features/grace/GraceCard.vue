<script setup lang="ts">
import { computed } from "vue";
import { Bell, CheckCircle2, Sparkles, Trash2 } from "lucide-vue-next";
import type { AiSuggestionDTO, BibleLookupDTO, MessageDTO } from "@shared/types";
import { getToken } from "../../api";
import { useChatStore } from "../../store";
import AvatarImage from "../../components/ui/AvatarImage.vue";
import InlineAudioPlayer from "../../components/InlineAudioPlayer.vue";
import VoiceTranscript from "../voice/VoiceTranscript.vue";
import { adminDate } from "../admin/adminFormat";
import RelatedVersesPanel from "../prayer/RelatedVersesPanel.vue";
import { gracePayload } from "./useGrace";

// 频道消息流与恩典收藏共用的恩典卡片。
const props = withDefaults(defineProps<{
  message: MessageDTO;
  interactive?: boolean;
  mine?: boolean;
  canUpdate?: boolean;
  actionText?: string;
  latestTime?: string;
  aiSuggestions?: AiSuggestionDTO[];
  aiSuggestionCount?: number;
  aiLimitReached?: boolean;
  aiExpanded?: boolean;
  aiBusy?: boolean;
  aiError?: string;
  isReferenceExpanded?: (scope: string | number, reference: string) => boolean;
  isReferenceBusy?: (scope: string | number, reference: string) => boolean;
  referenceLookup?: (scope: string | number, reference: string) => BibleLookupDTO | null | undefined;
  formatLookup?: (lookup: BibleLookupDTO | null | undefined, reference: string) => string;
}>(), {
  interactive: true,
  mine: false,
  canUpdate: false,
  actionText: "还没有人为此感恩",
  latestTime: "",
  aiSuggestions: () => [],
  aiSuggestionCount: 0,
  aiLimitReached: false,
  aiExpanded: false,
  aiBusy: false,
  aiError: "",
  isReferenceExpanded: () => false,
  isReferenceBusy: () => false,
  referenceLookup: () => undefined,
  formatLookup: () => ""
});

const emit = defineEmits<{
  "open-image": [imageMessageId: number, event: MouseEvent];
  grateful: [];
  update: [];
  withdraw: [];
  "toggle-ai": [];
  "generate-ai": [];
  "toggle-reference": [scope: string | number, reference: string];
  "open-reference": [scope: string | number, reference: string];
}>();

const store = useChatStore();
const payload = computed(() => gracePayload(props.message));

// 语音本体是当前频道里的一条语音消息：优先复用消息列表里已加载的那条
// （这样 socket 推送的 transcript 能响应式更新），未加载时退化为按 id 直链播放。
const voiceMessage = computed<MessageDTO | null>(() => {
  const id = payload.value.voiceMessageId;
  if (!id) return null;
  const existing = store.messages.find((row) => row.id === id);
  if (existing) return existing;
  return {
    id,
    channelId: props.message.channelId,
    sender: props.message.sender,
    content: "",
    type: "file",
    payload: { kind: "voice" },
    fileName: "恩典语音",
    createdAt: props.message.createdAt
  } as MessageDTO;
});
const voiceSrc = computed(() => (voiceMessage.value ? `/api/files/${voiceMessage.value.id}?token=${encodeURIComponent(getToken())}` : ""));
const imageUrl = computed(() => (payload.value.imageMessageId ? `/api/files/${payload.value.imageMessageId}?token=${encodeURIComponent(getToken())}` : ""));

function imageUrlFor(imageMessageId: number) {
  return `/api/files/${imageMessageId}?token=${encodeURIComponent(getToken())}`;
}

function avatarText(name: string) {
  return name.trim().slice(0, 1) || "?";
}
</script>

<template>
  <div class="prayer-card grace-card" @click.stop>
    <div class="prayer-card-head grace-card-head">
      <span><Sparkles :size="17" /></span>
      <strong>数算恩典</strong>
      <em>恩典见证</em>
    </div>
    <div v-if="message.content" class="grace-card-text" v-html="message.content"></div>
    <div v-if="voiceMessage" class="grace-voice-capsule">
      <InlineAudioPlayer :message="voiceMessage" :src="voiceSrc" />
      <VoiceTranscript :message="voiceMessage" />
    </div>
    <button
      v-if="payload.imageMessageId"
      class="image-preview-button grace-card-photo"
      type="button"
      aria-label="查看恩典照片"
      @click.stop="emit('open-image', payload.imageMessageId!, $event)"
    >
      <img class="chat-image" :src="imageUrl" alt="恩典记录附带照片" loading="lazy" />
    </button>
    <div v-if="payload.updates?.length" class="prayer-updates grace-updates">
      <div v-for="(entry, index) in payload.updates" :key="index" class="prayer-update-entry">
        <small>{{ adminDate(entry.at) }}<template v-if="entry.by"> · {{ entry.by }}</template></small>
        <div class="prayer-text grace-card-text" v-html="entry.content"></div>
        <button v-if="entry.imageMessageId" class="image-preview-button prayer-image grace-card-photo" type="button" @click.stop="emit('open-image', entry.imageMessageId, $event)">
          <img class="chat-image" :src="imageUrlFor(entry.imageMessageId)" alt="历史见证附带照片" loading="lazy" />
        </button>
      </div>
    </div>
    <div v-if="interactive" class="prayer-stats grace-stats">
      <strong>已有 {{ payload.gratitudeCount }} 人为此感恩</strong>
      <small>{{ actionText }}<template v-if="latestTime"> · 最近 {{ latestTime }}</template></small>
    </div>
    <div v-if="interactive && payload.gratefulBy.length" class="prayer-people" aria-label="感恩成员">
      <span v-for="person in payload.gratefulBy.slice(0, 6)" :key="person.accountId" class="mini-avatar" :title="`${person.displayName} · ${person.times} 次`">
        <AvatarImage :path="person.avatarPath"><span>{{ avatarText(person.displayName) }}</span></AvatarImage>
      </span>
    </div>
    <div v-if="interactive" class="prayer-actions">
      <button class="mini-btn" @click.stop="emit('grateful')"><CheckCircle2 :size="15" />为此感恩</button>
      <button v-if="canUpdate" class="mini-btn secondary" @click.stop="emit('update')"><Bell :size="15" />更新见证</button>
      <button v-if="mine" class="mini-btn danger-soft" @click.stop="emit('withdraw')"><Trash2 :size="15" />撤回</button>
    </div>
    <RelatedVersesPanel
      v-if="interactive"
      :suggestions="aiSuggestions"
      :suggestion-count="aiSuggestionCount"
      :limit-reached="aiLimitReached"
      :expanded="aiExpanded"
      :busy="aiBusy"
      :error="aiError"
      :is-reference-expanded="isReferenceExpanded"
      :is-reference-busy="isReferenceBusy"
      :reference-lookup="referenceLookup"
      :format-lookup="formatLookup"
      @toggle="emit('toggle-ai')"
      @generate="emit('generate-ai')"
      @toggle-reference="(scope, reference) => emit('toggle-reference', scope, reference)"
      @open-reference="(scope, reference) => emit('open-reference', scope, reference)"
    />
  </div>
</template>
