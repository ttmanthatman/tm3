import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import type { MessageDTO, MessageEffect } from "@shared/types";
import { clamp } from "./effectShared";
import { createDripGeometry, findDripCollision, type DripCollisionRect } from "./dripGeometry";
import { createDripSprites, DRIP_SPRITE_RADIUS } from "./dripSprites";
import { createEffectClock, DRIP_PARTICLE_LIMIT, DRIP_SOURCE_LIMIT, EFFECT_MAX_DPR } from "./effectRendering";
import { useEffectActivity } from "./useEffectActivity";

type DripParticle = {
  state: "attached" | "falling" | "splash";
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  sourceId: number;
  anchorRatio: number;
  anchorX: number;
  anchorY: number;
  mass: number;
  stretch: number;
  age: number;
  life: number;
  phase: number;
  seed: number;
};

interface UseDripEffectOptions {
  scroller: Ref<HTMLElement | null>;
  messages: () => MessageDTO[];
  messageEffect: (message: MessageDTO) => MessageEffect | null;
  isMessageEffectPaused: (message: MessageDTO) => boolean;
  enabled?: () => boolean;
}

export function useDripEffect(options: UseDripEffectOptions) {
  const dripLayer = ref<HTMLCanvasElement | null>(null);
  let dripAnimationFrame: number | undefined;
  const clock = createEffectClock();
  let dripLastSpawn = 0;
  let dripParticles: DripParticle[] = [];
  let dripSprites: ReturnType<typeof createDripSprites> | undefined;
  const geometry = createDripGeometry({ scroller: () => options.scroller.value, layer: () => dripLayer.value });
  const activeIds = computed(() => options.messages()
    .filter((message) => options.messageEffect(message) === "drip" && !options.isMessageEffectPaused(message))
    .map((message) => message.id).slice(-DRIP_SOURCE_LIMIT));
  const activeIdSet = computed(() => new Set(activeIds.value));

  function ensureDripPhysics() {
    if (!activity.active.value || !activeIds.value.length) { stopDripPhysics(true); return; }
    if (dripLayer.value && !dripAnimationFrame) {
      clock.reset();
      dripLastSpawn = 0;
      dripAnimationFrame = requestAnimationFrame(updateDripPhysics);
    }
  }

  function stopDripPhysics(clear = false) {
    if (dripAnimationFrame) window.cancelAnimationFrame(dripAnimationFrame);
    dripAnimationFrame = undefined;
    clock.reset();
    dripLastSpawn = 0;
    if (clear) {
      dripParticles = [];
      dripSprites = undefined;
      geometry.stop();
      const canvas = dripLayer.value;
      const context = canvas?.getContext("2d");
      if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function updateDripPhysics(now: number) {
    const canvas = dripLayer.value;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !activity.active.value || !activeIds.value.length) {
      stopDripPhysics(true);
      return;
    }
    const dt = clock.advance(now);
    if (dt === null) { dripAnimationFrame = requestAnimationFrame(updateDripPhysics); return; }
    const snapshot = geometry.snapshot();
    if (!snapshot) { stopDripPhysics(true); return; }
    const layerSize = prepareDripCanvas(canvas, context, snapshot);
    const bubbleRects = snapshot.rects;
    if (now - dripLastSpawn > 360 && dripParticles.length < DRIP_PARTICLE_LIMIT) {
      spawnDripParticles(bubbleRects, layerSize.height);
      dripLastSpawn = now;
    }
    const nextParticles: DripParticle[] = [];
    for (const particle of dripParticles) {
      if (!activeIdSet.value.has(particle.sourceId)) continue;
      particle.age += dt;
      if (particle.state === "attached") {
        updateAttachedDrip(particle, bubbleRects, dt);
      } else if (particle.state === "falling") {
        const previousY = particle.y;
        particle.vy += 1420 * dt;
        particle.vx *= Math.pow(0.992, dt * 60);
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        const hit = findDripCollision(particle, previousY, bubbleRects);
        if (hit) {
          spawnDripSplash(nextParticles, particle, hit.layerTop);
          continue;
        }
      } else {
        particle.vy += 1180 * dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vx *= Math.pow(0.965, dt * 60);
      }
      if (particle.y > layerSize.height + 42 || particle.x < -42 || particle.x > layerSize.width + 42) continue;
      if (particle.state === "splash" && particle.age >= particle.life) continue;
      if (nextParticles.length < DRIP_PARTICLE_LIMIT) nextParticles.push(particle);
    }
    dripParticles = nextParticles;
    drawDripFrame(context, layerSize.width, layerSize.height, dripParticles);
    dripAnimationFrame = requestAnimationFrame(updateDripPhysics);
  }

  function prepareDripCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, { width, height }: { width: number; height: number }) {
    const dpr = Math.min(EFFECT_MAX_DPR, window.devicePixelRatio || 1);
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      dripParticles = [];
    }
    return { width, height };
  }

  function spawnDripParticles(rects: Map<number, DripCollisionRect>, height: number) {
    for (const id of activeIds.value) {
      const rect = rects.get(id);
      if (!rect || rect.layerBottom < 0 || rect.layerTop > height) continue;
      const existing = dripParticles.filter((particle) => particle.sourceId === id && particle.state === "attached").length;
      if (existing >= 4) continue;
      const count = Math.random() > 0.68 ? 2 : 1;
      for (let i = 0; i < count && dripParticles.length < DRIP_PARTICLE_LIMIT; i += 1) {
        const seed = Math.random();
        const radius = 2.7 + seed * 2.4;
        const anchorRatio = clamp(0.12 + Math.random() * 0.76, 0.08, 0.92);
        const x = rect.layerLeft + rect.width * anchorRatio;
        const y = rect.layerBottom + radius * 0.32;
        const particle: DripParticle = {
          state: "attached",
          x,
          y,
          vx: (Math.random() - 0.5) * 16,
          vy: 0,
          radius,
          sourceId: id,
          anchorRatio,
          anchorX: x,
          anchorY: y - radius * 0.32,
          mass: 0.22 + Math.random() * 0.26,
          stretch: 0,
          age: 0,
          life: 2.4 + Math.random() * 2.2,
          phase: Math.random() * Math.PI * 2,
          seed
        };
        dripParticles.push(particle);
      }
    }
  }

  function updateAttachedDrip(
    particle: DripParticle,
    bubbleRects: Map<number, DripCollisionRect>,
    dt: number
  ) {
    const rect = bubbleRects.get(particle.sourceId);
    if (!rect) {
      detachDrip(particle);
      return;
    }
    particle.anchorX = rect.layerLeft + rect.width * particle.anchorRatio;
    particle.anchorY = rect.layerBottom - 1;
    particle.mass += (0.34 + particle.seed * 0.28) * dt;
    particle.radius = Math.min(7.8, particle.radius + particle.mass * 0.12 * dt);
    particle.stretch = clamp(particle.stretch + (0.32 + particle.mass * 0.42) * dt, 0, 1.45);
    particle.x = particle.anchorX;
    particle.y = particle.anchorY + particle.radius * (0.74 + particle.stretch * 1.05);
    const release = particle.mass > 1.15 + particle.seed * 0.45 || particle.age > particle.life || particle.stretch > 1.36;
    if (release) detachDrip(particle);
  }

  function detachDrip(particle: DripParticle) {
    particle.state = "falling";
    particle.vx = 0;
    particle.vy = 110 + particle.mass * 72;
    particle.age = 0;
    particle.life = 2.8;
  }

  function spawnDripSplash(nextParticles: DripParticle[], source: DripParticle, y: number) {
    const count = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count && nextParticles.length < DRIP_PARTICLE_LIMIT; i += 1) {
      const angle = Math.PI + (Math.PI * i) / Math.max(1, count - 1) + (Math.random() - 0.5) * 0.34;
      const speed = 90 + Math.random() * 220 + Math.min(170, source.vy * 0.16);
      nextParticles.push({
        state: "splash",
        x: source.x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 70,
        radius: Math.max(1.4, source.radius * (0.22 + Math.random() * 0.22)),
        sourceId: source.sourceId,
        anchorRatio: source.anchorRatio,
        anchorX: source.x,
        anchorY: y,
        mass: source.mass,
        stretch: 0,
        age: 0,
        life: 0.28 + Math.random() * 0.22,
        phase: Math.random() * Math.PI * 2,
        seed: Math.random()
      });
    }
  }

  function drawDripFrame(context: CanvasRenderingContext2D, width: number, height: number, particles: DripParticle[]) {
    context.clearRect(0, 0, width, height);
    for (const particle of particles) {
      if (particle.state === "attached") drawAttachedDrip(context, particle);
      else if (particle.state === "falling") drawFallingDrip(context, particle);
      else drawSplashDrip(context, particle);
    }
  }

  function drawAttachedDrip(context: CanvasRenderingContext2D, particle: DripParticle) {
    const atlas = dripSprites ??= createDripSprites();
    const texture = atlas.attached[Math.round(clamp(particle.stretch / 1.45, 0, 1) * (atlas.attached.length - 1))];
    const scale = particle.radius / DRIP_SPRITE_RADIUS;
    context.globalAlpha = clamp(0.42 + particle.mass * 0.42, 0.45, 0.96) / 0.96;
    context.drawImage(texture, particle.anchorX - 32 * scale, particle.anchorY - 8 * scale, 64 * scale, 64 * scale);
    context.globalAlpha = 1;
  }

  function drawFallingDrip(context: CanvasRenderingContext2D, particle: DripParticle) {
    const atlas = dripSprites ??= createDripSprites();
    const texture = atlas.falling[Math.round(clamp(particle.vy / (1300 * 0.72), 0, 1) * (atlas.falling.length - 1))];
    const scale = particle.radius / DRIP_SPRITE_RADIUS;
    context.drawImage(texture, particle.x - 32 * scale, particle.y - 32 * scale, 64 * scale, 64 * scale);
  }

  function drawSplashDrip(context: CanvasRenderingContext2D, particle: DripParticle) {
    const remaining = clamp(1 - particle.age / particle.life, 0, 1);
    context.save();
    context.globalAlpha = remaining * 0.82;
    context.beginPath();
    context.ellipse(particle.x, particle.y, particle.radius * (1.4 - remaining * 0.25), particle.radius * 0.72, particle.vx * 0.004, 0, Math.PI * 2);
    context.fillStyle = "rgba(186,230,253,0.9)";
    context.fill();
    context.restore();
  }

  const activity = useEffectActivity({ enabled: options.enabled, onChange: (active) => active ? ensureDripPhysics() : stopDripPhysics(true) });
  watch(activeIds, ensureDripPhysics, { flush: "post" });
  onBeforeUnmount(() => stopDripPhysics(true));

  return {
    dripLayer,
    ensureDripPhysics,
    stopDripPhysics
  };
}
