<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { Body, Engine, IEventCollision } from "matter-js";
import {
  OOPS_MAX_GLYPHS_PER_MESSAGE,
  OOPS_MAX_GLYPHS_PER_PAGE,
  sampleWithoutReplacement,
  segmentTextGraphemes
} from "../oopsText";
import { keepReturningBodyAwake, returnHasSettled } from "../oopsPhysics";

type MatterModule = typeof import("matter-js");
type GlyphCandidate = {
  node: Text;
  text: string;
  start: number;
  end: number;
};
type FallingGlyph = {
  id: number;
  messageId: number;
  body: Body;
  element: HTMLSpanElement;
  origin: HTMLSpanElement;
};
type ActiveMessage = {
  id: number;
  bubble: HTMLElement;
  glyphs: FallingGlyph[];
  startedAt: number;
  state: "falling" | "returning";
  returnStartedAt: number;
};
type ActiveChange = { messageId: number; active: boolean };

const emit = defineEmits<{ "active-change": [change: ActiveChange] }>();
const layer = ref<HTMLElement | null>(null);
const activeMessages = new Map<number, ActiveMessage>();
const bubbleTargets = new Map<number, HTMLElement>();
const hitAt = new WeakMap<HTMLElement, number>();
let matter: MatterModule | null = null;
let matterPromise: Promise<MatterModule> | null = null;
let engine: Engine | null = null;
let staticBodies: Body[] = [];
let animationFrame = 0;
let layoutFrame = 0;
let lastFrameAt = 0;
let nextGlyphId = 1;
let boundScroller: HTMLElement | null = null;
let mutationObserver: MutationObserver | null = null;

function loadMatter() {
  if (!matterPromise) matterPromise = import("matter-js");
  return matterPromise;
}

function chatPane() {
  return layer.value?.parentElement instanceof HTMLElement ? layer.value.parentElement : null;
}

function messagesScroller() {
  return chatPane()?.querySelector<HTMLElement>(".messages-scroll") || null;
}

function composerElement() {
  return chatPane()?.querySelector<HTMLElement>(".composer") || null;
}

function isInteractiveTextNode(node: Text, root: HTMLElement) {
  const parent = node.parentElement;
  if (!parent || !root.contains(parent)) return true;
  return !!parent.closest("a, button, .inline-bible-reference, .markdown-render, [contenteditable='true']");
}

function collectCandidates(root: HTMLElement) {
  const candidates: GlyphCandidate[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    if (!isInteractiveTextNode(node, root)) {
      for (const slice of segmentTextGraphemes(node.data)) {
        if (!slice.text.trim()) continue;
        const range = document.createRange();
        range.setStart(node, slice.start);
        range.setEnd(node, slice.end);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) candidates.push({ node, text: slice.text, start: slice.start, end: slice.end });
      }
    }
    current = walker.nextNode();
  }
  return candidates;
}

function wrapSelectedCandidates(candidates: GlyphCandidate[]) {
  const wrapped: Array<{ text: string; origin: HTMLSpanElement }> = [];
  const byNode = new Map<Text, GlyphCandidate[]>();
  for (const candidate of candidates) {
    const group = byNode.get(candidate.node) || [];
    group.push(candidate);
    byNode.set(candidate.node, group);
  }
  for (const [node, group] of byNode) {
    group.sort((left, right) => right.start - left.start);
    for (const candidate of group) {
      if (!node.isConnected || candidate.end > node.length) continue;
      const range = document.createRange();
      range.setStart(node, candidate.start);
      range.setEnd(node, candidate.end);
      const origin = document.createElement("span");
      origin.className = "oops-origin-glyph";
      origin.dataset.oopsOrigin = "true";
      try {
        range.surroundContents(origin);
        wrapped.push({ text: candidate.text, origin });
      } catch {
        origin.remove();
      }
    }
  }
  return wrapped;
}

