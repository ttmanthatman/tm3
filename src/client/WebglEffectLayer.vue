<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { MessageDTO } from "@shared/types";

type EffectKind = "water" | "drip" | "sunburst";
type EffectRect = {
  id: number;
  kind: EffectKind;
  left: number;
  top: number;
  width: number;
  height: number;
};
type RainDrop = { x: number; y: number; length: number; speed: number; sway: number; alpha: number };
type DripDrop = { x: number; y: number; vx: number; vy: number; radius: number; sourceId: number };
type Splash = { x: number; y: number; age: number; life: number; radius: number };

const props = defineProps<{
  messages: MessageDTO[];
  pausedEffectIds: number[];
  rainActive: boolean;
  waterTilt: { x: number; y: number };
}>();

const host = ref<HTMLDivElement | null>(null);
let THREE: typeof import("three") | null = null;
let threeLoading: Promise<typeof import("three")> | null = null;
let renderer: import("three").WebGLRenderer | null = null;
let scene: import("three").Scene | null = null;
let camera: import("three").OrthographicCamera | null = null;
let animationFrame = 0;
let lastFrame = 0;
let width = 1;
let height = 1;
let rainDrops: RainDrop[] = [];
let dripDrops: DripDrop[] = [];
let splashes: Splash[] = [];
let lastDripSpawn = 0;
let reducedMotion = false;
let webglAvailable = false;

const pausedIds = computed(() => new Set(props.pausedEffectIds));
const advancedEffectKey = computed(() =>
  props.messages
    .filter((message) => !pausedIds.value.has(message.id))
    .map((message) => `${message.id}:${JSON.stringify(message.payload || {})}`)
    .join("|")
);

function canUseWebgl() {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

async function setupRenderer() {
  if (!host.value || renderer || !webglAvailable || reducedMotion) return;
  THREE = THREE || (await (threeLoading ||= import("three")));
  if (!host.value || renderer) return;
  renderer = new THREE!.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
  renderer.domElement.className = "webgl-effect-canvas";
  host.value.appendChild(renderer.domElement);
  scene = new THREE!.Scene();
  camera = new THREE!.OrthographicCamera(0, width, height, 0, -1000, 1000);
}

function resizeRenderer() {
  if (!host.value || !renderer || !camera) return;
  const rect = host.value.getBoundingClientRect();
  const nextWidth = Math.max(1, Math.floor(rect.width));
  const nextHeight = Math.max(1, Math.floor(rect.height));
  if (nextWidth === width && nextHeight === height) return;
  width = nextWidth;
  height = nextHeight;
  renderer.setSize(width, height, false);
  camera.left = 0;
  camera.right = width;
  camera.top = 0;
  camera.bottom = height;
  camera.updateProjectionMatrix();
  seedRain();
}

function effectRects() {
  if (!host.value) return [];
  const rootRect = host.value.getBoundingClientRect();
  const rows = document.querySelectorAll<HTMLElement>(".messages-scroll .message-row[data-message-id]");
  const rects: EffectRect[] = [];
  for (const row of rows) {
    const id = Number(row.dataset.messageId || 0);
    if (!id || pausedIds.value.has(id)) continue;
    const bubble = row.querySelector<HTMLElement>(".bubble");
    if (!bubble) continue;
    const bubbleRect = bubble.getBoundingClientRect();
    if (bubbleRect.bottom < rootRect.top - 80 || bubbleRect.top > rootRect.bottom + 80) continue;
    const classes = bubble.classList;
    const kind: EffectKind | null = classes.contains("message-effect-water")
      ? "water"
      : classes.contains("message-effect-drip")
        ? "drip"
        : classes.contains("message-effect-sunburst")
          ? "sunburst"
          : null;
    if (!kind) continue;
    rects.push({
      id,
      kind,
      left: bubbleRect.left - rootRect.left,
      top: bubbleRect.top - rootRect.top,
      width: bubbleRect.width,
      height: bubbleRect.height
    });
  }
  return rects;
}

function hasActiveWebglWork() {
  if (props.rainActive) return true;
  return effectRects().length > 0 || dripDrops.length > 0 || splashes.length > 0;
}

async function startLoop() {
  if (animationFrame || !webglAvailable || reducedMotion || !hasActiveWebglWork()) return;
  await setupRenderer();
  if (!renderer || !scene || !camera) return;
  animationFrame = requestAnimationFrame(renderFrame);
}

function requestLoop() {
  void startLoop();
}

function stopLoopIfIdle() {
  if (!animationFrame || hasActiveWebglWork()) return;
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  lastFrame = 0;
  if (renderer && scene && camera) {
    scene.clear();
    renderer.clear();
    renderer.render(scene, camera);
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    lastFrame = 0;
    return;
  }
  requestLoop();
}

function transientMesh(mesh: import("three").Object3D, disposables: Array<{ dispose: () => void }>) {
  scene?.add(mesh);
  const geometry = (mesh as import("three").Mesh).geometry as import("three").BufferGeometry | undefined;
  const material = (mesh as import("three").Mesh).material as import("three").Material | undefined;
  if (geometry) disposables.push(geometry);
  if (material) disposables.push(material);
}

function drawWater(rect: EffectRect, time: number, disposables: Array<{ dispose: () => void }>) {
  const tilt = Math.max(-14, Math.min(14, props.waterTilt.x * 0.42));
  const waveAmp = Math.max(5, Math.min(14, rect.height * 0.12));
  const waterTop = rect.top + rect.height * 0.46 + props.waterTilt.y * 0.28;
  const shape = new THREE!.Shape();
  shape.moveTo(rect.left, rect.top + rect.height);
  shape.lineTo(rect.left, waterTop);
  for (let index = 0; index <= 18; index += 1) {
    const progress = index / 18;
    const x = rect.left + rect.width * progress;
    const y = waterTop + Math.sin(progress * Math.PI * 3.2 + time * 0.003 + rect.id) * waveAmp + (progress - 0.5) * tilt;
    shape.lineTo(x, y);
  }
  shape.lineTo(rect.left + rect.width, rect.top + rect.height);
  shape.closePath();

  const fill = new THREE!.Mesh(
    new THREE!.ShapeGeometry(shape),
    new THREE!.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE!.NormalBlending
    })
  );
  fill.renderOrder = 2;
  transientMesh(fill, disposables);

  const points: import("three").Vector3[] = [];
  for (let index = 0; index <= 30; index += 1) {
    const progress = index / 30;
    points.push(
      new THREE!.Vector3(
        rect.left + rect.width * progress,
        waterTop + Math.sin(progress * Math.PI * 3.2 + time * 0.003 + rect.id) * waveAmp + (progress - 0.5) * tilt - 1,
        4
      )
    );
  }
  const line = new THREE!.Line(
    new THREE!.BufferGeometry().setFromPoints(points),
    new THREE!.LineBasicMaterial({ color: 0xe0f7ff, transparent: true, opacity: 0.9, blending: THREE!.AdditiveBlending })
  );
  line.renderOrder = 3;
  transientMesh(line, disposables);

  const sparkleCount = Math.max(2, Math.min(7, Math.floor(rect.width / 52)));
  for (let index = 0; index < sparkleCount; index += 1) {
    const phase = time * 0.002 + index * 1.7 + rect.id;
    const sparkle = new THREE!.Mesh(
      new THREE!.CircleGeometry(2 + Math.sin(phase) * 0.8, 18),
      new THREE!.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 + Math.sin(phase) * 0.18, blending: THREE!.AdditiveBlending })
    );
    sparkle.position.set(rect.left + ((index + 0.65) / sparkleCount) * rect.width, waterTop + 14 + Math.sin(phase * 1.3) * 9, 8);
    transientMesh(sparkle, disposables);
  }
}

