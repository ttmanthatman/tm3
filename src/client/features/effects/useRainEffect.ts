import { nextTick, onBeforeUnmount, ref } from "vue";
import type { MessageDTO, MessageEffect } from "@shared/types";
import { clamp } from "./effectShared";
import { createEffectClock, EFFECT_MAX_DPR } from "./effectRendering";
import { useEffectActivity } from "./useEffectActivity";

type RainDrop = { x: number; y: number; length: number; speed: number; sway: number; shade: number };

interface UseRainEffectOptions {
  messageEffect: (message: MessageDTO) => MessageEffect | null;
  enabled?: () => boolean;
}

export function useRainEffect(options: UseRainEffectOptions) {
  const rainCanvas = ref<HTMLCanvasElement | null>(null);
  const rainActive = ref(false);
  let rainAnimationFrame: number | undefined;
  let rainUntil = 0;
  let rainDrops: RainDrop[] = [];
  const clock = createEffectClock();
  let resizeObserver: ResizeObserver | undefined;
  let sizeDirty = true;
  let width = 1;
  let height = 1;
  const invalidateSize = () => { sizeDirty = true; };
  const rainDurationMs = 15_000;
  const playedRainEffectIds = new Set<number>();

  function triggerOneShotMessageEffects(message: MessageDTO) {
    if (options.messageEffect(message) === "rain") void startRainForMessage(message.id);
  }

  function hydratePlayedRainEffectIds() {
    playedRainEffectIds.clear();
    for (const id of readPlayedRainEffectIds()) playedRainEffectIds.add(id);
  }

  function readPlayedRainEffectIds() {
    try {
      return JSON.parse(localStorage.getItem("team-chat-played-rain-effects") || "[]")
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isFinite(value) && value > 0)
        .slice(-180);
    } catch {
      return [];
    }
  }

  function persistPlayedRainEffectIds() {
    try {
      localStorage.setItem("team-chat-played-rain-effects", JSON.stringify([...playedRainEffectIds].slice(-180)));
    } catch {
      // Private browsing or quota limits should not block chat effects.
    }
  }

  async function startRainForMessage(messageId: number) {
    if (messageId <= 0 || playedRainEffectIds.has(messageId)) return;
    playedRainEffectIds.add(messageId);
    persistPlayedRainEffectIds();
    if (!activity.active.value || rainActive.value) return;
    rainActive.value = true;
    rainUntil = performance.now() + rainDurationMs;
    await nextTick();
    const canvas = rainCanvas.value;
    if (!canvas || !activity.active.value || !rainActive.value) {
      stopRainEffect();
      return;
    }
    sizeDirty = true;
    resizeObserver = new ResizeObserver(invalidateSize);
    resizeObserver.observe(canvas);
    window.addEventListener("resize", invalidateSize, { passive: true });
    clock.reset();
    rainDrops = [];
    rainAnimationFrame = requestAnimationFrame(drawRainFrame);
  }

  function stopRainEffect() {
    if (rainAnimationFrame) window.cancelAnimationFrame(rainAnimationFrame);
    rainAnimationFrame = undefined;
    rainActive.value = false;
    rainUntil = 0;
    rainDrops = [];
    clock.reset();
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    window.removeEventListener("resize", invalidateSize);
    const canvas = rainCanvas.value;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawRainFrame(now: number) {
    const canvas = rainCanvas.value;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !activity.active.value || now >= rainUntil) {
      stopRainEffect();
      return;
    }
    const dt = clock.advance(now);
    if (dt === null) { rainAnimationFrame = requestAnimationFrame(drawRainFrame); return; }
    const dpr = Math.min(EFFECT_MAX_DPR, window.devicePixelRatio || 1);
    if (sizeDirty) {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      sizeDirty = false;
    }
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      rainDrops = [];
    }
    if (!rainDrops.length) rainDrops = makeRainDrops(width, height);
    const remaining = clamp((rainUntil - now) / rainDurationMs, 0, 1);
    context.clearRect(0, 0, width, height);
    context.fillStyle = `rgba(12, 24, 38, ${0.12 * Math.min(1, remaining + 0.35)})`;
    context.fillRect(0, 0, width, height);
    context.lineCap = "round";
    for (const drop of rainDrops) {
      drop.y += drop.speed * dt * 60;
      drop.x += drop.sway * dt * 60;
      if (drop.y > height + drop.length) {
        drop.y = -drop.length - Math.random() * height * 0.45;
        drop.x = Math.random() * width;
      }
      if (drop.x > width + 28) drop.x = -28;
      if (drop.x < -28) drop.x = width + 28;
    }
    for (let shade = 0; shade < 3; shade += 1) {
      context.globalAlpha = (0.28 + shade * 0.2) * Math.min(1, remaining * 1.7);
      context.lineWidth = 0.7 + shade * 0.55;
      context.strokeStyle = "#d9f2ff";
      context.beginPath();
      for (const drop of rainDrops) {
        if (drop.shade !== shade) continue;
        context.moveTo(drop.x, drop.y);
        context.lineTo(drop.x - drop.length * 0.25, drop.y + drop.length);
      }
      context.stroke();
    }
    context.globalAlpha = 1;
    rainAnimationFrame = requestAnimationFrame(drawRainFrame);
  }

  function makeRainDrops(width: number, height: number): RainDrop[] {
    const count = Math.min(96, Math.max(40, Math.floor((width * height) / 9000)));
    return Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height - height,
      length: 13 + Math.random() * 24,
      speed: 9 + Math.random() * 15,
      sway: -1.9 - Math.random() * 1.4,
      shade: Math.floor(Math.random() * 3)
    }));
  }

  const activity = useEffectActivity({ enabled: options.enabled, onChange: (active) => { if (!active) stopRainEffect(); } });
  onBeforeUnmount(() => stopRainEffect());

  return {
    rainCanvas,
    rainActive,
    hydratePlayedRainEffectIds,
    stopRainEffect,
    triggerOneShotMessageEffects
  };
}
