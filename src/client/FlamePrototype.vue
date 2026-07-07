<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

type FlameParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  spin: number;
  kind: "core" | "tongue" | "ember";
};

type DropParticle = {
  x: number;
  y: number;
  vy: number;
  radius: number;
  age: number;
  life: number;
  hit: boolean;
};

type SmokeParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  radius: number;
  alpha: number;
  spin: number;
};

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number; centerX: number; centerY: number };

const stage = ref<HTMLElement | null>(null);
const fireCanvas = ref<HTMLCanvasElement | null>(null);
const smokeCanvas = ref<HTMLCanvasElement | null>(null);
const heatBubble = ref<HTMLElement | null>(null);
const waterBubble = ref<HTMLElement | null>(null);
const fireBubble = ref<HTMLElement | null>(null);
const burnEnabled = ref(true);
const waterEnabled = ref(true);
const intensity = ref(0.86);
const heat = ref(0.18);
const smokeLevel = ref(0);
const lastDropHit = ref("等待水滴");

let animationFrame = 0;
let lastFrame = 0;
let flameParticles: FlameParticle[] = [];
let dropParticles: DropParticle[] = [];
let smokeParticles: SmokeParticle[] = [];
let nextDropAt = 0;
let nextFlameAt = 0;
let nextEmberAt = 0;

const heatStyle = computed(() => ({
  "--flame-heat": heat.value.toFixed(3)
}));

const fireStyle = computed(() => ({
  "--fire-strength": intensity.value.toFixed(2)
}));

const statusText = computed(() => {
  const heatPercent = Math.round(heat.value * 100);
  const smokePercent = Math.round(smokeLevel.value * 100);
  return `热量 ${heatPercent}% · 烟雾 ${smokePercent}% · 火势 ${Math.round(intensity.value * 100)}%`;
});

function toggleWater() {
  waterEnabled.value = !waterEnabled.value;
  if (!waterEnabled.value) {
    dropParticles = [];
    lastDropHit.value = "水滴关闭";
  }
}

function resetDemo() {
  heat.value = 0.18;
  intensity.value = 0.86;
  smokeLevel.value = 0;
  flameParticles = [];
  dropParticles = [];
  smokeParticles = [];
  lastDropHit.value = "等待水滴";
}

function rectFor(element: HTMLElement | null, origin: DOMRect): Rect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left - origin.left,
    top: rect.top - origin.top,
    right: rect.right - origin.left,
    bottom: rect.bottom - origin.top,
    width: rect.width,
    height: rect.height,
    centerX: rect.left - origin.left + rect.width / 2,
    centerY: rect.top - origin.top + rect.height / 2
  };
}

function prepareCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, rect: DOMRect) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    flameParticles = [];
    dropParticles = [];
    smokeParticles = [];
  }
  return { width, height };
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function spawnFlame(now: number, source: Rect) {
  const active = burnEnabled.value ? intensity.value : 0.24;
  const count = Math.max(2, Math.round(4 + active * 8));
  if (now < nextFlameAt) return;
  nextFlameAt = now + randomBetween(18, 34);
  for (let index = 0; index < count; index += 1) {
    const spread = source.width * randomBetween(-0.34, 0.34);
    const kind: FlameParticle["kind"] = Math.random() > 0.72 ? "tongue" : "core";
    flameParticles.push({
      x: source.centerX + spread,
      y: source.top + randomBetween(-4, 10),
      vx: randomBetween(-34, 34) + spread * -0.08,
      vy: randomBetween(-245, -122) * (0.72 + active * 0.44),
      age: 0,
      life: randomBetween(0.48, 0.98),
      size: randomBetween(16, 34) * (0.72 + active * 0.46),
      spin: randomBetween(-1.2, 1.2),
      kind
    });
  }
  if (now > nextEmberAt) {
    nextEmberAt = now + randomBetween(120, 240);
    flameParticles.push({
      x: source.centerX + randomBetween(-source.width * 0.36, source.width * 0.36),
      y: source.top + randomBetween(-4, 8),
      vx: randomBetween(-46, 46),
      vy: randomBetween(-220, -120),
      age: 0,
      life: randomBetween(0.85, 1.8),
      size: randomBetween(2.2, 5.5),
      spin: randomBetween(-1, 1),
      kind: "ember"
    });
  }
}

