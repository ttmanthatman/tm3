<script setup lang="ts">
import { Bell, X } from "lucide-vue-next";

defineProps<{
  nudgeLevel: "bell" | "muted" | "sleep";
  nudgeIcon: string;
  enabled: boolean;
  permissionLabel: string;
  hint: string;
  busy: boolean;
  supported: boolean;
  permission: string;
  msg: string;
}>();

const emit = defineEmits<{
  close: [];
  sendTest: [];
  enable: [];
  moreSettings: [];
}>();
</script>

<template>
  <section class="modal-shell" @click.self="emit('close')">
    <div class="small-modal notification-check-modal">
      <header class="modal-head">
        <strong>通知体检</strong>
        <button class="icon-btn" @click="emit('close')" aria-label="关闭通知体检">
          <X :size="18" />
        </button>
      </header>
      <div class="notification-check-body">
        <span class="notification-check-bell" :class="`level-${nudgeLevel}`" aria-hidden="true">{{
          nudgeIcon
        }}</span>
        <div>
          <strong>{{ enabled ? "通知已经开启" : "还没有开启通知" }}</strong>
          <small>权限：{{ permissionLabel }}</small>
        </div>
        <p>{{ hint }}</p>
        <div class="notification-check-actions">
          <button v-if="enabled" class="primary-btn" :disabled="busy" @click="emit('sendTest')">
            <Bell :size="16" />发送测试通知
          </button>
          <button
            v-else
            class="primary-btn"
            :disabled="busy || !supported || permission === 'denied'"
            @click="emit('enable')"
          >
            <Bell :size="16" />开启通知
          </button>
          <button class="mini-btn secondary" :disabled="busy" @click="emit('moreSettings')">
            更多设置
          </button>
        </div>
        <p v-if="msg" class="settings-note">{{ msg }}</p>
      </div>
    </div>
  </section>
</template>
