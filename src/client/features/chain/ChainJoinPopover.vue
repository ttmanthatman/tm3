<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ArrowLeft, Check, X } from "lucide-vue-next";
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
const selectedOptionIds = ref<string[]>([]);
const popoverElement = ref<HTMLElement | null>(null);
const positionStyle = ref<Record<string, string>>({ left: "12px", top: "12px", visibility: "hidden" });
let positionFrame: number | undefined;
let resizeObserver: ResizeObserver | undefined;

watch(
  () => props.message.id,
  () => {
    stage.value = "confirm";
    customText.value = "";
    selectedOptionIds.value = [];
    nextTick(schedulePositionUpdate);
  },
  { immediate: true }
);

const payload = computed(() => chainPayload(props.message));
const requiresSelection = computed(() => chainRequiresSelection(props.message));
const allowsMultiple = computed(() => payload.value.participation?.mode === "required_multiple_choice");
const selectedCount = computed(() => selectedOptionIds.value.length + (customText.value.trim() ? 1 : 0));

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
  if (!allowsMultiple.value) {
    emit("join", { kind: "option", optionId });
    return;
  }
  selectedOptionIds.value = selectedOptionIds.value.includes(optionId)
    ? selectedOptionIds.value.filter((id) => id !== optionId)
    : [...selectedOptionIds.value, optionId];
}

function joinCustom() {
  const text = customText.value.trim();
  if (!text) return;
  if (allowsMultiple.value) {
    customText.value = text;
    stage.value = "options";
    return;
  }
  emit("join", { kind: "custom", text });
}

function clearCustomSelection() {
  customText.value = "";
  stage.value = "options";
}

function joinMultiple() {
  const customValue = customText.value.trim();
  if (!selectedOptionIds.value.length && !customValue) return;
  emit("join", {
    kind: "multiple",
    optionIds: [...selectedOptionIds.value],
    ...(customValue ? { customText: customValue } : {})
  });
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
        <header class="tap-popover-head chain-join-head" :class="{ 'has-back': stage === 'custom' }">
          <button v-if="stage === 'custom'" class="icon-btn" type="button" :disabled="busy" aria-label="返回项目列表" @click="stage = 'options'">
            <ArrowLeft :size="18" />
          </button>
          <strong>{{ stage === 'custom' ? '填写其他' : (allowsMultiple ? '请选择（可多选）' : '请选择') }}</strong>
          <button class="icon-btn" type="button" :disabled="busy" aria-label="关闭项目选择" @click="emit('close')"><X :size="18" /></button>
        </header>

        <div v-if="stage === 'options'" class="chain-choice-list">
          <button
            v-for="option in payload.participation?.options || []"
            :key="option.id"
            class="chain-choice-btn"
            :class="{ selected: selectedOptionIds.includes(option.id) }"
            type="button"
            :disabled="busy"
            :aria-pressed="allowsMultiple ? selectedOptionIds.includes(option.id) : undefined"
            @click="joinOption(option.id)"
          >
            <span>{{ option.label }}</span>
            <Check v-if="allowsMultiple && selectedOptionIds.includes(option.id)" :size="17" aria-hidden="true" />
          </button>
          <button class="chain-choice-btn" :class="{ selected: !!customText.trim() }" type="button" :disabled="busy" :aria-pressed="allowsMultiple ? !!customText.trim() : undefined" @click="stage = 'custom'">
            <span>{{ customText.trim() ? `其他：${customText.trim()}` : '其他' }}</span>
            <Check v-if="allowsMultiple && customText.trim()" :size="17" aria-hidden="true" />
          </button>
          <button v-if="allowsMultiple" class="primary-btn chain-multi-submit" type="button" :disabled="busy || selectedCount === 0" @click="joinMultiple">
            {{ busy ? '正在接龙…' : `参与接龙${selectedCount ? `（${selectedCount}项）` : ''}` }}
          </button>
        </div>

        <form v-else class="chain-custom-form" @submit.prevent="joinCustom">
          <input v-model="customText" maxlength="40" autocomplete="off" autofocus placeholder="填写具体项目" />
          <div class="chain-custom-actions">
            <button v-if="allowsMultiple && customText.trim()" class="mini-btn secondary" type="button" :disabled="busy" @click="clearCustomSelection">移除</button>
            <button class="primary-btn" type="submit" :disabled="busy || !customText.trim()">{{ busy ? "正在接龙…" : (allowsMultiple ? "保存" : "参与接龙") }}</button>
          </div>
        </form>

      </template>
      <p v-if="error" class="chain-join-error" role="alert">{{ error }}</p>
    </div>
  </section>
</template>

<style scoped>
.chain-join-popover {
  width: max-content;
  min-width: min(240px, calc(100vw - 24px));
  max-width: min(320px, calc(100vw - 24px));
}

.tap-popover-card,
.chain-join-head {
  color: var(--text);
  background: var(--panel);
}

.tap-popover-card {
  border-radius: 12px;
  box-shadow: 0 18px 46px rgba(15, 23, 42, 0.22), 0 2px 8px rgba(15, 23, 42, 0.08);
}

.chain-join-popover.stage-confirm {
  width: max-content;
}

.chain-join-head {
  min-height: 46px;
  gap: 8px;
  padding-left: 14px;
}

.chain-join-head strong {
  min-width: 0;
  font-size: 15px;
  white-space: nowrap;
}

.chain-join-head > .icon-btn:last-child {
  margin-left: auto;
}

.chain-choice-list,
.chain-custom-form {
  padding: 10px 12px 12px;
  display: grid;
  gap: 8px;
}

.chain-choice-btn {
  min-height: 42px;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 8px 11px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text);
  background: var(--panel);
  font-weight: 650;
  text-align: left;
  transition: border-color 120ms ease, background-color 120ms ease, color 120ms ease;
}

.chain-choice-btn:hover,
.chain-choice-btn:focus-visible {
  border-color: color-mix(in srgb, var(--accent) 42%, var(--line));
  background: color-mix(in srgb, var(--accent) 5%, var(--panel));
}

.chain-choice-btn.selected {
  border-color: color-mix(in srgb, var(--accent) 72%, var(--line));
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--panel));
}

.chain-choice-btn span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.chain-choice-btn svg {
  flex: 0 0 auto;
}

.chain-custom-form input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 12px;
  color: var(--text);
  background: var(--bubble-other);
}

.chain-custom-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.chain-multi-submit {
  margin-top: 2px;
}

.chain-join-error {
  margin: 0;
  padding: 0 10px 10px;
  color: #b42318;
  font-size: 13px;
  text-align: center;
}

@media (max-width: 560px) {
  .chain-choice-list {
    max-height: min(52vh, 380px);
    overflow-y: auto;
  }
}
</style>