function spawnDrop(now: number, water: Rect) {
  if (!waterEnabled.value || now < nextDropAt) return;
  nextDropAt = now + randomBetween(680, 980);
  const count = Math.random() > 0.64 ? 2 : 1;
  for (let index = 0; index < count; index += 1) {
    dropParticles.push({
      x: water.centerX + randomBetween(-water.width * 0.28, water.width * 0.28),
      y: water.bottom - randomBetween(2, 8),
      vy: randomBetween(80, 122),
      radius: randomBetween(3.2, 5.8),
      age: 0,
      life: 3.2,
      hit: false
    });
  }
}

function spawnSmoke(x: number, y: number, amount = 9) {
  for (let index = 0; index < amount; index += 1) {
    smokeParticles.push({
      x: x + randomBetween(-22, 22),
      y: y + randomBetween(-10, 14),
      vx: randomBetween(-26, 26),
      vy: randomBetween(-76, -36),
      age: 0,
      life: randomBetween(1.6, 3.2),
      radius: randomBetween(14, 34),
      alpha: randomBetween(0.16, 0.34),
      spin: randomBetween(-0.8, 0.8)
    });
  }
  smokeLevel.value = clamp(smokeLevel.value + 0.18, 0, 1);
}

function updateHeat(dt: number, heatTarget: Rect | null, fire: Rect | null) {
  if (!heatTarget || !fire || !burnEnabled.value) {
    heat.value = clamp(heat.value - dt * 0.04, 0.1, 1);
    return;
  }
  const verticalGap = fire.top - heatTarget.bottom;
  const horizontalGap = Math.abs(fire.centerX - heatTarget.centerX);
  const aligned = verticalGap > -24 && verticalGap < 460 && horizontalGap < Math.max(fire.width, heatTarget.width) * 1.35;
  const heatGain = aligned ? (0.07 + intensity.value * 0.1) * dt : -0.035 * dt;
  const smokeCooling = smokeLevel.value * 0.036 * dt;
  heat.value = clamp(heat.value + heatGain - smokeCooling, 0.12, 1);
}

function updateParticles(dt: number, fire: Rect | null) {
  const nextFlames: FlameParticle[] = [];
  for (const particle of flameParticles) {
    particle.age += dt;
    particle.x += particle.vx * dt + Math.sin((particle.age + particle.spin) * 12) * 0.8;
    particle.y += particle.vy * dt;
    particle.vx *= Math.pow(0.5, dt);
    particle.vy += 42 * dt;
    if (particle.age < particle.life) nextFlames.push(particle);
  }
  flameParticles = nextFlames.slice(-380);

  const nextDrops: DropParticle[] = [];
  for (const drop of dropParticles) {
    drop.age += dt;
    drop.vy += 720 * dt;
    drop.y += drop.vy * dt;
    const insideFlame =
      fire &&
      drop.y + drop.radius >= fire.top - 92 * intensity.value &&
      drop.y - drop.radius <= fire.top + 22 &&
      drop.x >= fire.left - 32 &&
      drop.x <= fire.right + 32;
    if (insideFlame && !drop.hit) {
      drop.hit = true;
      intensity.value = clamp(intensity.value - 0.13, 0.32, 1);
      lastDropHit.value = "水滴触火，冒烟";
      spawnSmoke(drop.x, fire.top - 16, 10);
      continue;
    }
    if (drop.age < drop.life && drop.y < window.innerHeight + 60) nextDrops.push(drop);
  }
  dropParticles = nextDrops.slice(-60);

  const nextSmoke: SmokeParticle[] = [];
  for (const smoke of smokeParticles) {
    smoke.age += dt;
    smoke.x += smoke.vx * dt + Math.sin((smoke.age + smoke.spin) * 2.2) * 0.45;
    smoke.y += smoke.vy * dt;
    smoke.vx *= Math.pow(0.74, dt);
    smoke.vy -= 6 * dt;
    smoke.radius += 19 * dt;
    if (smoke.age < smoke.life) nextSmoke.push(smoke);
  }
  smokeParticles = nextSmoke.slice(-140);
  smokeLevel.value = clamp(smokeLevel.value - dt * 0.095, 0, 1);
  if (burnEnabled.value) intensity.value = clamp(intensity.value + dt * 0.045, 0.32, 1);
}