function restoreOriginSpans(glyphs: FallingGlyph[]) {
  const parents = new Set<Node>();
  for (const glyph of glyphs) {
    const origin = glyph.origin;
    if (!origin.isConnected) continue;
    const parent = origin.parentNode;
    if (parent) parents.add(parent);
    origin.replaceWith(document.createTextNode(origin.textContent || ""));
  }
  for (const parent of parents) parent.normalize();
}

function applyGlyphStyle(element: HTMLSpanElement, origin: HTMLSpanElement, rect: DOMRect) {
  const style = getComputedStyle(origin);
  element.textContent = origin.textContent || "";
  element.style.width = `${Math.max(1, rect.width)}px`;
  element.style.height = `${Math.max(1, rect.height)}px`;
  element.style.font = style.font;
  element.style.fontKerning = style.fontKerning;
  element.style.fontFeatureSettings = style.fontFeatureSettings;
  element.style.fontVariationSettings = style.fontVariationSettings;
  element.style.letterSpacing = style.letterSpacing;
  element.style.textDecoration = style.textDecoration;
  element.style.textTransform = style.textTransform;
  element.style.color = style.color;
  element.style.lineHeight = `${Math.max(1, rect.height)}px`;
}

async function ensureEngine() {
  if (engine && matter) return;
  matter = await loadMatter();
  engine = matter.Engine.create({ enableSleeping: true });
  engine.gravity.x = 0;
  engine.gravity.y = 1;
  engine.gravity.scale = 0.001;
  matter.Events.on(engine, "collisionStart", handleCollisions);
}

function bodyMeta(body: Body) {
  return (body.plugin as { oops?: { kind: "glyph" | "bubble"; messageId?: number } }).oops;
}

function handleCollisions(event: IEventCollision<Engine>) {
  for (const pair of event.pairs) {
    const left = bodyMeta(pair.bodyA);
    const right = bodyMeta(pair.bodyB);
    const glyphBody = left?.kind === "glyph" ? pair.bodyA : right?.kind === "glyph" ? pair.bodyB : null;
    const bubbleBody = left?.kind === "bubble" ? pair.bodyA : right?.kind === "bubble" ? pair.bodyB : null;
    if (!glyphBody || !bubbleBody) continue;
    const speed = Math.hypot(glyphBody.velocity.x, glyphBody.velocity.y);
    if (speed < 1.35) continue;
    const target = bubbleTargets.get(bubbleBody.id);
    if (!target) continue;
    const now = performance.now();
    if (now - (hitAt.get(target) || 0) < 110) continue;
    hitAt.set(target, now);
    const direction = glyphBody.position.x < bubbleBody.position.x ? 1 : -1;
    target.style.setProperty("--oops-hit-x", `${direction * Math.min(5, 1.5 + speed * 0.45)}px`);
    target.style.setProperty("--oops-hit-rotate", `${direction * Math.min(1.8, 0.4 + speed * 0.12)}deg`);
    target.classList.remove("oops-bubble-hit");
    void target.offsetWidth;
    target.classList.add("oops-bubble-hit");
    window.setTimeout(() => target.classList.remove("oops-bubble-hit"), 360);
  }
}

function visibleBubbleElements() {
  const scroller = messagesScroller();
  if (!scroller) return [];
  const viewport = scroller.getBoundingClientRect();
  return Array.from(scroller.querySelectorAll<HTMLElement>(".message-row[data-message-id] .bubble")).filter((bubble) => {
    const row = bubble.closest<HTMLElement>(".message-row[data-message-id]");
    if (!row || row.classList.contains("system") || activeMessages.has(Number(row.dataset.messageId))) return false;
    const rect = bubble.getBoundingClientRect();
    return rect.bottom > viewport.top && rect.top < viewport.bottom;
  });
}

