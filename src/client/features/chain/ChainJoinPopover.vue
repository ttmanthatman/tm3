<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ArrowLeft, X } from "lucide-vue-next";
import type { ChainSelectionInput, MessageDTO } from "../../../shared/types";
import { chainPayload, chainRequiresSelection } from "./chain";
import { positionChainPopover, type ChainPopoverRect } from "./chainPopoverPosition";

const props = defineProps<{
  message: MessageDTO;
  anchorElement?: HTMLElement | null;
  busy: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  close: [];
  join: [selection?: ChainSelectionInput];
}>();

const stage = ref<"confirm" | "options" | "custom">("confirm");
const customText = ref("");
const popoverElement = ref<HTMLElement | null>(null);
const positionStyle = ref<Record<string, string>>({ left: "12px", top: "12px", visibility: "hidden" });
let positionFrame: number | undefined;
let resizeObserver: ResizeObserver | undefined;

watch(
  () => props.message.id,
  () => {
    stage.value = "confirm";
    customText.value = "";
    nextTick(schedulePositionUpdate);
  },
  { immediate: true }
);

const payload = computed(() => chainPayload(props.message));
const requiresSelection = computed(() => chainRequiresSelection(props.message));

function anchorRect(viewport: { left: number; top: number; right: number; bottom: number }): ChainPopoverRect {
  const rect = props.anchorElement?.isConnected ? props.anchorElement.getBoundingClientRect() : null;
  if (rect?.width && rect.height) {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    };
  }
  const x = viewport.left + (viewport.right - viewport.left) / 2;
  const y = viewport.top + (viewport.bottom - viewport.top) / 2;
  return { left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
}

function updatePosition() {
  const element = popoverElement.value;
  if (!element) return;
  const visualViewport = window.visualViewport;
  const viewportLeft = visualViewport?.offsetLeft || 0;
  const viewportTop = visualViewport?.offsetTop || 0;
  const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-top")) || 0;
  const safeBottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-bottom")) || 0;
  const viewport = {
    left: viewportLeft,
    top: viewportTop + safeTop,
    right: viewportLeft + (visualViewport?.width || window.innerWidth),
    bottom: viewportTop + (visualViewport?.height || window.innerHeight) - safeBottom
  };
  const rect = element.getBoundingClientRect();
  const position = positionChainPopover(anchorRect(viewport), { width: rect.width, height: rect.height }, viewport);
  positionStyle.value = { left: `${position.x}px`, top: `${position.y}px`, visibility: "visible" };
}

function schedulePositionUpdate() {
  if (positionFrame !== undefined) window.cancelAnimationFrame(positionFrame);
  positionFrame = window.requestAnimationFrame(() => {
    positionFrame = undefined;
    updatePosition();
  });
}

watch(stage, () => nextTick(schedulePositionUpdate));
watch(
  () => props.anchorElement,
  (anchor, previousAnchor) => {
    if (previousAnchor) resizeObserver?.unobserve(previousAnchor);
    if (anchor) resizeObserver?.observe(anchor);
    nextTick(schedulePositionUpdate);
  }
);

onMounted(() => {
  resizeObserver = new ResizeObserver(schedulePositionUpdate);
  if (popoverElement.value) resizeObserver.observe(popoverElement.value);
  if (props.anchorElement) resizeObserver.observe(props.anchorElement);
  document.addEventListener("scroll", schedulePositionUpdate, true);
  window.addEventListener("resize", schedulePositionUpdate, { passive: true });
  window.visualViewport?.addEventListener("resize", schedulePositionUpdate, { passive: true });
  window.visualViewport?.addEventListener("scroll", schedulePositionUpdate, { passive: true });
  schedulePositionUpdate();
});

onBeforeUnmount(() => {
  if (positionFrame !== undefined) window.cancelAnimationFrame(positionFrame);
  resizeObserver?.disconnect();
  document.removeEventListener("scroll", schedulePositionUpdate, true);
  window.removeEventListener("resize", schedulePositionUpdate);
  window.visualViewport?.removeEventListener("resize", schedulePositionUpdate);
  window.visualViewport?.removeEventListener("scroll", schedulePositionUpdate);
});