function drawFlames(context: CanvasRenderingContext2D, width: number, height: number, fire: Rect | null) {
  context.clearRect(0, 0, width, height);
  if (!fire) return;
  context.save();
  context.globalCompositeOperation = "lighter";
  const glow = context.createRadialGradient(fire.centerX, fire.top - 24, 6, fire.centerX, fire.top - 44, 138 * intensity.value);
  glow.addColorStop(0, `rgba(255, 250, 196, ${0.3 * intensity.value})`);
  glow.addColorStop(0.32, `rgba(255, 132, 28, ${0.22 * intensity.value})`);
  glow.addColorStop(1, "rgba(127, 29, 29, 0)");
  context.fillStyle = glow;
  context.fillRect(fire.centerX - 170, fire.top - 190, 340, 230);

  for (const particle of flameParticles) {
    const t = clamp(particle.age / particle.life, 0, 1);
    const alpha = (1 - t) * (particle.kind === "ember" ? 0.82 : 0.72) * intensity.value;
    if (alpha <= 0.01) continue;
    context.save();
    context.translate(particle.x, particle.y);
    context.rotate(Math.sin(particle.age * 4 + particle.spin) * 0.22);
    if (particle.kind === "ember") {
      context.globalAlpha = alpha;
      context.fillStyle = "#ffd166";
      context.shadowColor = "rgba(255, 143, 31, 0.85)";
      context.shadowBlur = 10;
      context.beginPath();
      context.arc(0, 0, particle.size * (1 - t * 0.4), 0, Math.PI * 2);
      context.fill();
    } else {
      const radiusX = particle.size * (0.48 + t * 0.2);
      const radiusY = particle.size * (1.2 - t * 0.46);
      const gradient = context.createRadialGradient(-radiusX * 0.18, -radiusY * 0.42, 1, 0, 0, radiusY);
      gradient.addColorStop(0, `rgba(255, 255, 222, ${alpha})`);
      gradient.addColorStop(0.2, `rgba(255, 211, 83, ${alpha * 0.94})`);
      gradient.addColorStop(0.48, `rgba(255, 103, 28, ${alpha * 0.78})`);
      gradient.addColorStop(0.82, `rgba(153, 27, 27, ${alpha * 0.42})`);
      gradient.addColorStop(1, "rgba(80, 12, 12, 0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
  context.restore();
}

function drawDropsAndSmoke(context: CanvasRenderingContext2D, width: number, height: number) {
  context.clearRect(0, 0, width, height);
  context.save();
  for (const smoke of smokeParticles) {
    const t = clamp(smoke.age / smoke.life, 0, 1);
    const alpha = smoke.alpha * Math.sin((1 - t) * Math.PI * 0.5);
    const gradient = context.createRadialGradient(smoke.x, smoke.y, 2, smoke.x, smoke.y, smoke.radius);
    gradient.addColorStop(0, `rgba(74, 85, 104, ${alpha})`);
    gradient.addColorStop(0.52, `rgba(107, 114, 128, ${alpha * 0.48})`);
    gradient.addColorStop(1, "rgba(148, 163, 184, 0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.ellipse(smoke.x, smoke.y, smoke.radius * (1.18 + t * 0.32), smoke.radius * (0.76 + t * 0.2), smoke.spin + t, 0, Math.PI * 2);
    context.fill();
  }

  for (const drop of dropParticles) {
    const stretch = clamp(drop.vy / 980, 0, 0.8);
    context.save();
    context.translate(drop.x, drop.y);
    context.beginPath();
    context.ellipse(0, 0, drop.radius * (1 - stretch * 0.22), drop.radius * (1.16 + stretch), 0, 0, Math.PI * 2);
    const gradient = context.createRadialGradient(-drop.radius * 0.32, -drop.radius * 0.58, 0.8, 0, drop.radius * 0.2, drop.radius * 1.55);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.96)");
    gradient.addColorStop(0.36, "rgba(191, 238, 255, 0.86)");
    gradient.addColorStop(1, "rgba(14, 116, 144, 0.6)");
    context.fillStyle = gradient;
    context.shadowColor = "rgba(14, 165, 233, 0.35)";
    context.shadowBlur = 8;
    context.fill();
    context.restore();
  }
  context.restore();
}

function tick(now: number) {
  const stageElement = stage.value;
  const flameLayer = fireCanvas.value;
  const smokeLayer = smokeCanvas.value;
  const flameContext = flameLayer?.getContext("2d");
  const smokeContext = smokeLayer?.getContext("2d");
  if (!stageElement || !flameLayer || !smokeLayer || !flameContext || !smokeContext) {
    animationFrame = requestAnimationFrame(tick);
    return;
  }
  const stageRect = stageElement.getBoundingClientRect();
  const { width, height } = prepareCanvas(flameLayer, flameContext, stageRect);
  prepareCanvas(smokeLayer, smokeContext, stageRect);
  const fire = rectFor(fireBubble.value, stageRect);
  const water = rectFor(waterBubble.value, stageRect);
  const target = rectFor(heatBubble.value, stageRect);
  const dt = Math.min(0.04, Math.max(0.008, (lastFrame ? now - lastFrame : 16) / 1000));
  lastFrame = now;

  if (fire) spawnFlame(now, fire);
  if (water) spawnDrop(now, water);
  updateParticles(dt, fire);
  updateHeat(dt, target, fire);
  drawFlames(flameContext, width, height, fire);
  drawDropsAndSmoke(smokeContext, width, height);
  animationFrame = requestAnimationFrame(tick);
}

onMounted(() => {
  animationFrame = requestAnimationFrame(tick);
});

onBeforeUnmount(() => {
  if (animationFrame) cancelAnimationFrame(animationFrame);
});
</script>

<template>
  <main class="flame-prototype-page">
    <section ref="stage" class="flame-demo-stage">
      <canvas ref="fireCanvas" class="flame-canvas" aria-hidden="true"></canvas>
      <canvas ref="smokeCanvas" class="smoke-canvas" aria-hidden="true"></canvas>

      <header class="flame-demo-head">
        <div>
          <strong>/火焰</strong>
          <span>{{ statusText }}</span>
        </div>
        <div class="flame-demo-actions">
          <button type="button" :class="{ active: burnEnabled }" @click="burnEnabled = !burnEnabled">{{ burnEnabled ? "燃烧中" : "留余火" }}</button>
          <button type="button" :class="{ active: waterEnabled }" @click="toggleWater">{{ waterEnabled ? "水滴开" : "水滴关" }}</button>
          <button type="button" @click="resetDemo">重置</button>
        </div>
      </header>

      <div class="prototype-message-stack">
        <article class="prototype-message-row">
          <div class="prototype-avatar">温</div>
          <div class="prototype-bubble-wrap">
            <span>上方气泡</span>
            <p ref="heatBubble" class="prototype-bubble heat-target-bubble" :style="heatStyle">
              火焰正在把我慢慢烧红，亮度会按热量积累。
            </p>
          </div>
        </article>

        <article class="prototype-message-row water-row">
          <div class="prototype-avatar water">水</div>
          <div class="prototype-bubble-wrap">
            <span>水滴气泡</span>
            <p ref="waterBubble" class="prototype-bubble water-source-bubble" :class="{ disabled: !waterEnabled }">
              /水滴滴
            </p>
          </div>
        </article>

        <article class="prototype-message-row mine">
          <div class="prototype-bubble-wrap">
            <span>我的消息</span>
            <p ref="fireBubble" class="prototype-bubble fire-source-bubble" :style="fireStyle">
              /火焰 这个气泡已经着起来了。
            </p>
          </div>
          <div class="prototype-avatar mine">我</div>
        </article>
      </div>

      <aside class="flame-state-panel">
        <b>prototype state</b>
        <span>heat={{ heat.toFixed(3) }}</span>
        <span>intensity={{ intensity.toFixed(3) }}</span>
        <span>smoke={{ smokeLevel.toFixed(3) }}</span>
        <span>{{ lastDropHit }}</span>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.flame-prototype-page {
  width: 100%;
  height: var(--app-height);
  min-height: var(--app-height);
  padding: max(14px, var(--safe-top)) 14px max(14px, var(--safe-bottom));
  overflow: hidden;
  color: #141414;
  background:
    linear-gradient(180deg, rgba(233, 238, 232, 0.94), rgba(214, 222, 213, 0.98)),
    #dce4dc;
}

.flame-demo-stage {
  position: relative;
  width: min(980px, 100%);
  height: 100%;
  margin: 0 auto;
  border: 1px solid rgba(25, 39, 31, 0.12);
  border-radius: 8px;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(246, 248, 246, 0.8), rgba(230, 236, 229, 0.9)),
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.24) 0 1px, transparent 1px 44px),
    #e8eee8;
  box-shadow: 0 18px 42px rgba(25, 31, 27, 0.13);
}