function drawSunburst(rect: EffectRect, time: number, disposables: Array<{ dispose: () => void }>) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radius = Math.max(rect.width, rect.height) * 0.55;
  for (let index = 0; index < 22; index += 1) {
    const angle = (index / 22) * Math.PI * 2 + time * 0.00035;
    const length = radius * (0.46 + 0.2 * Math.sin(time * 0.002 + index));
    const ray = new THREE!.Mesh(
      new THREE!.PlaneGeometry(4, length),
      new THREE!.MeshBasicMaterial({ color: index % 2 ? 0xfbbf24 : 0xfff3a3, transparent: true, opacity: 0.16, blending: THREE!.AdditiveBlending, depthWrite: false })
    );
    ray.position.set(cx + Math.cos(angle) * (radius * 0.52), cy + Math.sin(angle) * (radius * 0.52), -4);
    ray.rotation.z = angle - Math.PI / 2;
    transientMesh(ray, disposables);
  }
  const halo = new THREE!.Mesh(
    new THREE!.CircleGeometry(radius * 0.82, 48),
    new THREE!.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.08 + Math.sin(time * 0.003) * 0.025, blending: THREE!.AdditiveBlending })
  );
  halo.position.set(cx, cy, -5);
  transientMesh(halo, disposables);
}

function seedRain() {
  const count = Math.min(280, Math.max(120, Math.floor((width * height) / 4200)));
  rainDrops = Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    length: 16 + Math.random() * 34,
    speed: 520 + Math.random() * 560,
    sway: -150 - Math.random() * 170,
    alpha: 0.22 + Math.random() * 0.52
  }));
}

function drawRain(dt: number, disposables: Array<{ dispose: () => void }>) {
  if (!props.rainActive) return;
  if (!rainDrops.length) seedRain();
  const positions = new Float32Array(rainDrops.length * 2 * 3);
  rainDrops.forEach((drop, index) => {
    drop.x += drop.sway * dt;
    drop.y += drop.speed * dt;
    if (drop.y > height + drop.length) {
      drop.y = -drop.length - Math.random() * height * 0.35;
      drop.x = Math.random() * width;
    }
    if (drop.x < -60) drop.x = width + 40;
    const offset = index * 6;
    positions[offset] = drop.x;
    positions[offset + 1] = drop.y;
    positions[offset + 2] = 10;
    positions[offset + 3] = drop.x + drop.sway * 0.06;
    positions[offset + 4] = drop.y + drop.length;
    positions[offset + 5] = 10;
  });
  const rain = new THREE!.LineSegments(
    new THREE!.BufferGeometry().setAttribute("position", new THREE!.BufferAttribute(positions, 3)),
    new THREE!.LineBasicMaterial({ color: 0xdaf7ff, transparent: true, opacity: 0.58, blending: THREE!.AdditiveBlending })
  );
  rain.renderOrder = 10;
  transientMesh(rain, disposables);
}

