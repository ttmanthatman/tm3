import { onBeforeUnmount, ref, type Ref } from "vue";
import type { MessageDTO, MessageEffect } from "@shared/types";
import { clamp, type GravityVector } from "./effectShared";

type GooeyEdgeAnchor = { x: number; y: number; normalX: number; normalY: number; tangentX: number; tangentY: number; tangentLimit: number };
type GooeyDripParticle = {
  id: number;
  state: "attached" | "falling" | "splash";
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  sourceId: number;
  anchorX: number;
  anchorY: number;
  edgeOffset: number;
  edgeVelocity: number;
  mass: number;
  age: number;
  life: number;
  alpha: number;
};
export type GooeyBlob = { id: string; x: number; y: number; rx: number; ry: number; alpha: number; rotate: number };
export type GooeyHighlight = { id: string; x: number; y: number; rx: number; ry: number; alpha: number; rotate: number };
type BubbleLayerRect = DOMRect & { layerLeft: number; layerRight: number; layerTop: number; layerBottom: number; layerCenterX: number; layerCenterY: number };

interface UseGooeyDripEffectOptions {
  scroller: Ref<HTMLElement | null>;
  messages: () => MessageDTO[];
  messageEffect: (message: MessageDTO) => MessageEffect | null;
  isMessageEffectPaused: (message: MessageDTO) => boolean;
  gravity: () => GravityVector;
}

