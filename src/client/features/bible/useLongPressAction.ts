import { onScopeDispose } from "vue";

// 播放按钮长按（520ms，移动 10px 内有效）：触发动作并抑制随后这一次 click，
// 与聊天消息长按菜单同一套阈值。纯 pointer 事件，触屏与鼠标通用。
export function useLongPressAction(action: () => void, delayMs = 520) {
  let timer: number | undefined;
  let startedAt = { x: 0, y: 0 };
  let suppressClick = false;

  function clear() {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  }

  function down(event: PointerEvent) {
    if (event.button !== 0) return;
    startedAt = { x: event.clientX, y: event.clientY };
    suppressClick = false;
    clear();
    timer = window.setTimeout(() => {
      timer = undefined;
      suppressClick = true;
      action();
      navigator.vibrate?.(12);
    }, delayMs);
  }

  function move(event: PointerEvent) {
    if (timer === undefined) return;
    if (Math.hypot(event.clientX - startedAt.x, event.clientY - startedAt.y) > 10) clear();
  }

  /** 长按刚触发过则吞掉本次 click（返回 true），否则放行。 */
  function consumeClick() {
    if (!suppressClick) return false;
    suppressClick = false;
    return true;
  }

  onScopeDispose(clear);
  return { down, move, clear, consumeClick };
}