function spawnDrips(rects: EffectRect[], time: number) {
  if (time - lastDripSpawn < 420 || dripDrops.length > 90) return;
  lastDripSpawn = time;
  for (const rect of rects.filter((item) => item.kind === "drip").slice(-8)) {
    const count = Math.random() > 0.65 ? 2 : 1;
    for (let index = 0; index < count; index += 1) {
      dripDrops.push({
        x: rect.left + 10 + Math.random() * Math.max(8, rect.width - 20),
        y: rect.top + rect.height - 4,
        vx: -22 + Math.random() * 44,
        vy: 24 + Math.random() * 42,
        radius: 3.2 + Math.random() * 2.4,
        sourceId: rect.id
      });
    }
  }
}

function updateDrips(rects: EffectRect[], dt: number) {
  const nextDrops: DripDrop[] = [];
  for (const drop of dripDrops) {
    drop.vy += 360 * dt;
    drop.x += drop.vx * dt;
    drop.y += drop.vy * dt;
    const hit = rects.find((rect) => rect.id !== drop.sourceId && drop.x >= rect.left - drop.radius && drop.x <= rect.left + rect.width + drop.radius && drop.y + drop.radius >= rect.top && drop.y <= rect.top + rect.height);
    if (hit) {
      splashes.push({ x: drop.x, y: hit.top + 2, age: 0, life: 0.62, radius: 9 + Math.random() * 8 });
      continue;
    }
    if (drop.y < height + 40) nextDrops.push(drop);
  }
  dripDrops = nextDrops;
  splashes = splashes
    .map((splash) => ({ ...splash, age: splash.age + dt }))
    .filter((splash) => splash.age < splash.life);
}

function drawDrips(disposables: Array<{ dispose: () => void }>) {
  for (const drop of dripDrops) {
    const bead = new THREE!.Mesh(
      new THREE!.CircleGeometry(drop.radius, 20),
      new THREE!.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.72, blending: THREE!.AdditiveBlending })
    );
    bead.scale.y = 1.28;
    bead.position.set(drop.x, drop.y, 7);
    transientMesh(bead, disposables);
  }
  for (const splash of splashes) {
    const progress = splash.age / splash.life;
    const ring = new THREE!.Mesh(
      new THREE!.RingGeometry(splash.radius * progress * 0.45, splash.radius * progress, 24),
      new THREE!.MeshBasicMaterial({ color: 0xbae6fd, transparent: true, opacity: Math.max(0, 0.72 * (1 - progress)), blending: THREE!.AdditiveBlending })
    );
    ring.scale.y = 0.34;
    ring.position.set(splash.x, splash.y, 7);
    transientMesh(ring, disposables);
  }
}

function renderFrame(now: number) {
  animationFrame = 0;
  if (!renderer || !scene || !camera) return;
  resizeRenderer();
  const dt = Math.min(0.05, Math.max(0.001, (now - (lastFrame || now)) / 1000));
  lastFrame = now;
  const rects = effectRects();
  spawnDrips(rects, now);
  updateDrips(rects, dt);

  const disposables: Array<{ dispose: () => void }> = [];
  scene.clear();
  drawRain(dt, disposables);
  for (const rect of rects) {
    if (rect.kind === "water") drawWater(rect, now, disposables);
    if (rect.kind === "sunburst") drawSunburst(rect, now, disposables);
  }
  drawDrips(disposables);
  renderer.render(scene, camera);
  for (const item of scene.children) scene.remove(item);
  for (const disposable of disposables) disposable.dispose();
  if (hasActiveWebglWork()) {
    animationFrame = requestAnimationFrame(renderFrame);
  } else {
    stopLoopIfIdle();
  }
}

watch(
  () => [advancedEffectKey.value, props.rainActive, props.waterTilt.x, props.waterTilt.y],
  () => requestLoop(),
  { flush: "post" }
);

onMounted(() => {
  reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  webglAvailable = canUseWebgl();
  window.addEventListener("resize", resizeRenderer, { passive: true });
  document.addEventListener("scroll", requestLoop, { passive: true, capture: true });
  document.addEventListener("visibilitychange", handleVisibilityChange);
  requestLoop();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", resizeRenderer);
  document.removeEventListener("scroll", requestLoop, { capture: true });
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  if (animationFrame) cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  renderer?.dispose();
  renderer?.domElement.remove();
  renderer = null;
  scene = null;
  camera = null;
});
</script>

<template>
  <div ref="host" class="webgl-effect-layer" aria-hidden="true"></div>
</template>