export function useGooeyDripEffect(options: UseGooeyDripEffectOptions) {
  const gooeyDripLayer = ref<SVGSVGElement | null>(null);
  const gooeyBlobs = ref<GooeyBlob[]>([]);
  const gooeyHighlights = ref<GooeyHighlight[]>([]);
  let gooeyAnimationFrame: number | undefined;
  let gooeyLastFrame = 0;
  let gooeyLastSpawn = 0;
  let gooeyNextId = 1;
  let gooeyParticles: GooeyDripParticle[] = [];

  function ensureGooeyDripPhysics() {
    const active = hasActiveGooeyDripMessages();
    if ((active || gooeyParticles.length) && !gooeyAnimationFrame) {
      gooeyLastFrame = 0;
      gooeyLastSpawn = 0;
      gooeyAnimationFrame = requestAnimationFrame(updateGooeyDripPhysics);
    }
  }

  function stopGooeyDripPhysics(clear = false) {
    if (gooeyAnimationFrame) window.cancelAnimationFrame(gooeyAnimationFrame);
    gooeyAnimationFrame = undefined;
    gooeyLastFrame = 0;
    gooeyLastSpawn = 0;
    if (clear) {
      gooeyParticles = [];
      gooeyBlobs.value = [];
      gooeyHighlights.value = [];
    }
  }

  function hasActiveGooeyDripMessages() {
    return options.messages().some((message) => options.messageEffect(message) === "dripGooey" && !options.isMessageEffectPaused(message));
  }

  function updateGooeyDripPhysics(now: number) {
    const layer = gooeyDripLayer.value;
    if (!layer) {
      stopGooeyDripPhysics(true);
      return;
    }
    const active = hasActiveGooeyDripMessages();
    const dt = Math.min(0.042, Math.max(0.008, (gooeyLastFrame ? now - gooeyLastFrame : 16) / 1000));
    gooeyLastFrame = now;
    const layerRect = layer.getBoundingClientRect();
    const layerSize = { width: Math.max(1, layerRect.width), height: Math.max(1, layerRect.height) };
    if (active && now - gooeyLastSpawn > 380 && gooeyParticles.length < 90) {
      spawnGooeyDripParticles(layer);
      gooeyLastSpawn = now;
    }
    const gravity = options.gravity();
    const bubbleRects = gooeyCollisionRects(layer);
    const nextParticles: GooeyDripParticle[] = [];
    for (const particle of gooeyParticles) {
      particle.age += dt;
      if (particle.state === "attached") {
        const rect = bubbleRects.get(particle.sourceId);
        if (!rect || isOutsideLayer(rect, layerSize.width, layerSize.height, 18)) continue;
        updateAttachedGooeyDrip(particle, rect, gravity, dt);
      } else if (particle.state === "falling") {
        const acceleration = 1480 * gravity.strength;
        particle.vx += gravity.x * acceleration * dt;
        particle.vy += gravity.y * acceleration * dt;
        particle.vx *= 0.992;
        particle.vy *= 0.992;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        const hit = findGooeyDripHit(particle, bubbleRects);
        if (hit) {
          spawnGooeyDripSplash(nextParticles, particle, hit.x, hit.y, gravity);
          continue;
        }
      } else {
        const acceleration = 960 * gravity.strength;
        particle.vx += gravity.x * acceleration * dt;
        particle.vy += gravity.y * acceleration * dt;
        particle.vx *= 0.94;
        particle.vy *= 0.94;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
      }
      if (isPointOutsideLayer(particle.x, particle.y, layerSize.width, layerSize.height, 44)) continue;
      if (particle.state === "splash" && particle.age > particle.life) continue;
      nextParticles.push(particle);
    }
    gooeyParticles = nextParticles;
    renderGooeyDrips(gooeyParticles, gravity);
    if (active || gooeyParticles.length) {
      gooeyAnimationFrame = requestAnimationFrame(updateGooeyDripPhysics);
    } else {
      stopGooeyDripPhysics(true);
    }
  }

  function spawnGooeyDripParticles(layer: SVGSVGElement) {
    const layerRect = layer.getBoundingClientRect();
    const gravity = options.gravity();
    for (const { message, bubble } of activeGooeyDripBubbles().slice(-5)) {
      const rect = bubble.getBoundingClientRect();
      if (rect.bottom < layerRect.top || rect.top > layerRect.bottom) continue;
      const sourceId = message.id;
      const existing = gooeyParticles.filter((particle) => particle.sourceId === sourceId && particle.state === "attached").length;
      if (existing >= 6) continue;
      const layerBubbleRect = toLayerRect(rect, layerRect);
      const count = Math.random() > 0.62 ? 2 : 1;
      for (let i = 0; i < count; i += 1) {
        const radius = 2.4 + Math.random() * 3.2;
        const edgeProbe = gooeyEdgePoint(layerBubbleRect, gravity, 0);
        const edgeLimit = Math.max(10, edgeProbe.tangentLimit * 0.92);
        const edgeOffset = (Math.random() * 2 - 1) * edgeLimit;
        const anchor = gooeyEdgePoint(layerBubbleRect, gravity, edgeOffset);
        const center = gooeyDropCenter(anchor, radius, 0.18);
        gooeyParticles.push({
          id: gooeyNextId,
          state: "attached",
          x: center.x,
          y: center.y,
          vx: 0,
          vy: 0,
          radius,
          sourceId,
          anchorX: anchor.x,
          anchorY: anchor.y,
          edgeOffset,
          edgeVelocity: 0,
          mass: 0.16 + Math.random() * 0.18,
          age: 0,
          life: 2.9 + Math.random() * 2.2,
          alpha: 0.78
        });
        gooeyNextId += 1;
      }
    }
  }

  function activeGooeyDripBubbles() {
    const root = options.scroller.value;
    if (!root) return [];
    return options.messages()
      .filter((message) => options.messageEffect(message) === "dripGooey" && !options.isMessageEffectPaused(message))
      .map((message) => {
        const row = root.querySelector<HTMLElement>(`.message-row[data-message-id="${message.id}"]`);
        const bubble = row?.querySelector<HTMLElement>(".message-effect-drip-gooey");
        return bubble ? { message, bubble } : null;
      })
      .filter((item): item is { message: MessageDTO; bubble: HTMLElement } => !!item);
  }

  function gooeyCollisionRects(layer: SVGSVGElement) {
    const root = options.scroller.value;
    if (!root) return new Map<number, BubbleLayerRect>();
    const layerRect = layer.getBoundingClientRect();
    const rects = new Map<number, BubbleLayerRect>();
    for (const row of root.querySelectorAll<HTMLElement>(".message-row[data-message-id]")) {
      const id = Number(row.dataset.messageId || 0);
      if (!id) continue;
      const bubble = row.querySelector<HTMLElement>(".bubble");
      if (!bubble) continue;
      rects.set(id, toLayerRect(bubble.getBoundingClientRect(), layerRect));
    }
    return rects;
  }

  function toLayerRect(rect: DOMRect, layerRect: DOMRect): BubbleLayerRect {
    const layerLeft = rect.left - layerRect.left;
    const layerTop = rect.top - layerRect.top;
    const layerRight = rect.right - layerRect.left;
    const layerBottom = rect.bottom - layerRect.top;
    return Object.assign(rect, {
      layerLeft,
      layerRight,
      layerTop,
      layerBottom,
      layerCenterX: (layerLeft + layerRight) / 2,
      layerCenterY: (layerTop + layerBottom) / 2
    });
  }

  function updateAttachedGooeyDrip(particle: GooeyDripParticle, rect: BubbleLayerRect, gravity: GravityVector, dt: number) {
    const edgeProbe = gooeyEdgePoint(rect, gravity, particle.edgeOffset);
    const clampedOffset = clamp(particle.edgeOffset, -edgeProbe.tangentLimit, edgeProbe.tangentLimit);
    particle.edgeVelocity += (clampedOffset - particle.edgeOffset) * 14 * dt;
    particle.edgeVelocity *= Math.pow(0.18, dt);
    particle.edgeOffset += particle.edgeVelocity * dt;
    particle.mass += (0.22 + gravity.strength * 0.16) * dt;
    particle.radius = Math.min(8.4, particle.radius + particle.mass * 0.13 * dt);
    const anchor = gooeyEdgePoint(rect, gravity, particle.edgeOffset);
    const center = gooeyDropCenter(anchor, particle.radius, particle.mass);
    particle.anchorX = anchor.x;
    particle.anchorY = anchor.y;
    const follow = 1 - Math.exp(-10 * dt);
    particle.x += (center.x - particle.x) * follow;
    particle.y += (center.y - particle.y) * follow;
    const shouldDetach = particle.mass > 1.16 || particle.age > particle.life;
    if (shouldDetach) detachGooeyDrip(particle, gravity);
  }

  function detachGooeyDrip(particle: GooeyDripParticle, gravity: GravityVector) {
    particle.state = "falling";
    const speed = 135 + particle.mass * 95;
    particle.vx += gravity.x * speed;
    particle.vy += gravity.y * speed;
    particle.age = 0;
    particle.life = 3.2;
  }

  function gooeyEdgePoint(rect: BubbleLayerRect, gravity: GravityVector, edgeOffset: number): GooeyEdgeAnchor {
    const gx = Math.abs(gravity.x) < 0.001 ? 0 : gravity.x;
    const gy = Math.abs(gravity.y) < 0.001 ? 0 : gravity.y;
    const hw = Math.max(1, rect.width / 2);
    const hh = Math.max(1, rect.height / 2);
    const scaleX = gx ? hw / Math.abs(gx) : Number.POSITIVE_INFINITY;
    const scaleY = gy ? hh / Math.abs(gy) : Number.POSITIVE_INFINITY;
    const scale = Math.min(scaleX, scaleY);
    const tangent = { x: -gy, y: gx };
    const baseX = rect.layerCenterX + gx * scale;
    const baseY = rect.layerCenterY + gy * scale;
    const maxOffsetX = tangent.x
      ? (tangent.x > 0 ? rect.layerRight - baseX : baseX - rect.layerLeft) / Math.abs(tangent.x)
      : Number.POSITIVE_INFINITY;
    const maxOffsetY = tangent.y
      ? (tangent.y > 0 ? rect.layerBottom - baseY : baseY - rect.layerTop) / Math.abs(tangent.y)
      : Number.POSITIVE_INFINITY;
    const tangentLimit = Math.max(6, Math.min(maxOffsetX, maxOffsetY) - 5);
    const offset = clamp(edgeOffset, -tangentLimit, tangentLimit);
    return {
      x: clamp(baseX + tangent.x * offset, rect.layerLeft, rect.layerRight),
      y: clamp(baseY + tangent.y * offset, rect.layerTop, rect.layerBottom),
      normalX: gx,
      normalY: gy,
      tangentX: tangent.x,
      tangentY: tangent.y,
      tangentLimit
    };
  }

  function gooeyDropCenter(anchor: GooeyEdgeAnchor, radius: number, mass: number) {
    const outsideDistance = radius * (1.08 + clamp(mass, 0, 1.3) * 0.42);
    return {
      x: anchor.x + anchor.normalX * outsideDistance,
      y: anchor.y + anchor.normalY * outsideDistance
    };
  }

  function findGooeyDripHit(particle: GooeyDripParticle, bubbleRects: Map<number, BubbleLayerRect>) {
    for (const [id, rect] of bubbleRects) {
      if (id === particle.sourceId) continue;
      const x = clamp(particle.x, rect.layerLeft, rect.layerRight);
      const y = clamp(particle.y, rect.layerTop, rect.layerBottom);
      if (Math.hypot(particle.x - x, particle.y - y) <= particle.radius + 1.5) return { x, y };
    }
    return null;
  }

  function spawnGooeyDripSplash(nextParticles: GooeyDripParticle[], source: GooeyDripParticle, x: number, y: number, gravity: GravityVector) {
    const tangent = { x: -gravity.y, y: gravity.x };
    const count = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i += 1) {
      const spread = (i / Math.max(1, count - 1) - 0.5) * 2;
      const speed = 90 + Math.random() * 140;
      nextParticles.push({
        id: gooeyNextId,
        state: "splash",
        x,
        y,
        vx: tangent.x * spread * speed - gravity.x * speed * 0.35,
        vy: tangent.y * spread * speed - gravity.y * speed * 0.35,
        radius: Math.max(1.5, source.radius * (0.22 + Math.random() * 0.24)),
        sourceId: source.sourceId,
        anchorX: x,
        anchorY: y,
        edgeOffset: 0,
        edgeVelocity: 0,
        mass: source.mass,
        age: 0,
        life: 0.32 + Math.random() * 0.22,
        alpha: 0.78
      });
      gooeyNextId += 1;
    }
  }

  function renderGooeyDrips(particles: GooeyDripParticle[], gravity: GravityVector) {
    const blobs: GooeyBlob[] = [];
    const highlights: GooeyHighlight[] = [];
    const angle = (Math.atan2(gravity.y, gravity.x) * 180) / Math.PI - 90;
    for (const particle of particles) {
      const fade = particle.state === "splash" ? clamp(1 - particle.age / particle.life, 0, 1) : 1;
      if (particle.state === "attached") {
        const bridgeX = (particle.anchorX + particle.x) / 2;
        const bridgeY = (particle.anchorY + particle.y) / 2;
        blobs.push({ id: `${particle.id}-anchor`, x: particle.anchorX, y: particle.anchorY, rx: particle.radius * 0.34, ry: particle.radius * 0.28, alpha: 0.42, rotate: angle });
        blobs.push({ id: `${particle.id}-bridge`, x: bridgeX, y: bridgeY, rx: particle.radius * 0.3, ry: Math.max(1.4, Math.hypot(particle.x - particle.anchorX, particle.y - particle.anchorY) * 0.34), alpha: 0.34, rotate: angle });
        blobs.push({ id: `${particle.id}-drop`, x: particle.x, y: particle.y, rx: particle.radius * 0.98, ry: particle.radius * (1.04 + particle.mass * 0.16), alpha: particle.alpha, rotate: angle });
      } else {
        const speedStretch = particle.state === "falling" ? clamp(Math.hypot(particle.vx, particle.vy) / 980, 0, 0.62) : 0;
        blobs.push({ id: `${particle.id}-drop`, x: particle.x, y: particle.y, rx: particle.radius * (1 - speedStretch * 0.16), ry: particle.radius * (1.03 + speedStretch), alpha: particle.alpha * fade, rotate: angle });
      }
      highlights.push({
        id: `${particle.id}-shine`,
        x: particle.x - particle.radius * 0.36,
        y: particle.y - particle.radius * 0.42,
        rx: Math.max(0.7, particle.radius * 0.16),
        ry: Math.max(1, particle.radius * 0.28),
        alpha: 0.52 * fade,
        rotate: angle - 28
      });
    }
    gooeyBlobs.value = blobs;
    gooeyHighlights.value = highlights;
  }

  function isPointOutsideLayer(x: number, y: number, width: number, height: number, margin: number) {
    return x < -margin || y < -margin || x > width + margin || y > height + margin;
  }

  function isOutsideLayer(rect: BubbleLayerRect, width: number, height: number, margin: number) {
    return rect.layerRight < -margin || rect.layerBottom < -margin || rect.layerLeft > width + margin || rect.layerTop > height + margin;
  }

  onBeforeUnmount(() => stopGooeyDripPhysics(true));

  return {
    gooeyDripLayer,
    gooeyBlobs,
    gooeyHighlights,
    ensureGooeyDripPhysics,
    stopGooeyDripPhysics
  };
}
