import { computed, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import type { MessageDTO, MessageEffect, MessageEffectPayload } from "@shared/types";
import { clamp, type GravityVector } from "./effectShared";

interface UseWaterRippleEffectOptions {
  messages: () => MessageDTO[];
  messageEffect: (message: MessageDTO) => MessageEffect | null;
  isMessageEffectPaused: (message: MessageDTO) => boolean;
  documentVisible: Ref<boolean>;
}

export function useWaterRippleEffect(options: UseWaterRippleEffectOptions) {
  const waterTilt = ref({ x: 0, y: 0 });
  let deviceGravity: GravityVector = { x: 0, y: 1, strength: 1 };
  let deviceOrientationPermissionRequested = false;

  const orientationEffectsVisible = computed(() => options.messages().some((message) => {
    const effect = String((message.payload as MessageEffectPayload | undefined)?.effect || "");
    return ["water", "drip", "dripGooey"].includes(effect) && !options.isMessageEffectPaused(message);
  }));
  const waterEffectVisible = computed(() => options.messages().some((message) => (
    String((message.payload as MessageEffectPayload | undefined)?.effect || "") === "water" && !options.isMessageEffectPaused(message)
  )));

  function handleDeviceOrientation(event: DeviceOrientationEvent) {
    if (!options.documentVisible.value || !orientationEffectsVisible.value) return;
    const gamma = Number.isFinite(event.gamma) ? Number(event.gamma) : 0;
    const beta = Number.isFinite(event.beta) ? Number(event.beta) : 0;
    if (waterEffectVisible.value) {
      waterTilt.value = {
        x: clamp(gamma, -36, 36) * 0.42,
        y: clamp(beta - 35, -42, 42) * 0.28
      };
    }
    deviceGravity = screenGravityFromOrientation(beta, gamma);
  }

  function screenGravityFromOrientation(beta: number, gamma: number): GravityVector {
    const radians = Math.PI / 180;
    const rawX = Math.sin(clamp(gamma, -90, 90) * radians) * 0.62;
    const rawY = Math.sin(clamp(beta, -90, 90) * radians);
    const angle = typeof screen !== "undefined" && screen.orientation ? screen.orientation.angle : Number((window as unknown as { orientation?: number }).orientation || 0);
    const rotation = -angle * radians;
    const projectedX = rawX * Math.cos(rotation) - rawY * Math.sin(rotation);
    const projectedY = rawX * Math.sin(rotation) + rawY * Math.cos(rotation);
    const projectedLength = Math.hypot(projectedX, projectedY);
    const visualDownBias = 0.58 * (1 - clamp(projectedLength * 1.35, 0, 1));
    const x = projectedX;
    const y = projectedY + visualDownBias;
    const length = Math.hypot(x, y);
    if (length < 0.08) return { x: 0, y: 1, strength: 0.42 };
    return {
      x: x / length,
      y: y / length,
      strength: clamp(length, 0.42, 1)
    };
  }

  function requestDeviceOrientationPermissionOnce() {
    if (deviceOrientationPermissionRequested || typeof DeviceOrientationEvent === "undefined") return;
    const eventWithPermission = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    if (!eventWithPermission.requestPermission) return;
    deviceOrientationPermissionRequested = true;
    void eventWithPermission.requestPermission().catch(() => undefined);
  }

  function stirWaterMessage(message: MessageDTO, event: PointerEvent) {
    if (options.messageEffect(message) !== "water" || options.isMessageEffectPaused(message)) return;
    const bubble = event.currentTarget;
    if (!(bubble instanceof HTMLElement)) return;
    const rect = bubble.getBoundingClientRect();
    const x = clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * 100, 0, 100);
    const y = clamp(((event.clientY - rect.top) / Math.max(1, rect.height)) * 100, 0, 100);
    bubble.style.setProperty("--water-pointer-x", `${x.toFixed(1)}%`);
    bubble.style.setProperty("--water-pointer-y", `${y.toFixed(1)}%`);
    bubble.style.setProperty("--water-stir-size", "38%");
    bubble.style.setProperty("--water-stir-opacity", "0.54");
    bubble.style.setProperty("--water-ripple-wide", "200px");
    bubble.style.setProperty("--water-ripple-tall", "82px");
    bubble.style.setProperty("--water-ripple-opacity", "0.87");
  }

  function settleWaterMessage(message: MessageDTO, event: PointerEvent) {
    if (options.messageEffect(message) !== "water") return;
    const bubble = event.currentTarget;
    if (bubble instanceof HTMLElement) {
      bubble.style.setProperty("--water-stir-size", "20%");
      bubble.style.setProperty("--water-stir-opacity", "0.12");
      bubble.style.setProperty("--water-ripple-wide", "130px");
      bubble.style.setProperty("--water-ripple-tall", "54px");
      bubble.style.setProperty("--water-ripple-opacity", "0.55");
    }
  }

  onMounted(() => {
    window.addEventListener("deviceorientation", handleDeviceOrientation, { passive: true });
  });

  onBeforeUnmount(() => {
    window.removeEventListener("deviceorientation", handleDeviceOrientation);
  });

  return {
    waterTilt,
    handleDeviceOrientation,
    requestDeviceOrientationPermissionOnce,
    stirWaterMessage,
    settleWaterMessage,
    getDeviceGravity: () => deviceGravity
  };
}