function rebuildStaticBodies() {
  if (!matter || !engine || !layer.value || !activeMessages.size) return;
  for (const body of staticBodies) matter.Composite.remove(engine.world, body);
  staticBodies = [];
  bubbleTargets.clear();
  const layerRect = layer.value.getBoundingClientRect();
  const composerRect = composerElement()?.getBoundingClientRect();
  const floorY = composerRect ? Math.min(layerRect.height, composerRect.bottom - layerRect.top) : layerRect.height;
  const wallThickness = 90;
  const floor = matter.Bodies.rectangle(layerRect.width / 2, floorY + wallThickness / 2, layerRect.width + wallThickness * 2, wallThickness, {
    isStatic: true,
    restitution: 0.18,
    friction: 0.72,
    label: "oops-floor"
  });
  const leftWall = matter.Bodies.rectangle(-wallThickness / 2, floorY / 2, wallThickness, floorY + wallThickness, { isStatic: true, restitution: 0.28 });
  const rightWall = matter.Bodies.rectangle(layerRect.width + wallThickness / 2, floorY / 2, wallThickness, floorY + wallThickness, { isStatic: true, restitution: 0.28 });
  staticBodies.push(floor, leftWall, rightWall);
  for (const bubble of visibleBubbleElements()) {
    const rect = bubble.getBoundingClientRect();
    const width = Math.max(4, rect.width);
    const height = Math.max(4, rect.height);
    const body = matter.Bodies.rectangle(rect.left - layerRect.left + width / 2, rect.top - layerRect.top + height / 2, width, height, {
      isStatic: true,
      restitution: 0.24,
      friction: 0.68,
      chamfer: { radius: Math.min(6, width / 4, height / 4) },
      label: "oops-bubble"
    });
    body.plugin = { ...body.plugin, oops: { kind: "bubble" } };
    staticBodies.push(body);
    bubbleTargets.set(body.id, bubble);
  }
  matter.Composite.add(engine.world, staticBodies);
}

function scheduleLayoutRefresh() {
  if (!activeMessages.size || layoutFrame) return;
  layoutFrame = window.requestAnimationFrame(() => {
    layoutFrame = 0;
    rebuildStaticBodies();
  });
}

function bindLayoutListeners() {
  const scroller = messagesScroller();
  if (boundScroller !== scroller) {
    boundScroller?.removeEventListener("scroll", scheduleLayoutRefresh);
    mutationObserver?.disconnect();
    boundScroller = scroller;
    boundScroller?.addEventListener("scroll", scheduleLayoutRefresh, { passive: true });
    if (boundScroller) {
      mutationObserver = new MutationObserver(scheduleLayoutRefresh);
      mutationObserver.observe(boundScroller, { childList: true, subtree: true, characterData: true });
    }
  }
}

function currentGlyphCount() {
  let count = 0;
  for (const message of activeMessages.values()) count += message.glyphs.length;
  return count;
}

function finishMessage(messageId: number) {
  const active = activeMessages.get(messageId);
  if (!active) return;
  if (matter && engine) {
    for (const glyph of active.glyphs) matter.Composite.remove(engine.world, glyph.body);
  }
  for (const glyph of active.glyphs) glyph.element.remove();
  restoreOriginSpans(active.glyphs);
  active.bubble.classList.remove("message-effect-oops-active");
  activeMessages.delete(messageId);
  emit("active-change", { messageId, active: false });
  rebuildStaticBodies();
  if (!activeMessages.size) stopLoop();
}

function freeBudgetFor(count: number) {
  while (activeMessages.size && currentGlyphCount() + count > OOPS_MAX_GLYPHS_PER_PAGE) {
    const oldest = [...activeMessages.values()].sort((left, right) => left.startedAt - right.startedAt)[0];
    finishMessage(oldest.id);
  }
}

