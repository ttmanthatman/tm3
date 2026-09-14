<script setup lang="ts">
import { LockKeyhole, LogOut, Upload, Users, WandSparkles, X } from "lucide-vue-next";
import type { ChannelDTO } from "@shared/types";
import ChannelIcon from "../../components/ui/ChannelIcon.vue";
import {
  canEditChannel,
  canLeaveChannel,
  canSubmitChannelDraft,
  type ChannelDraft
} from "../../channelManagement";

defineProps<{
  mode: "create" | "edit";
  channel: ChannelDTO | null;
  busy: boolean;
  msg: string;
  leaveBusy: boolean;
  title: string;
  subtitle: string;
  twoPersonDirect: boolean;
  groupDirect: boolean;
  nameSuggestions: string[];
  nameSuggestionBusy: boolean;
}>();

const emit = defineEmits<{
  close: [];
  submit: [];
  uploadIcon: [event: Event];
  suggestNames: [];
  openMembers: [];
  leave: [];
  closeDirect: [channel: ChannelDTO | null];
}>();

const draft = defineModel<ChannelDraft>("draft", { required: true });
</script>

<template>
  <section class="modal-shell" @click.self="emit('close')">
    <form class="small-modal channel-editor-modal" @submit.prevent="emit('submit')">
      <header class="modal-head">
        <div>
          <strong>{{ title }}</strong>
          <small>{{ subtitle }}</small>
        </div>
        <button
          class="icon-btn"
          type="button"
          :disabled="busy"
          @click="emit('close')"
          aria-label="关闭频道设置"
        >
          <X :size="20" />
        </button>
      </header>
      <div class="form-grid modal-form channel-editor-form">
        <div v-if="twoPersonDirect && canEditChannel(channel)" class="direct-chat-follow-note">
          <span class="direct-chat-follow-icon"><LockKeyhole :size="18" /></span>
          <span>
            <strong>显示对方的资料</strong>
            <small>双人私聊的名称和图标会自动跟随对方的昵称与头像。</small>
          </span>
        </div>
        <template v-if="mode === 'edit' && channel && !twoPersonDirect && canEditChannel(channel)">
          <label>频道图标</label>
          <label
            class="channel-editor-icon-picker upload-icon-trigger"
            :aria-label="`上传 ${channel.name} 的频道图标`"
            title="点击上传图标"
          >
            <ChannelIcon :icon="channel.icon" :kind="channel.kind" />
            <span><Upload :size="15" />更换图标</span>
            <input
              class="hidden"
              type="file"
              accept="image/*"
              :disabled="busy"
              @change="emit('uploadIcon', $event)"
            />
          </label>
        </template>
        <template v-if="!twoPersonDirect && (mode === 'create' || canEditChannel(channel))">
          <label class="channel-name-label">
            <span>频道名称</span>
            <button
              v-if="groupDirect"
              class="text-action"
              type="button"
              :disabled="nameSuggestionBusy"
              @click="emit('suggestNames')"
            >
              <WandSparkles :size="14" />{{ nameSuggestionBusy ? "正在想..." : "换一个" }}
            </button>
          </label>
          <input v-model="draft.name" maxlength="80" autocomplete="off" placeholder="频道名" />
          <div
            v-if="groupDirect && nameSuggestions.length"
            class="direct-name-suggestions"
            aria-label="私聊名称备选"
          >
            <button
              v-for="suggestion in nameSuggestions"
              :key="suggestion"
              class="direct-name-option"
              :class="{ selected: draft.name === suggestion }"
              type="button"
              @click="draft.name = suggestion"
            >
              {{ suggestion }}
            </button>
          </div>
          <label>频道描述</label>
          <textarea
            v-model="draft.description"
            maxlength="255"
            rows="3"
            placeholder="描述"
          ></textarea>
        </template>
        <label v-if="mode === 'create'" class="check-row check-row-inline">
          <input v-model="draft.isPrivate" type="checkbox" />
          <span>私密频道</span>
        </label>
        <label
          v-if="mode === 'create' || canEditChannel(channel)"
          class="check-row check-row-inline"
        >
          <input v-model="draft.useListColor" type="checkbox" />
          <span>自定义频道列表底色</span>
        </label>
        <label
          v-if="draft.useListColor && (mode === 'create' || canEditChannel(channel))"
          class="channel-list-color-field"
        >
          <span>列表底色</span>
          <input v-model="draft.listColor" type="color" aria-label="频道列表底色" />
          <code>{{ draft.listColor }}</code>
        </label>
        <p v-if="msg" class="form-error">{{ msg }}</p>
        <div
          v-if="mode === 'edit' && channel && !canEditChannel(channel)"
          class="direct-chat-follow-note"
        >
          <span class="direct-chat-follow-icon"><LockKeyhole :size="18" /></span>
          <span>
            <strong>{{ channel.name }}</strong>
            <small>{{ channel.description || "私密频道" }}</small>
          </span>
        </div>
        <div class="confirm-actions channel-editor-actions">
          <button
            v-if="mode === 'edit' && canEditChannel(channel)"
            class="mini-btn secondary"
            type="button"
            :disabled="busy"
            @click="emit('openMembers')"
          >
            <Users :size="15" />成员
          </button>
          <button
            v-if="mode === 'edit' && canLeaveChannel(channel)"
            class="mini-btn danger-action"
            type="button"
            :disabled="busy || leaveBusy"
            @click="emit('leave')"
          >
            <LogOut :size="15" />退出频道
          </button>
          <button
            v-if="mode === 'edit' && channel?.directKey"
            class="mini-btn danger-action"
            type="button"
            :disabled="busy"
            @click="emit('closeDirect', channel)"
          >
            <X :size="15" />关闭私聊
          </button>
          <button class="mini-btn secondary" type="button" :disabled="busy" @click="emit('close')">
            {{ mode === "edit" && !canEditChannel(channel) ? "关闭" : "取消" }}
          </button>
          <button
            v-if="mode === 'create' || canEditChannel(channel)"
            class="primary-btn"
            type="submit"
            :disabled="!canSubmitChannelDraft(draft, busy)"
          >
            {{ busy ? "保存中..." : mode === "create" ? "创建" : "保存" }}
          </button>
        </div>
      </div>
    </form>
  </section>
</template>
