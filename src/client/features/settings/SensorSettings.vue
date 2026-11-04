<script setup lang="ts">
import { computed } from "vue";
import { bottleMotion } from "../social/bottleMotion";
const description = computed(() => ({
  idle: "频道里有漂流瓶时会自动尝试启用摇晃感应。",
  waiting: "浏览器需要点击授权，可在这里启用运动与方向感应。",
  enabled: "已启用。摇晃或倾斜手机，漂流瓶就会随之移动。",
  denied: "尚未获得权限。漂流瓶仍会自然沉积，可在浏览器设置中允许后重试。",
  unsupported: "当前浏览器暂不支持运动感应，漂流瓶仍会自然沉积。",
  disabled: "已关闭本次浏览的摇晃感应，漂流瓶仍会自然沉积。",
  error: "暂时无法启用运动感应，请检查浏览器权限后重试。"
}[bottleMotion.status.value]));
</script>
<template>
  <section class="form-grid settings-section sensor-settings">
    <div class="settings-section-head"><strong>运动与方向感应</strong><small>感应只用于让漂流瓶随手机移动，不会上传传感器数据。</small></div>
    <div class="notification-card">
      <div role="status">{{ description }}</div>
      <button v-if="!bottleMotion.enabled.value" type="button" class="primary-btn" :disabled="bottleMotion.busy.value || bottleMotion.status.value === 'unsupported'" @click="bottleMotion.request()">{{ bottleMotion.busy.value ? '正在请求授权…' : '授权运动传感器' }}</button>
      <button v-else type="button" class="mini-btn secondary" @click="bottleMotion.disable()">关闭摇晃感应</button>
    </div>
  </section>
</template>
