import { onBeforeUnmount, ref, type Ref } from "vue";
import type { MessageDTO, MessageEffect } from "@shared/types";
import { clamp } from "./effectShared";

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

type DripCollisionRect = DOMRect & {
  id: number;
  layerLeft: number;
  layerRight: number;
  layerTop: number;
  layerBottom: number;
};

interface UseDripEffectOptions {
  scroller: Ref<HTMLElement | null>;
  messages: () => MessageDTO[];
  messageEffect: (message: MessageDTO) => MessageEffect | null;
  isMessageEffectPaused: (message: MessageDTO) => boolean;
}

export function useDripEffect(options: UseDripEffectOptions) {
  const dripLayer = ref<HTMLCanvasElement | null>(null);
  let dripAnimationFrame: number | undefined;
  let dripLastFrame = 0;
  let dripLastSpawn = 0;
  let dripParticles: DripParticle[] = [];

  function ensureDripPhysics() {
    const active = hasActiveDripMessages();
    if ((active || dripParticles.length) && !dripAnimationFrame) {
      dripLastFrame = 0;
      dripLastSpawn = 0;
      dripAnimationFrame = requestAnimationFrame(updateDripPhysics);
    }
  }

  function stopDripPhysics(clear = false) {
    if (dripAnimationFrame) window.cancelAnimationFrame(dripAnimationFrame);
    dripAnimationFrame = undefined;
    dripLastFrame = 0;
    dripLastSpawn = 0;
    if (clear) {
      dripParticles = [];
      const canvas = dripLayer.value;
      const context = canvas?.getContext("2d");
      if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function hasActiveDripMessages() {
    return options.messages().some((message) => options.messageEffect(message) === "drip" && !options.isMessageEffectPaused(message));
  }

  function updateDripPhysics(now: number) {
    const canvas = dripLayer.value;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      stopDripPhysics(true);
      return;
    }
    const active = hasActiveDripMessages();
    const dt = Math.min(0.042, Math.max(0.008, (dripLastFrame ? now - dripLastFrame : 16) / 1000));
    dripLastFrame = now;
    const layerSize = prepareDripCanvas(canvas, context);
    if (active && now - dripLastSpawn > 360 && dripParticles.length < 120) {
      spawnDripParticles(canvas);
      dripLastSpawn = now;
    }
    const bubbleRects = dripCollisionRects(canvas);
    const nextParticles: DripParticle[] = [];
    for (const particle of dripParticles) {
      particle.age += dt;
      if (particle.state === "attached") {
        updateAttachedDrip(particle, bubbleRects, dt);
      } else if (particle.state === "falling") {
        particle.vy += 1420 * dt;
        particle.vx *= 0.992;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        const hit = findDripHit(particle, bubbleRects);
        if (hit) {
          spawnDripSplash(nextParticles, particle, hit.layerTop);
          continue;
        }
      } else {
        particle.vy += 1180 * dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vx *= 0.965;
      }
      if (particle.y > layerSize.height + 42 || particle.x < -42 || particle.x > layerSize.width + 42) continue;
      if (particle.state === "splash" && particle.age >= particle.life) continue;
      nextParticles.push(particle);
    }
    dripParticles = nextParticles;
    drawDripFrame(context, layerSize.width, layerSize.height, dripParticles);
    if (active || dripParticles.length) {
      dripAnimationFrame = requestAnimationFrame(updateDripPhysics);
    } else {
      stopDripPhysics();
    }
  }

  function prepareDripCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      dripParticles = [];
    }
    return { width, height };
  }

  function spawnDripParticles(layer: HTMLCanvasElement) {
    const layerRect = layer.getBoundingClientRect();
    for (const { message, bubble } of activeDripBubbles().slice(-6)) {
      const rect = bubble.getBoundingClientRect();
      if (rect.bottom < layerRect.top || rect.top > layerRect.bottom) continue;
      const existing = dripParticles.filter((particle) => particle.sourceId === message.id && particle.state === "attached").length;
      if (existing >= 4) continue;
      const count = Math.random() > 0.68 ? 2 : 1;
      for (let i = 0; i < count; i += 1) {
        const seed = Math.random();
        const radius = 2.7 + seed * 2.4;
        const anchorRatio = clamp(0.12 + Math.random() * 0.76, 0.08, 0.92);
        const x = rect.left - layerRect.left + rect.width * anchorRatio;
        const y = rect.bottom - layerRect.top + radius * 0.32;
        const particle: DripParticle = {
          state: "attached",
          x,
          y,
          vx: (Math.random() - 0.5) * 16,
          vy: 0,
          radius,
          sourceId: message.id,
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

  function activeDripBubbles() {
    const root = options.scroller.value;
    if (!root) return [];
    return options.messages()
      .filter((message) => options.messageEffect(message) === "drip" && !options.isMessageEffectPaused(message))
      .map((message) => {
        const row = root.querySelector<HTMLElement>(`.message-row[data-message-id="${message.id}"]`);
        const bubble = row?.querySelector<HTMLElement>(".message-effect-drip");
        return bubble ? { message, bubble } : null;
      })
      .filter((item): item is { message: MessageDTO; bubble: HTMLElement } => !!item);
  }

  function dripCollisionRects(layer: HTMLCanvasElement) {
    const root = options.scroller.value;
    if (!root) return new Map<number, DripCollisionRect>();
    const layerRect = layer.getBoundingClientRect();
    const rects = new Map<number, DripCollisionRect>();
    for (const row of root.querySelectorAll<HTMLElement>(".message-row[data-message-id]")) {
      const id = Number(row.dataset.messageId || 0);
      if (!id) continue;
      const bubble = row.querySelector<HTMLElement>(".bubble");
      if (!bubble) continue;
      const rect = bubble.getBoundingClientRect();
      rects.set(id, Object.assign(rect, {
        id,
        layerLeft: rect.left - layerRect.left,
        layerRight: rect.right - layerRect.left,
        layerTop: rect.top - layerRect.top,
        layerBottom: rect.bottom - layerRect.top
      }));
    }
    return rects;
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

  function findDripHit(
    particle: DripParticle,
    bubbleRects: Map<number, DripCollisionRect>
  ) {
    const particleBottom = particle.y + particle.radius * (1.1 + Math.min(0.7, particle.vy / 1100));
    for (const [id, rect] of bubbleRects) {
      if (id === particle.sourceId) continue;
      if (
        particle.x >= rect.layerLeft - particle.radius &&
        particle.x <= rect.layerRight + particle.radius &&
        particleBottom >= rect.layerTop &&
        particle.y <= rect.layerBottom
      ) {
        return rect;
      }
    }
    return null;
  }

  function spawnDripSplash(nextParticles: DripParticle[], source: DripParticle, y: number) {
    const count = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i += 1) {
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
    const alpha = clamp(0.42 + particle.mass * 0.42, 0.45, 0.96);
    const neck = clamp(particle.stretch, 0, 1.45);
    const width = particle.radius * (0.82 - neck * 0.12);
    context.save();
    context.globalAlpha = alpha;
    context.beginPath();
    context.moveTo(particle.anchorX - width * 0.42, particle.anchorY - 1);
    context.bezierCurveTo(particle.anchorX - width * 0.72, particle.anchorY + particle.radius, particle.x - particle.radius * 0.96, particle.y - particle.radius * 0.7, particle.x - particle.radius * 0.8, particle.y);
    context.bezierCurveTo(particle.x - particle.radius * 0.62, particle.y + particle.radius * 1.1, particle.x + particle.radius * 0.62, particle.y + particle.radius * 1.1, particle.x + particle.radius * 0.8, particle.y);
    context.bezierCurveTo(particle.x + particle.radius * 0.96, particle.y - particle.radius * 0.7, particle.anchorX + width * 0.72, particle.anchorY + particle.radius, particle.anchorX + width * 0.42, particle.anchorY - 1);
    context.closePath();
    const gradient = context.createRadialGradient(
      particle.x - particle.radius * 0.38,
      particle.y - particle.radius * 0.52,
      particle.radius * 0.1,
      particle.x,
      particle.y + particle.radius * 0.22,
      particle.radius * (1.7 + neck * 0.52)
    );
    gradient.addColorStop(0, "rgba(255,255,255,0.96)");
    gradient.addColorStop(0.22, "rgba(205,244,255,0.82)");
    gradient.addColorStop(0.66, "rgba(56,189,248,0.58)");
    gradient.addColorStop(1, "rgba(3,105,161,0.5)");
    context.fillStyle = gradient;
    context.fill();
    drawDripHighlights(context, particle.x, particle.y, particle.radius, alpha);
    context.restore();
  }

  function drawFallingDrip(context: CanvasRenderingContext2D, particle: DripParticle) {
    const speedStretch = clamp(particle.vy / 1300, 0, 0.72);
    const radiusX = particle.radius * (1 - speedStretch * 0.2);
    const radiusY = particle.radius * (1.08 + speedStretch);
    context.save();
    context.translate(particle.x, particle.y);
    context.beginPath();
    context.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
    const gradient = context.createRadialGradient(-radiusX * 0.35, -radiusY * 0.42, radiusX * 0.12, 0, radiusY * 0.16, radiusY * 1.12);
    gradient.addColorStop(0, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.28, "rgba(186,230,253,0.78)");
    gradient.addColorStop(0.78, "rgba(14,165,233,0.68)");
    gradient.addColorStop(1, "rgba(3,105,161,0.46)");
    context.fillStyle = gradient;
    context.shadowColor = "rgba(3,105,161,0.22)";
    context.shadowBlur = 8;
    context.shadowOffsetY = 3;
    context.fill();
    context.shadowColor = "transparent";
    drawDripHighlights(context, 0, 0, particle.radius, 0.88);
    context.restore();
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

  function drawDripHighlights(context: CanvasRenderingContext2D, x: number, y: number, radius: number, alpha: number) {
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = "rgba(255,255,255,0.82)";
    context.beginPath();
    context.ellipse(x - radius * 0.34, y - radius * 0.44, radius * 0.22, radius * 0.34, -0.45, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(255,255,255,0.38)";
    context.lineWidth = Math.max(0.7, radius * 0.12);
    context.beginPath();
    context.arc(x + radius * 0.1, y + radius * 0.08, radius * 0.58, 0.55, 1.72);
    context.stroke();
    context.restore();
  }

  onBeforeUnmount(() => stopDripPhysics(true));

  return {
    dripLayer,
    ensureDripPhysics,
    stopDripPhysics
  };
}