async function start(messageId: number, bubble: HTMLElement, textRoot: HTMLElement) {
  if (activeMessages.has(messageId) || !bubble.isConnected || !textRoot.isConnected) return false;
  await ensureEngine();
  await nextTick();
  if (!matter || !engine || !layer.value || !bubble.isConnected || !textRoot.isConnected) return false;
  const candidates = collectCandidates(textRoot);
  if (!candidates.length) return false;
  const selected = sampleWithoutReplacement(candidates, OOPS_MAX_GLYPHS_PER_MESSAGE);
  freeBudgetFor(selected.length);
  const wrapped = wrapSelectedCandidates(selected);
  if (!wrapped.length) return false;
  const layerRect = layer.value.getBoundingClientRect();
  const glyphs: FallingGlyph[] = [];
  for (const item of wrapped) {
    const rect = item.origin.getBoundingClientRect();
    if (!item.origin.isConnected || rect.width <= 0 || rect.height <= 0) {
      if (item.origin.isConnected) item.origin.replaceWith(document.createTextNode(item.origin.textContent || ""));
      continue;
    }
    const element = document.createElement("span");
    element.className = "oops-falling-glyph";
    element.dataset.messageId = String(messageId);
    element.setAttribute("aria-hidden", "true");
    applyGlyphStyle(element, item.origin, rect);
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      restore(messageId);
    });
    layer.value.append(element);
    const body = matter.Bodies.rectangle(
      rect.left - layerRect.left + rect.width / 2,
      rect.top - layerRect.top + rect.height / 2,
      Math.max(3, rect.width),
      Math.max(4, rect.height),
      {
        restitution: 0.28,
        friction: 0.48,
        frictionStatic: 0.82,
        frictionAir: 0.012,
        density: 0.0014,
        chamfer: { radius: Math.min(3, rect.width / 4, rect.height / 4) },
        label: "oops-glyph"
      }
    );
    body.plugin = { ...body.plugin, oops: { kind: "glyph", messageId } };
    matter.Body.setVelocity(body, { x: (Math.random() - 0.5) * 3.6, y: -0.8 + Math.random() * 1.5 });
    matter.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.12);
    element.style.transform = `translate3d(${body.position.x}px, ${body.position.y}px, 0) translate(-50%, -50%) rotate(${body.angle}rad)`;
    glyphs.push({ id: nextGlyphId++, messageId, body, element, origin: item.origin });
  }
  if (!glyphs.length) {
    for (const item of wrapped) {
      if (item.origin.isConnected) item.origin.replaceWith(document.createTextNode(item.origin.textContent || ""));
    }
    return false;
  }
  matter.Composite.add(engine.world, glyphs.map((glyph) => glyph.body));
  activeMessages.set(messageId, { id: messageId, bubble, glyphs, startedAt: performance.now(), state: "falling", returnStartedAt: 0 });
  bubble.classList.add("message-effect-oops-active");
  emit("active-change", { messageId, active: true });
  bindLayoutListeners();
  rebuildStaticBodies();
  startLoop();
  return true;
}

function restore(messageId: number) {
  const active = activeMessages.get(messageId);
  if (!active || active.state === "returning") return;
  active.state = "returning";
  active.returnStartedAt = performance.now();
  for (const glyph of active.glyphs) {
    glyph.body.collisionFilter.mask = 0;
    glyph.body.isSensor = true;
    glyph.body.isSleeping = false;
  }
  startLoop();
}