function confirmJoin() {
  if (requiresSelection.value) {
    stage.value = "options";
    return;
  }
  emit("join");
}

function joinOption(optionId: string) {
  emit("join", { kind: "option", optionId });
}

function joinCustom() {
  const text = customText.value.trim();
  if (!text) return;
  emit("join", { kind: "custom", text });
}
</script>

<template>
  <section ref="popoverElement" class="tap-popover chain-join-popover" :class="`stage-${stage}`" :style="positionStyle" data-chain-popover>
    <div class="tap-popover-card">
      <div v-if="stage === 'confirm'" class="compact-confirm">
        <span>确认接龙？</span>
        <div class="compact-actions">
          <button class="mini-btn secondary" type="button" :disabled="busy" @click="emit('close')">否</button>
          <button class="mini-btn" type="button" :disabled="busy" @click="confirmJoin">是</button>
        </div>
      </div>

      <template v-else>
        <header class="tap-popover-head chain-join-head">
          <button v-if="stage === 'custom'" class="icon-btn" type="button" :disabled="busy" aria-label="返回项目列表" @click="stage = 'options'">
            <ArrowLeft :size="18" />
          </button>
          <strong>{{ stage === 'custom' ? '填写其他项目' : '选择具体项目' }}</strong>
          <button class="icon-btn" type="button" :disabled="busy" aria-label="关闭项目选择" @click="emit('close')"><X :size="18" /></button>
        </header>

        <div v-if="stage === 'options'" class="chain-choice-list">
          <button
            v-for="option in payload.participation?.options || []"
            :key="option.id"
            class="chain-choice-btn"
            type="button"
            :disabled="busy"
            @click="joinOption(option.id)"
          >{{ option.label }}</button>
          <button class="chain-choice-btn" type="button" :disabled="busy" @click="stage = 'custom'">其他</button>
          <small>选择一项后会立即参与接龙。</small>
        </div>

        <form v-else class="chain-custom-form" @submit.prevent="joinCustom">
          <input v-model="customText" maxlength="40" autocomplete="off" autofocus placeholder="填写具体项目" />
          <button class="primary-btn" type="submit" :disabled="busy || !customText.trim()">{{ busy ? "正在接龙…" : "参与接龙" }}</button>
        </form>

      </template>
      <p v-if="error" class="chain-join-error" role="alert">{{ error }}</p>
    </div>
  </section>
</template>

<style scoped>
.chain-join-popover {
  width: min(320px, calc(100vw - 24px));
}

.tap-popover-card,
.chain-join-head {
  color: var(--text);
  background: var(--panel);
}

.chain-join-popover.stage-confirm {
  width: max-content;
}

.chain-join-head {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 32px;
  gap: 6px;
  text-align: center;
}

.chain-join-head strong {
  align-self: center;
}

.chain-choice-list,
.chain-custom-form {
  padding: 10px;
  display: grid;
  gap: 8px;
}

.chain-choice-btn {
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px 12px;
  color: var(--text);
  background: var(--panel);
  font-weight: 650;
  text-align: left;
}

.chain-choice-btn:active {
  background: var(--line);
}

.chain-choice-list > small {
  color: var(--muted);
  text-align: center;
}

.chain-custom-form input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 12px;
  color: var(--text);
  background: var(--bubble-other);
}

.chain-join-error {
  margin: 0;
  padding: 0 10px 10px;
  color: #b42318;
  font-size: 13px;
  text-align: center;
}

@media (max-width: 560px) {
  .chain-join-popover:not(.stage-confirm) {
    inset: auto 8px max(8px, calc(var(--safe-bottom) + 8px)) 8px !important;
    width: auto;
    max-width: none;
  }

  .chain-choice-list {
    max-height: min(52vh, 380px);
    overflow-y: auto;
  }
}
</style>
