import { nextTick, onBeforeUnmount, ref } from "vue";
import type { MessageDTO, MessageEffect } from "@shared/types";
import { clamp } from "./effectShared";

type RainDrop = { x: number; y: number; length: number; speed: number; width: number; sway: number; alpha: number };

interface UseRainEffectOptions {
  messageEffect: (message: MessageDTO) => MessageEffect | null;
}

export function useRainEffect(options: UseRainEffectOptions) {
  const rainCanvas = ref<HTMLCanvasElement | null>(null);
  const rainActive = ref(false);
  let rainAnimationFrame: number | undefined;
  let rainUntil = 0;
  let rainDrops: RainDrop[] = [];
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
    if (rainActive.value) return;
    rainActive.value = true;
    rainUntil = performance.now() + rainDurationMs;
    await nextTick();
    const canvas = rainCanvas.value;
    if (!canvas) {
      rainActive.value = false;
      return;
    }
    rainDrops = [];
    rainAnimationFrame = requestAnimationFrame(drawRainFrame);
  }

  function stopRainEffect() {
    if (rainAnimationFrame) window.cancelAnimationFrame(rainAnimationFrame);
    rainAnimationFrame = undefined;
    rainActive.value = false;
    rainUntil = 0;
    rainDrops = [];
    const canvas = rainCanvas.value;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawRainFrame(now: number) {
    const canvas = rainCanvas.value;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || now >= rainUntil) {
      stopRainEffect();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
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
      drop.y += drop.speed;
      drop.x += drop.sway;
      if (drop.y > height + drop.length) {
        drop.y = -drop.length - Math.random() * height * 0.45;
        drop.x = Math.random() * width;
      }
      if (drop.x > width + 28) drop.x = -28;
      if (drop.x < -28) drop.x = width + 28;
      context.globalAlpha = drop.alpha * Math.min(1, remaining * 1.7);
      context.lineWidth = drop.width;
      context.strokeStyle = "#d9f2ff";
      context.beginPath();
      context.moveTo(drop.x, drop.y);
      context.lineTo(drop.x - drop.length * 0.25, drop.y + drop.length);
      context.stroke();
    }
    context.globalAlpha = 1;
    rainAnimationFrame = requestAnimationFrame(drawRainFrame);
  }

  function makeRainDrops(width: number, height: number): RainDrop[] {
    const count = Math.min(260, Math.max(110, Math.floor((width * height) / 3200)));
    return Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height - height,
      length: 13 + Math.random() * 24,
      speed: 9 + Math.random() * 15,
      width: 0.7 + Math.random() * 1.3,
      sway: -1.9 - Math.random() * 1.4,
      alpha: 0.28 + Math.random() * 0.52
    }));
  }

  onBeforeUnmount(() => stopRainEffect());

  return {
    rainCanvas,
    rainActive,
    hydratePlayedRainEffectIds,
    stopRainEffect,
    triggerOneShotMessageEffects
  };
}
