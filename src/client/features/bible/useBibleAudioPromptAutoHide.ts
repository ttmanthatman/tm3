import { getCurrentScope, onScopeDispose, ref, watch } from "vue";

export const BIBLE_AUDIO_PROMPT_REAPPEAR_MS = 5000;

// 聊天顶端提词器的「点一下让路」：播放中点聊天区任意非提词器处就临时收起，
// 5 秒内没有再点击就自己回来；期间会话与朗读照常进行。暂停态的点击另有含义
// （结束会话，见 App.vue handleBibleAudioPromptDismiss），不经这里。
export function useBibleAudioPromptAutoHide(options: { sessionActive: () => boolean; delayMs?: number }) {
  const hidden = ref(false);
  const delayMs = options.delayMs ?? BIBLE_AUDIO_PROMPT_REAPPEAR_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function reset() {
    clearTimer();
    hidden.value = false;
  }

  /** 连续点击只把 5 秒窗口往后推，不会叠加多个计时器 */
  function collapse() {
    hidden.value = true;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      hidden.value = false;
    }, delayMs);
  }

  // 会话结束就清计时并复位，下一次会话从第一句起可见；不等计时器自然到期
  watch(options.sessionActive, (active) => { if (!active) reset(); }, { flush: "sync" });
  if (getCurrentScope()) onScopeDispose(reset);

  return { hidden, collapse, reset };
}
