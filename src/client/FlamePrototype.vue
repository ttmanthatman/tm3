<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

type FlameStyle = "legacy" | "ribbon";
type FlameLayer = "outer" | "middle" | "inner" | "core";

type FlameParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  spin: number;
  segment: number;
  kind: "core" | "tongue" | "ember";
};

type DropParticle = {
  x: number;
  y: number;
  vy: number;
  radius: number;
  age: number;
  life: number;
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

const segmentCount = 17;
const baseFire = 0.46;
const stage = ref<HTMLElement | null>(null);
const fireCanvas = ref<HTMLCanvasElement | null>(null);
const smokeCanvas = ref<HTMLCanvasElement | null>(null);
const heatBubble = ref<HTMLElement | null>(null);
const waterBubble = ref<HTMLElement | null>(null);
const fireBubble = ref<HTMLElement | null>(null);
const flameStyle = ref<FlameStyle>("ribbon");
const heat = ref(0.18);
const smokeLevel = ref(0);
const actionOpen = ref(false);
const boostUntil = ref(0);
const lastAction = ref("默认温和燃烧");
const segmentStrengths = ref(Array.from({ length: segmentCount }, () => baseFire + Math.random() * 0.06));

let animationFrame = 0;
let lastFrame = 0;
let flameParticles: FlameParticle[] = [];
let dropParticles: DropParticle[] = [];
let smokeParticles: SmokeParticle[] = [];
let nextDropAt = 0;
let nextFlameAt = 0;
let nextEmberAt = 0;

const averageFire = computed(() => segmentStrengths.value.reduce((sum, value) => sum + value, 0) / segmentStrengths.value.length);
const strongestFire = computed(() => Math.max(...segmentStrengths.value));

const heatStyle = computed(() => ({
  "--flame-heat": heat.value.toFixed(3)
}));

const fireStyle = computed(() => ({
  "--fire-strength": strongestFire.value.toFixed(3)
}));

const boostRemainingSeconds = computed(() => Math.max(0, Math.ceil((boostUntil.value - performance.now()) / 1000)));

const statusText = computed(() => {
  const heatPercent = Math.round(heat.value * 100);
  const firePercent = Math.round(averageFire.value * 100);
  return `热量 ${heatPercent}% · 平均火势 ${firePercent}% · ${flameStyle.value === "ribbon" ? "拟真火焰" : "原样式"}`;
});

function setFlameStyle(style: FlameStyle) {
  flameStyle.value = style;
  flameParticles = [];
  lastAction.value = style === "ribbon" ? "切到拟真火焰" : "切到原样式";
}

function resetDemo() {
  heat.value = 0.18;
  smokeLevel.value = 0;
  boostUntil.value = 0;
  actionOpen.value = false;
  segmentStrengths.value = Array.from({ length: segmentCount }, () => baseFire + Math.random() * 0.06);
  flameParticles = [];
  dropParticles = [];
  smokeParticles = [];
  lastAction.value = "默认温和燃烧";
}

function stokeFire() {
  boostUntil.value = performance.now() + 15_000;
  segmentStrengths.value = segmentStrengths.value.map((value) => clamp(value + 0.24, baseFire, 0.88));
  actionOpen.value = false;
  lastAction.value = "添柴：旺盛 15 秒后回落";
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

function boostFactor(now: number) {
  if (now >= boostUntil.value) return 0;
  return clamp((boostUntil.value - now) / 15_000, 0, 1);
}

function updateSegmentStrengths(dt: number, now: number) {
  const boost = boostFactor(now);
  segmentStrengths.value = segmentStrengths.value.map((value, index) => {
    const wave = Math.sin(now * 0.0022 + index * 0.74) * 0.045 + Math.sin(now * 0.0011 + index * 1.47) * 0.024;
    const target = clamp(baseFire + wave + boost * 0.42, 0.3, 0.94);
    const follow = 1 - Math.exp(-(boost ? 3.1 : 1.65) * dt);
    return clamp(value + (target - value) * follow, 0.16, 0.96);
  });
}

function segmentIndexAtX(x: number, fire: Rect) {
  return clamp(Math.floor(((x - fire.left) / Math.max(1, fire.width)) * segmentCount), 0, segmentCount - 1);
}

function segmentCenter(fire: Rect, index: number) {
  const width = fire.width / segmentCount;
  return fire.left + width * (index + 0.5);
}

function spawnFlame(now: number, source: Rect) {
  if (now < nextFlameAt) return;
  nextFlameAt = now + (flameStyle.value === "legacy" ? 28 : 56);
  const segmentWidth = source.width / segmentCount;
  segmentStrengths.value.forEach((power, index) => {
    const count = flameStyle.value === "legacy" ? Math.max(1, Math.round(power * 3)) : Math.max(0, Math.round(power * 1.1));
    for (let particleIndex = 0; particleIndex < count; particleIndex += 1) {
      const center = segmentCenter(source, index);
      const kind: FlameParticle["kind"] = Math.random() > 0.7 ? "tongue" : "core";
      flameParticles.push({
        x: center + randomBetween(-segmentWidth * 0.58, segmentWidth * 0.58),
        y: source.top + randomBetween(-8, 8),
        vx: randomBetween(-20, 20),
        vy: randomBetween(-132, -72) * (0.82 + power * 0.62),
        age: 0,
        life: randomBetween(0.5, 1.08),
        size: randomBetween(7, 16) * (0.76 + power * 0.62),
        spin: randomBetween(-1.2, 1.2),
        segment: index,
        kind
      });
    }
  });
  if (now > nextEmberAt) {
    nextEmberAt = now + randomBetween(260, 520);
    const index = Math.floor(Math.random() * segmentCount);
    flameParticles.push({
      x: segmentCenter(source, index) + randomBetween(-segmentWidth * 0.35, segmentWidth * 0.35),
      y: source.top + randomBetween(-4, 6),
      vx: randomBetween(-36, 36),
      vy: randomBetween(-165, -88),
      age: 0,
      life: randomBetween(0.9, 1.7),
      size: randomBetween(1.8, 4.4),
      spin: randomBetween(-1, 1),
      segment: index,
      kind: "ember"
    });
  }
}

function spawnDrop(now: number, water: Rect) {
  if (now < nextDropAt) return;
  nextDropAt = now + randomBetween(780, 1180);
  const count = Math.random() > 0.7 ? 2 : 1;
  for (let index = 0; index < count; index += 1) {
    dropParticles.push({
      x: water.centerX + randomBetween(-water.width * 0.28, water.width * 0.28),
      y: water.bottom - randomBetween(2, 8),
      vy: randomBetween(82, 128),
      radius: randomBetween(3.2, 5.8),
      age: 0,
      life: 3.2
    });
  }
}

function spawnSmoke(x: number, y: number, amount = 7) {
  for (let index = 0; index < amount; index += 1) {
    smokeParticles.push({
      x: x + randomBetween(-18, 18),
      y: y + randomBetween(-8, 12),
      vx: randomBetween(-24, 24),
      vy: randomBetween(-66, -32),
      age: 0,
      life: randomBetween(1.35, 2.8),
      radius: randomBetween(10, 23),
      alpha: randomBetween(0.08, 0.17),
      spin: randomBetween(-0.8, 0.8)
    });
  }
  smokeLevel.value = clamp(smokeLevel.value + 0.14, 0, 1);
}

function applyWaterHit(x: number, fire: Rect) {
  const index = segmentIndexAtX(x, fire);
  segmentStrengths.value = segmentStrengths.value.map((value, segment) => {
    const distance = Math.abs(segment - index);
    if (distance === 0) return clamp(value - 0.26, 0.16, 0.92);
    if (distance === 1) return clamp(value - 0.08, 0.18, 0.92);
    return value;
  });
  lastAction.value = `水滴压低第 ${index + 1} 段火势`;
  spawnSmoke(x, fire.top - 14, 8);
}

function updateHeat(dt: number, heatTarget: Rect | null, fire: Rect | null) {
  if (!heatTarget || !fire) {
    heat.value = clamp(heat.value - dt * 0.035, 0.1, 1);
    return;
  }
  const verticalGap = fire.top - heatTarget.bottom;
  const horizontalGap = Math.abs(fire.centerX - heatTarget.centerX);
  const aligned = verticalGap > -24 && verticalGap < 460 && horizontalGap < Math.max(fire.width, heatTarget.width) * 1.35;
  const heatGain = aligned ? (0.045 + averageFire.value * 0.075) * dt : -0.035 * dt;
  const smokeCooling = smokeLevel.value * 0.026 * dt;
  heat.value = clamp(heat.value + heatGain - smokeCooling, 0.12, 1);
}

function updateParticles(dt: number, fire: Rect | null) {
  const nextFlames: FlameParticle[] = [];
  for (const particle of flameParticles) {
    const power = segmentStrengths.value[particle.segment] || baseFire;
    particle.age += dt;
    particle.x += particle.vx * dt + Math.sin((particle.age + particle.spin) * 11) * 0.55;
    particle.y += particle.vy * dt;
    particle.vx *= Math.pow(0.5, dt);
    particle.vy += 34 * dt;
    if (particle.age < particle.life && power > 0.14) nextFlames.push(particle);
  }
  flameParticles = nextFlames.slice(-520);

  const nextDrops: DropParticle[] = [];
  for (const drop of dropParticles) {
    drop.age += dt;
    drop.vy += 720 * dt;
    drop.y += drop.vy * dt;
    const insideFlame =
      fire &&
      drop.y + drop.radius >= fire.top - 84 &&
      drop.y - drop.radius <= fire.top + 24 &&
      drop.x >= fire.left - 12 &&
      drop.x <= fire.right + 12;
    if (insideFlame) {
      applyWaterHit(drop.x, fire);
      continue;
    }
    if (drop.age < drop.life && drop.y < window.innerHeight + 60) nextDrops.push(drop);
  }
  dropParticles = nextDrops.slice(-60);

  const nextSmoke: SmokeParticle[] = [];
  for (const smoke of smokeParticles) {
    smoke.age += dt;
    smoke.x += smoke.vx * dt + Math.sin((smoke.age + smoke.spin) * 2.2) * 0.4;
    smoke.y += smoke.vy * dt;
    smoke.vx *= Math.pow(0.74, dt);
    smoke.vy -= 5 * dt;
    smoke.radius += 17 * dt;
    if (smoke.age < smoke.life) nextSmoke.push(smoke);
  }
  smokeParticles = nextSmoke.slice(-140);
  smokeLevel.value = clamp(smokeLevel.value - dt * 0.1, 0, 1);
}

function drawLegacyFlames(context: CanvasRenderingContext2D, fire: Rect) {
  for (const particle of flameParticles) {
    const t = clamp(particle.age / particle.life, 0, 1);
    const power = segmentStrengths.value[particle.segment] || baseFire;
    const alpha = (1 - t) * (particle.kind === "ember" ? 0.78 : 0.64) * clamp(power + 0.18, 0, 1);
    if (alpha <= 0.01) continue;
    context.save();
    context.translate(particle.x, particle.y);
    context.rotate(Math.sin(particle.age * 4 + particle.spin) * 0.22);
    if (particle.kind === "ember") {
      context.globalAlpha = alpha;
      context.fillStyle = "#ffd166";
      context.shadowColor = "rgba(255, 143, 31, 0.75)";
      context.shadowBlur = 9;
      context.beginPath();
      context.arc(0, 0, particle.size * (1 - t * 0.4), 0, Math.PI * 2);
      context.fill();
    } else {
      const radiusX = particle.size * (0.52 + t * 0.16);
      const radiusY = particle.size * (1.18 - t * 0.42);
      const gradient = context.createRadialGradient(-radiusX * 0.18, -radiusY * 0.42, 1, 0, 0, radiusY);
      gradient.addColorStop(0, `rgba(255, 255, 222, ${alpha})`);
      gradient.addColorStop(0.22, `rgba(255, 211, 83, ${alpha * 0.9})`);
      gradient.addColorStop(0.52, `rgba(255, 103, 28, ${alpha * 0.72})`);
      gradient.addColorStop(1, "rgba(80, 12, 12, 0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  const glow = context.createLinearGradient(fire.left, fire.top - 8, fire.right, fire.top - 8);
  segmentStrengths.value.forEach((power, index) => {
    glow.addColorStop(index / Math.max(1, segmentCount - 1), `rgba(255, 115, 28, ${0.05 + power * 0.15})`);
  });
  context.fillStyle = glow;
  context.fillRect(fire.left - 8, fire.top - 34, fire.width + 16, 52);
}

function drawRibbonFlames(context: CanvasRenderingContext2D, fire: Rect, now: number) {
  const segmentWidth = fire.width / segmentCount;
  const boost = boostFactor(now);
  const plumeCount = Math.max(6, Math.round(fire.width / 42));
  const tallFlame = clamp(fire.width * 0.56, 118, 210);

  context.save();
  context.filter = "blur(11px)";
  context.globalAlpha = 0.78;
  for (let index = 0; index < segmentCount; index += 1) {
    const power = segmentStrengths.value[index];
    const x = segmentCenter(fire, index);
    const glow = context.createRadialGradient(x, fire.top + 2, 3, x, fire.top - 38, 58 + power * 78);
    glow.addColorStop(0, `rgba(255, 231, 144, ${0.14 + power * 0.2})`);
    glow.addColorStop(0.38, `rgba(255, 102, 24, ${0.1 + power * 0.18})`);
    glow.addColorStop(0.72, `rgba(151, 20, 12, ${0.05 + power * 0.1})`);
    glow.addColorStop(1, "rgba(76, 5, 5, 0)");
    context.fillStyle = glow;
    context.fillRect(x - segmentWidth * 2.2, fire.top - 132, segmentWidth * 4.4, 158);
  }
  context.restore();

  drawFlameBase(context, fire, now);

  context.save();
  context.filter = "blur(1.6px)";
  for (let index = -1; index <= plumeCount; index += 1) {
    const unit = (index + 0.5) / plumeCount;
    const x = fire.left + fire.width * unit + layeredNoise(now, index + 2.1, 0.8) * segmentWidth * 0.58;
    const power = sampleFirePower(fire, x);
    const height = tallFlame * (0.62 + power * 0.92 + boost * 0.22) * stableRandom(index + 11, 0.78, 1.2);
    const width = clamp(segmentWidth * stableRandom(index + 20, 2.2, 4.8), 34, 86);
    const lean = layeredNoise(now, index + 5.8, 1) * segmentWidth * (0.56 + power * 0.36);
    const baseY = fire.top + 13 + power * 12;
    drawFlameTongue(context, x, baseY, width, height, lean, power, "outer");
  }
  context.restore();

  context.save();
  context.filter = "blur(0.8px)";
  for (let index = 0; index < plumeCount; index += 1) {
    const unit = (index + 0.5) / plumeCount;
    const x = fire.left + fire.width * unit + layeredNoise(now, index + 9.3, 1.35) * segmentWidth * 0.34;
    const power = sampleFirePower(fire, x);
    const height = tallFlame * (0.38 + power * 0.62 + boost * 0.14) * stableRandom(index + 41, 0.72, 1.16);
    const width = clamp(segmentWidth * stableRandom(index + 32, 1.1, 2.35), 18, 52);
    const lean = layeredNoise(now, index + 12.2, 1.24) * segmentWidth * 0.42;
    drawFlameTongue(context, x + lean * 0.16, fire.top + 9, width, height * 0.86, lean * 0.72, power, "middle");
  }
  context.restore();

  for (let index = 0; index < plumeCount; index += 1) {
    if (index % 2 !== 0 && stableRandom(index + 87, 0, 1) < 0.68) continue;
    const unit = (index + 0.5) / plumeCount;
    const x = fire.left + fire.width * unit + layeredNoise(now, index + 18.7, 1.55) * segmentWidth * 0.22;
    const power = sampleFirePower(fire, x);
    if (power < 0.22) continue;
    const lean = layeredNoise(now, index + 22.4, 1.12) * segmentWidth * 0.24;
    const height = tallFlame * (0.22 + power * 0.42 + boost * 0.08) * stableRandom(index + 64, 0.74, 1.18);
    drawFlameTongue(context, x, fire.top + 8, clamp(segmentWidth * 0.72, 10, 28), height, lean, power, power > 0.68 ? "core" : "inner");
  }

  drawFlameWisps(context, fire, now, plumeCount, tallFlame);
  drawFloatingFlameParticles(context);
}

function sampleFirePower(fire: Rect, x: number) {
  const unit = clamp((x - fire.left) / Math.max(1, fire.width), 0, 1) * (segmentCount - 1);
  const low = Math.floor(unit);
  const high = Math.min(segmentCount - 1, low + 1);
  const mix = unit - low;
  return (segmentStrengths.value[low] || baseFire) * (1 - mix) + (segmentStrengths.value[high] || baseFire) * mix;
}

function layeredNoise(now: number, seed: number, speed: number) {
  return (
    Math.sin(now * 0.0024 * speed + seed * 1.73) * 0.5 +
    Math.sin(now * 0.0042 * speed + seed * 0.71) * 0.32 +
    Math.sin(now * 0.0013 * speed + seed * 2.91) * 0.18
  );
}

function drawFlameBase(context: CanvasRenderingContext2D, fire: Rect, now: number) {
  const topY = fire.top + 8;
  const bottomY = fire.top + 31;
  const steps = 12;

  context.save();
  context.filter = "blur(4px)";
  const baseGlow = context.createRadialGradient(fire.centerX, fire.top + 2, 8, fire.centerX, fire.top - 10, fire.width * 0.62);
  baseGlow.addColorStop(0, "rgba(255, 241, 174, 0.36)");
  baseGlow.addColorStop(0.42, "rgba(255, 106, 26, 0.34)");
  baseGlow.addColorStop(1, "rgba(101, 12, 8, 0)");
  context.fillStyle = baseGlow;
  context.fillRect(fire.left - 42, fire.top - 56, fire.width + 84, 90);
  context.restore();

  context.save();
  context.beginPath();
  context.moveTo(fire.left - 12, bottomY);
  context.lineTo(fire.left - 12, topY);
  for (let index = 0; index <= steps; index += 1) {
    const unit = index / steps;
    const x = fire.left + fire.width * unit;
    const wave = Math.sin(now * 0.004 + unit * 10.8) * 4 + Math.sin(now * 0.002 + unit * 23) * 2;
    context.lineTo(x, topY - wave);
  }
  context.lineTo(fire.right + 12, bottomY);
  context.closePath();
  const ribbon = context.createLinearGradient(fire.centerX, topY - 20, fire.centerX, bottomY);
  ribbon.addColorStop(0, "rgba(255, 247, 188, 0)");
  ribbon.addColorStop(0.28, "rgba(255, 219, 98, 0.54)");
  ribbon.addColorStop(0.58, "rgba(255, 100, 25, 0.58)");
  ribbon.addColorStop(1, "rgba(92, 9, 7, 0.02)");
  context.fillStyle = ribbon;
  context.fill();
  context.restore();
}

function stableRandom(seed: number, min: number, max: number) {
  const raw = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  const unit = raw - Math.floor(raw);
  return min + unit * (max - min);
}

function drawFlameWisps(context: CanvasRenderingContext2D, fire: Rect, now: number, plumeCount: number, tallFlame: number) {
  const segmentWidth = fire.width / segmentCount;
  context.save();
  context.globalCompositeOperation = "lighter";
  context.filter = "blur(0.9px)";
  context.lineCap = "round";
  for (let index = 0; index < plumeCount; index += 1) {
    if (stableRandom(index + 151, 0, 1) < 0.34) continue;
    const unit = (index + 0.5) / plumeCount;
    const baseX = fire.left + fire.width * unit + layeredNoise(now, index + 30.4, 1.08) * segmentWidth * 0.34;
    const power = sampleFirePower(fire, baseX);
    const height = tallFlame * stableRandom(index + 164, 0.48, 0.86) * (0.7 + power * 0.5);
    const tipX = baseX + layeredNoise(now, index + 44.8, 0.84) * segmentWidth * 1.12;
    const tipY = fire.top + 8 - height;
    const gradient = context.createLinearGradient(baseX, fire.top + 12, tipX, tipY);
    gradient.addColorStop(0, "rgba(255, 95, 20, 0)");
    gradient.addColorStop(0.32, `rgba(255, 126, 29, ${0.22 + power * 0.18})`);
    gradient.addColorStop(0.66, `rgba(255, 221, 101, ${0.18 + power * 0.16})`);
    gradient.addColorStop(1, "rgba(255, 246, 197, 0)");
    context.strokeStyle = gradient;
    context.lineWidth = clamp(segmentWidth * stableRandom(index + 175, 0.5, 0.98), 7, 14);
    context.beginPath();
    context.moveTo(baseX, fire.top + 11);
    context.bezierCurveTo(
      baseX - segmentWidth * stableRandom(index + 181, 0.25, 0.9),
      fire.top - height * 0.22,
      tipX + segmentWidth * stableRandom(index + 188, -0.48, 0.42),
      fire.top - height * 0.62,
      tipX,
      tipY
    );
    context.stroke();
  }
  context.restore();
}

function drawFlameTongue(context: CanvasRenderingContext2D, x: number, baseY: number, width: number, height: number, lean: number, power: number, layer: FlameLayer) {
  const tipX = x + lean;
  const tipY = baseY - height;
  const leftBase = x - width * 0.52;
  const rightBase = x + width * 0.52;
  const waist = height * (layer === "outer" ? 0.42 : layer === "middle" ? 0.48 : 0.54);
  const shoulder = width * (layer === "outer" ? 0.86 : layer === "middle" ? 0.66 : 0.48);
  const curl = (lean >= 0 ? 1 : -1) * width * 0.2 + Math.sin((x + height) * 0.037) * width * 0.16;
  const leftWaistX = x - width * (layer === "outer" ? 0.2 : 0.14) + curl * 0.24;
  const rightWaistX = x + width * (layer === "outer" ? 0.22 : 0.16) + curl * 0.18;
  context.save();
  context.globalAlpha =
    layer === "outer" ? 0.5 + power * 0.26 : layer === "middle" ? 0.5 + power * 0.22 : layer === "inner" ? 0.44 + power * 0.2 : 0.38 + power * 0.18;
  context.shadowColor = layer === "outer" ? "rgba(239, 52, 18, 0.28)" : "rgba(255, 188, 52, 0.24)";
  context.shadowBlur = layer === "outer" ? 10 : 5;
  context.beginPath();
  context.moveTo(leftBase, baseY);
  context.bezierCurveTo(x - shoulder, baseY - height * 0.18, leftWaistX, baseY - waist, tipX - width * 0.13, tipY + height * 0.17);
  context.bezierCurveTo(tipX - width * 0.03, tipY + height * 0.06, tipX - width * 0.02, tipY + height * 0.02, tipX, tipY);
  context.bezierCurveTo(tipX + width * 0.28, tipY + height * 0.16, rightWaistX, baseY - waist * 0.92, x + shoulder * 0.86, baseY - height * 0.2);
  context.bezierCurveTo(x + width * 0.26, baseY - height * 0.08, x - width * 0.22, baseY - height * 0.1, leftBase, baseY);
  context.closePath();
  const gradient = context.createLinearGradient(x, baseY, tipX, tipY);
  if (layer === "outer") {
    gradient.addColorStop(0, "rgba(76, 7, 5, 0)");
    gradient.addColorStop(0.18, "rgba(160, 22, 10, 0.5)");
    gradient.addColorStop(0.46, "rgba(250, 82, 20, 0.82)");
    gradient.addColorStop(0.76, "rgba(255, 178, 55, 0.42)");
    gradient.addColorStop(1, "rgba(255, 237, 167, 0)");
  } else if (layer === "middle") {
    gradient.addColorStop(0, "rgba(255, 89, 21, 0)");
    gradient.addColorStop(0.26, "rgba(255, 118, 27, 0.76)");
    gradient.addColorStop(0.64, "rgba(255, 213, 84, 0.74)");
    gradient.addColorStop(0.9, "rgba(255, 250, 206, 0.22)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  } else if (layer === "inner") {
    gradient.addColorStop(0, "rgba(255, 175, 42, 0)");
    gradient.addColorStop(0.36, "rgba(255, 218, 83, 0.68)");
    gradient.addColorStop(0.74, "rgba(255, 255, 214, 0.62)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  } else {
    gradient.addColorStop(0, "rgba(255, 214, 93, 0)");
    gradient.addColorStop(0.5, "rgba(255, 252, 219, 0.66)");
    gradient.addColorStop(0.86, "rgba(255, 255, 255, 0.46)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  }
  context.fillStyle = gradient;
  context.fill();
  context.restore();
}

function drawFloatingFlameParticles(context: CanvasRenderingContext2D) {
  for (const particle of flameParticles) {
    const t = clamp(particle.age / particle.life, 0, 1);
    const power = segmentStrengths.value[particle.segment] || baseFire;
    const alpha = (1 - t) * clamp(power + 0.08, 0, 1) * (particle.kind === "ember" ? 0.8 : 0.22);
    if (alpha <= 0.01) continue;
    context.save();
    context.translate(particle.x, particle.y);
    context.rotate(Math.sin(particle.age * 3.6 + particle.spin) * 0.32);
    context.globalAlpha = alpha;
    if (particle.kind === "ember") {
      context.fillStyle = "#ffd66b";
      context.shadowColor = "rgba(255, 111, 28, 0.78)";
      context.shadowBlur = 10;
      context.beginPath();
      context.arc(0, 0, particle.size * (1 - t * 0.5), 0, Math.PI * 2);
      context.fill();
    } else {
      const radiusX = particle.size * (0.42 + t * 0.1);
      const radiusY = particle.size * (0.9 - t * 0.3);
      const gradient = context.createRadialGradient(0, -radiusY * 0.34, 1, 0, 0, radiusY);
      gradient.addColorStop(0, `rgba(255, 247, 195, ${alpha})`);
      gradient.addColorStop(0.42, `rgba(255, 145, 35, ${alpha * 0.76})`);
      gradient.addColorStop(1, "rgba(134, 18, 8, 0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

function drawFlames(context: CanvasRenderingContext2D, width: number, height: number, fire: Rect | null, now: number) {
  context.clearRect(0, 0, width, height);
  if (!fire) return;
  context.save();
  context.globalCompositeOperation = "lighter";
  if (flameStyle.value === "ribbon") drawRibbonFlames(context, fire, now);
  else drawLegacyFlames(context, fire);
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

  updateSegmentStrengths(dt, now);
  if (fire) spawnFlame(now, fire);
  if (water) spawnDrop(now, water);
  updateParticles(dt, fire);
  updateHeat(dt, target, fire);
  drawFlames(flameContext, width, height, fire, now);
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
    <section ref="stage" class="flame-demo-stage" @click="actionOpen = false">
      <canvas ref="fireCanvas" class="flame-canvas" aria-hidden="true"></canvas>
      <canvas ref="smokeCanvas" class="smoke-canvas" aria-hidden="true"></canvas>

      <header class="flame-demo-head">
        <div>
          <strong>/火焰</strong>
          <span>{{ statusText }}</span>
        </div>
        <div class="flame-demo-actions">
          <button type="button" :class="{ active: flameStyle === 'legacy' }" @click.stop="setFlameStyle('legacy')">原样式</button>
          <button type="button" :class="{ active: flameStyle === 'ribbon' }" @click.stop="setFlameStyle('ribbon')">拟真火焰</button>
          <button type="button" @click.stop="resetDemo">重置</button>
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
            <p ref="waterBubble" class="prototype-bubble water-source-bubble">
              /水滴滴
            </p>
          </div>
        </article>

        <article class="prototype-message-row mine">
          <div class="prototype-bubble-wrap fire-wrap">
            <span>我的消息</span>
            <p
              ref="fireBubble"
              class="prototype-bubble fire-source-bubble"
              :class="{ stoked: boostRemainingSeconds > 0 }"
              :style="fireStyle"
              @click.stop="actionOpen = !actionOpen"
            >
              /火焰 这个气泡已经着起来了。
            </p>
            <div v-if="actionOpen" class="fire-action-popover" @click.stop>
              <button type="button" @click="stokeFire">添柴</button>
            </div>
          </div>
          <div class="prototype-avatar mine">我</div>
        </article>
      </div>

      <aside class="flame-state-panel">
        <b>prototype state</b>
        <span>style={{ flameStyle }}</span>
        <span>heat={{ heat.toFixed(3) }}</span>
        <span>avg={{ averageFire.toFixed(3) }}</span>
        <span>max={{ strongestFire.toFixed(3) }}</span>
        <span>boost={{ boostRemainingSeconds }}s</span>
        <span>{{ lastAction }}</span>
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
    linear-gradient(180deg, rgba(246, 248, 246, 0.82), rgba(230, 236, 229, 0.92)),
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.24) 0 1px, transparent 1px 44px),
    #e8eee8;
  box-shadow: 0 18px 42px rgba(25, 31, 27, 0.13);
  isolation: isolate;
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
  z-index: 20;
  min-height: 64px;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(20, 20, 20, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: rgba(247, 249, 247, 0.84);
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

.flame-demo-actions button,
.fire-action-popover button {
  min-height: 34px;
  border: 1px solid rgba(20, 20, 20, 0.12);
  border-radius: 6px;
  padding: 0 11px;
  color: #222;
  font-weight: 800;
  background: rgba(255, 255, 255, 0.9);
}

.flame-demo-actions button.active,
.fire-action-popover button {
  color: #fff;
  border-color: rgba(154, 52, 18, 0.42);
  background: #b7411e;
}

.prototype-message-stack {
  position: relative;
  z-index: 9;
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
  color: color-mix(in srgb, #111 74%, #fff calc(var(--flame-heat) * 26%));
  border: 1px solid rgba(185, 28, 28, calc(var(--flame-heat) * 0.42));
  background:
    radial-gradient(ellipse at 52% 120%, rgba(255, 237, 213, calc(var(--flame-heat) * 0.86)), transparent 64%),
    radial-gradient(ellipse at 44% 96%, rgba(248, 113, 22, calc(var(--flame-heat) * 0.36)), transparent 48%),
    linear-gradient(180deg, color-mix(in srgb, #fff 100%, #fff7ed calc(var(--flame-heat) * 100%)), color-mix(in srgb, #fff 78%, #f97316 calc(var(--flame-heat) * 22%)));
  box-shadow:
    inset 0 -18px 24px rgba(248, 113, 22, calc(var(--flame-heat) * 0.2)),
    inset 0 1px 0 rgba(255, 255, 255, 0.86),
    0 0 calc(8px + var(--flame-heat) * 30px) rgba(251, 146, 60, calc(var(--flame-heat) * 0.58)),
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
  background: radial-gradient(ellipse at 50% 100%, rgba(255, 193, 7, calc(var(--flame-heat) * 0.26)), transparent 68%);
  filter: blur(10px);
  opacity: calc(var(--flame-heat) * 0.9);
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

.fire-wrap {
  position: relative;
}

.fire-source-bubble {
  --fire-strength: 0.42;
  overflow: visible;
  cursor: pointer;
  color: #fff7dc;
  border: 1px solid rgba(255, 180, 70, calc(0.18 + var(--fire-strength) * 0.26));
  background:
    radial-gradient(ellipse at 44% -18%, rgba(255, 219, 93, calc(0.16 + var(--fire-strength) * 0.22)), transparent 42%),
    radial-gradient(ellipse at 8% 18%, rgba(255, 105, 31, 0.28), transparent 40%),
    linear-gradient(90deg, rgba(255, 198, 91, 0.1), transparent 18% 78%, rgba(255, 198, 91, 0.12)),
    linear-gradient(180deg, color-mix(in srgb, #7c200d 58%, #ff7a1a calc(var(--fire-strength) * 42%)), #351006 78%);
  box-shadow:
    inset 0 1px 0 rgba(255, 237, 213, 0.36),
    inset 0 10px 18px rgba(255, 139, 31, calc(var(--fire-strength) * 0.16)),
    inset 0 -14px 22px rgba(58, 9, 5, 0.52),
    0 -6px calc(18px + var(--fire-strength) * 24px) rgba(255, 120, 27, calc(var(--fire-strength) * 0.36)),
    0 9px 20px rgba(69, 10, 10, 0.2);
  text-shadow: 0 1px 2px rgba(32, 7, 3, 0.58);
}

.fire-source-bubble.stoked {
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 214, 0.48),
    inset 0 12px 22px rgba(255, 173, 51, calc(var(--fire-strength) * 0.22)),
    inset 0 -14px 22px rgba(58, 9, 5, 0.48),
    0 -8px calc(24px + var(--fire-strength) * 34px) rgba(255, 115, 27, calc(var(--fire-strength) * 0.5)),
    0 10px 24px rgba(69, 10, 10, 0.22);
}

.fire-source-bubble::before {
  content: "";
  position: absolute;
  left: 5%;
  right: 5%;
  top: -13px;
  height: 25px;
  border-radius: 999px 999px 52% 52%;
  background:
    radial-gradient(ellipse at 50% 12%, rgba(255, 255, 219, 0.76), transparent 28%),
    linear-gradient(90deg, transparent, rgba(255, 205, 75, 0.58) 18%, rgba(255, 94, 24, 0.72) 48%, rgba(255, 223, 99, 0.56) 74%, transparent),
    linear-gradient(180deg, rgba(255, 239, 152, 0.42), rgba(156, 31, 13, 0.08));
  filter: blur(2.4px);
  opacity: calc(0.74 + var(--fire-strength) * 0.22);
  pointer-events: none;
  animation: fireRimFlicker 1.1s ease-in-out infinite;
}

.fire-source-bubble::after {
  content: "";
  position: absolute;
  inset: -112px -44px 12px;
  z-index: -1;
  border-radius: 46%;
  background:
    radial-gradient(ellipse at 50% 86%, rgba(255, 238, 167, calc(var(--fire-strength) * 0.16)), transparent 24%),
    radial-gradient(ellipse at 50% 92%, rgba(255, 111, 28, calc(var(--fire-strength) * 0.25)), transparent 54%),
    radial-gradient(ellipse at 50% 98%, rgba(101, 13, 9, calc(var(--fire-strength) * 0.18)), transparent 72%);
  filter: blur(13px);
  pointer-events: none;
  animation: fireHeatWaver 1.6s ease-in-out infinite;
}

.fire-action-popover {
  position: absolute;
  right: 10px;
  bottom: calc(100% + 9px);
  z-index: 40;
  border: 1px solid rgba(92, 41, 10, 0.18);
  border-radius: 8px;
  padding: 6px;
  background: rgba(255, 252, 245, 0.94);
  box-shadow: 0 12px 28px rgba(69, 10, 10, 0.18);
  backdrop-filter: blur(12px);
}

.flame-state-panel {
  position: absolute;
  z-index: 20;
  left: 14px;
  bottom: 14px;
  min-width: 206px;
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

@keyframes fireRimFlicker {
  0%,
  100% {
    transform: translate3d(-1px, 0, 0) scaleX(0.98);
  }
  45% {
    transform: translate3d(2px, -1px, 0) scaleX(1.03);
  }
  72% {
    transform: translate3d(0, 1px, 0) scaleX(0.96);
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

  .flame-demo-actions button:nth-child(2) {
    font-size: 11px;
  }

  .prototype-message-stack {
    height: calc(100% - var(--safe-top) - 92px);
    padding: 26px 14px 96px;
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