.flame-canvas,
.smoke-canvas {
  position: absolute;
  inset: 0;
  z-index: 5;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.smoke-canvas {
  z-index: 6;
  mix-blend-mode: multiply;
}

.flame-demo-head {
  position: relative;
  z-index: 10;
  min-height: 64px;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(20, 20, 20, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: rgba(247, 249, 247, 0.82);
  backdrop-filter: blur(16px);
}

.flame-demo-head div:first-child {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.flame-demo-head strong {
  font-size: 20px;
}

.flame-demo-head span {
  color: #5d665f;
  font-size: 12px;
}

.flame-demo-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.flame-demo-actions button {
  min-height: 34px;
  border: 1px solid rgba(20, 20, 20, 0.12);
  border-radius: 6px;
  padding: 0 11px;
  color: #222;
  font-weight: 800;
  background: rgba(255, 255, 255, 0.88);
}

.flame-demo-actions button.active {
  color: #fff;
  border-color: rgba(154, 52, 18, 0.42);
  background: #b7411e;
}

.prototype-message-stack {
  position: relative;
  z-index: 4;
  height: calc(100% - 64px);
  padding: 38px clamp(16px, 5vw, 64px) 78px;
  display: grid;
  grid-template-rows: minmax(110px, 0.88fr) minmax(108px, 0.72fr) minmax(148px, 1fr);
  align-items: center;
  gap: 14px;
}

.prototype-message-row {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 10px;
}

.prototype-message-row.mine {
  justify-content: flex-end;
}

.prototype-message-row.water-row {
  transform: translateX(-32px);
}

.prototype-avatar {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-radius: 6px;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 13px;
  font-weight: 900;
  background: #64748b;
  box-shadow: 0 4px 11px rgba(15, 23, 42, 0.14);
}

.prototype-avatar.water {
  background: #0284c7;
}

.prototype-avatar.mine {
  background: #15803d;
}

.prototype-bubble-wrap {
  max-width: min(560px, 78vw);
  display: grid;
  gap: 4px;
}

.prototype-message-row.mine .prototype-bubble-wrap {
  justify-items: end;
}

.prototype-bubble-wrap > span {
  color: #6b7280;
  font-size: 12px;
}

.prototype-bubble {
  position: relative;
  min-width: 124px;
  max-width: min(520px, 74vw);
  margin: 0;
  border-radius: 6px;
  padding: 10px 12px;
  line-height: 1.45;
  word-break: break-word;
  background: #fff;
  box-shadow: 0 5px 16px rgba(15, 23, 42, 0.1);
}

.heat-target-bubble {
  --flame-heat: 0;
  color: color-mix(in srgb, #111 72%, #fff calc(var(--flame-heat) * 28%));
  border: 1px solid rgba(185, 28, 28, calc(var(--flame-heat) * 0.42));
  background:
    radial-gradient(ellipse at 52% 120%, rgba(255, 237, 213, calc(var(--flame-heat) * 0.86)), transparent 64%),
    radial-gradient(ellipse at 44% 96%, rgba(248, 113, 22, calc(var(--flame-heat) * 0.38)), transparent 48%),
    linear-gradient(180deg, color-mix(in srgb, #fff 100%, #fff7ed calc(var(--flame-heat) * 100%)), color-mix(in srgb, #fff 78%, #f97316 calc(var(--flame-heat) * 22%)));
  box-shadow:
    inset 0 -18px 24px rgba(248, 113, 22, calc(var(--flame-heat) * 0.22)),
    inset 0 1px 0 rgba(255, 255, 255, 0.86),
    0 0 calc(8px + var(--flame-heat) * 34px) rgba(251, 146, 60, calc(var(--flame-heat) * 0.62)),
    0 7px 18px rgba(15, 23, 42, 0.12);
  transition:
    background 0.32s linear,
    box-shadow 0.32s linear,
    border-color 0.32s linear,
    color 0.32s linear;
}

.heat-target-bubble::after {
  content: "";
  position: absolute;
  inset: -18px -12px -28px;
  z-index: -1;
  border-radius: 50%;
  background: radial-gradient(ellipse at 50% 100%, rgba(255, 193, 7, calc(var(--flame-heat) * 0.3)), transparent 68%);
  filter: blur(10px);
  opacity: calc(var(--flame-heat) * 0.94);
  pointer-events: none;
}

.water-source-bubble {
  overflow: visible;
  color: #062a3a;
  background:
    radial-gradient(ellipse at 25% 10%, rgba(255, 255, 255, 0.9), transparent 34%),
    linear-gradient(180deg, rgba(241, 250, 255, 0.98), rgba(125, 211, 252, 0.62) 58%, rgba(14, 165, 233, 0.44));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.84),
    inset 0 -9px 18px rgba(2, 132, 199, 0.18),
    0 7px 17px rgba(14, 116, 144, 0.16);
}

.water-source-bubble.disabled {
  filter: grayscale(0.7);
  opacity: 0.66;
}

.water-source-bubble::after {
  content: "";
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -2px;
  height: 5px;
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, rgba(186, 230, 253, 0.8), rgba(255, 255, 255, 0.72), transparent);
  filter: blur(1px);
}

.fire-source-bubble {
  --fire-strength: 0.86;
  overflow: visible;
  color: #fff8db;
  background:
    radial-gradient(ellipse at 24% 10%, rgba(255, 237, 177, 0.48), transparent 36%),
    linear-gradient(180deg, color-mix(in srgb, #7c2d12 58%, #f97316 calc(var(--fire-strength) * 42%)), #431407);
  box-shadow:
    inset 0 1px 0 rgba(255, 237, 213, 0.26),
    inset 0 -14px 22px rgba(69, 10, 10, 0.44),
    0 0 calc(18px + var(--fire-strength) * 26px) rgba(249, 115, 22, calc(var(--fire-strength) * 0.7)),
    0 10px 22px rgba(69, 10, 10, 0.22);
}

.fire-source-bubble::before {
  content: "";
  position: absolute;
  left: 16%;
  right: 16%;
  top: -7px;
  height: 10px;
  border-radius: 50%;
  background: linear-gradient(90deg, transparent, rgba(255, 218, 112, 0.86), rgba(255, 102, 28, 0.78), transparent);
  filter: blur(2px);
}

.fire-source-bubble::after {
  content: "";
  position: absolute;
  inset: -120px -62px 16px;
  z-index: -1;
  border-radius: 48%;
  background:
    radial-gradient(ellipse at 50% 100%, rgba(255, 243, 180, calc(var(--fire-strength) * 0.2)), transparent 28%),
    radial-gradient(ellipse at 50% 100%, rgba(255, 115, 28, calc(var(--fire-strength) * 0.26)), transparent 62%);
  filter: blur(12px);
  pointer-events: none;
  animation: fireHeatWaver 1.4s ease-in-out infinite;
}

.flame-state-panel {
  position: absolute;
  z-index: 10;
  left: 14px;
  bottom: 14px;
  min-width: 184px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 8px;
  padding: 10px;
  display: grid;
  gap: 4px;
  color: #243027;
  font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(12px);
}

.flame-state-panel b {
  font-size: 12px;
}

@keyframes fireHeatWaver {
  0%,
  100% {
    transform: translate3d(-2px, 0, 0) scaleX(0.98);
  }
  50% {
    transform: translate3d(3px, -3px, 0) scaleX(1.04);
  }
}

@media (max-width: 680px) {
  .flame-prototype-page {
    padding: 0;
  }

  .flame-demo-stage {
    width: 100%;
    border: 0;
    border-radius: 0;
  }

  .flame-demo-head {
    min-height: calc(var(--safe-top) + 92px);
    padding-top: calc(var(--safe-top) + 10px);
    align-items: flex-start;
    flex-direction: column;
  }

  .flame-demo-actions {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .flame-demo-actions button {
    padding: 0 6px;
    font-size: 12px;
  }

  .prototype-message-stack {
    height: calc(100% - var(--safe-top) - 92px);
    padding: 26px 14px 84px;
    grid-template-rows: minmax(114px, 0.92fr) minmax(108px, 0.7fr) minmax(156px, 1fr);
  }

  .prototype-message-row.water-row {
    transform: none;
  }

  .prototype-bubble-wrap {
    max-width: calc(100vw - 68px);
  }

  .prototype-bubble {
    max-width: calc(100vw - 82px);
    font-size: 14px;
  }

  .flame-state-panel {
    right: 10px;
    left: 10px;
    bottom: max(10px, var(--safe-bottom));
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