function updateReturning(active: ActiveMessage, now: number) {
  if (!matter || !layer.value) return;
  const elapsed = now - active.returnStartedAt;
  const layerRect = layer.value.getBoundingClientRect();
  const remainingDistances: number[] = [];
  for (const glyph of active.glyphs) {
    if (!glyph.origin.isConnected) {
      finishMessage(active.id);
      return;
    }
    keepReturningBodyAwake(matter, glyph.body);
    const targetRect = glyph.origin.getBoundingClientRect();
    const targetX = targetRect.left - layerRect.left + targetRect.width / 2;
    const targetY = targetRect.top - layerRect.top + targetRect.height / 2;
    const dx = targetX - glyph.body.position.x;
    const dy = targetY - glyph.body.position.y;
    const distance = Math.hypot(dx, dy);
    if (elapsed < 320) {
      matter.Body.setVelocity(glyph.body, {
        x: glyph.body.velocity.x * 0.9 + dx * 0.012,
        y: Math.max(-12, glyph.body.velocity.y * 0.86 - 0.62)
      });
    } else {
      const speed = Math.min(18, Math.max(2.4, distance * 0.14));
      const targetVelocity = distance > 0.01 ? { x: (dx / distance) * speed, y: (dy / distance) * speed } : { x: 0, y: 0 };
      matter.Body.setVelocity(glyph.body, {
        x: glyph.body.velocity.x * 0.72 + targetVelocity.x * 0.28,
        y: glyph.body.velocity.y * 0.72 + targetVelocity.y * 0.28
      });
    }
    let remainingDistance = distance;
    if (elapsed > 1_200) {
      const ease = elapsed > 1_800 ? 0.3 : 0.16;
      const nextPosition = {
        x: glyph.body.position.x + dx * ease,
        y: glyph.body.position.y + dy * ease
      };
      matter.Body.setPosition(glyph.body, nextPosition);
      remainingDistance = distance * (1 - ease);
      if (remainingDistance <= 1.2) {
        matter.Body.setPosition(glyph.body, { x: targetX, y: targetY });
        matter.Body.setVelocity(glyph.body, { x: 0, y: 0 });
        remainingDistance = 0;
      }
    }
    remainingDistances.push(remainingDistance);
    matter.Body.setAngularVelocity(glyph.body, glyph.body.angularVelocity * 0.84);
    matter.Body.setAngle(glyph.body, glyph.body.angle * 0.88);
  }
  if (returnHasSettled(elapsed, remainingDistances)) finishMessage(active.id);
}

function sourceStillVisible(active: ActiveMessage) {
  const scroller = messagesScroller();
  if (!scroller || !active.bubble.isConnected) return false;
  const viewport = scroller.getBoundingClientRect();
  const rect = active.bubble.getBoundingClientRect();
  return rect.bottom > viewport.top && rect.top < viewport.bottom;
}

function renderFrame(now: number) {
  animationFrame = 0;
  if (!matter || !engine || !activeMessages.size) return;
  const delta = lastFrameAt ? Math.min(33.333, Math.max(8, now - lastFrameAt)) : 16.667;
  lastFrameAt = now;
  matter.Engine.update(engine, delta);
  for (const active of [...activeMessages.values()]) {
    if (!sourceStillVisible(active)) {
      finishMessage(active.id);
      continue;
    }
    if (active.state === "returning") updateReturning(active, now);
    for (const glyph of active.glyphs) {
      glyph.element.style.transform = `translate3d(${glyph.body.position.x}px, ${glyph.body.position.y}px, 0) translate(-50%, -50%) rotate(${glyph.body.angle}rad)`;
    }
  }
  if (activeMessages.size) animationFrame = window.requestAnimationFrame(renderFrame);
}

function startLoop() {
  if (animationFrame) return;
  lastFrameAt = 0;
  animationFrame = window.requestAnimationFrame(renderFrame);
}

function stopLoop() {
  if (animationFrame) window.cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  lastFrameAt = 0;
}

function reset() {
  for (const messageId of [...activeMessages.keys()]) finishMessage(messageId);
}

function isActive(messageId: number) {
  return activeMessages.has(messageId);
}

onMounted(() => {
  window.addEventListener("resize", scheduleLayoutRefresh, { passive: true });
  nextTick(bindLayoutListeners);
});

onBeforeUnmount(() => {
  reset();
  stopLoop();
  if (layoutFrame) window.cancelAnimationFrame(layoutFrame);
  boundScroller?.removeEventListener("scroll", scheduleLayoutRefresh);
  mutationObserver?.disconnect();
  window.removeEventListener("resize", scheduleLayoutRefresh);
  if (matter && engine) matter.Events.off(engine, "collisionStart", handleCollisions);
});

defineExpose({ start, restore, reset, isActive });
</script>

<template>
  <div ref="layer" class="oops-physics-layer" aria-hidden="true"></div>
</template>
