<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import Matter from "matter-js";
import type { Bottle } from "@shared/social";
import { api } from "../../api";
import BottleLetter from "./BottleLetter.vue";
import { bottleMotion } from "./bottleMotion";
import { useSocialRefresh } from "./useSocialRefresh";
const props = defineProps<{ channelId: number }>();
const emit = defineEmits<{ reading: [active: boolean] }>();
const root = ref<HTMLElement | null>(null);
const bottles = ref<Bottle[]>([]);
const transforms = ref<Record<string, string>>({});
const opened = ref<(Bottle & { text: string }) | null>(null);
const openBusy = ref(false);
const error = ref("");
const sensorsEnabled = bottleMotion.enabled;
let listRevision = 0;
const engine = Matter.Engine.create({ enableSleeping: true });
const bodies = new Map<string, Matter.Body>();
let walls: Matter.Body[] = [];
let frame = 0;
let lastTime = 0;
let observer: ResizeObserver | null = null;
let visible = true;
let pageActive = true;
let disposed = false;
let width = 320;
const height = 190;
let shake = { x: 0, y: 0 };
const spriteStyle = (style: number) => ({ backgroundPosition: `${style % 4 * 100 / 3}% ${Math.floor(style / 4) * 50}%` });
const refresh = useSocialRefresh(async () => {
  const channelId = props.channelId;
  const revision = listRevision;
  try {
    const response = await api<{ bottles: Bottle[] }>(`/api/channels/${channelId}/bottles`);
    if (!disposed && channelId === props.channelId && revision === listRevision) { bottles.value = response.bottles; error.value = ""; syncBodies(); }
  } catch (e) { if (!disposed && channelId === props.channelId) error.value = e instanceof Error ? e.message : "漂流瓶加载失败"; }
}, (event) => event.channelId === props.channelId && !event.pollId, (event) => {
  listRevision++;
  if (event.removedBottleId) {
    bottles.value = bottles.value.filter((bottle) => bottle.id !== event.removedBottleId);
    syncBodies();
  }
});
function syncBodies() {
  for (const [id, body] of bodies) if (!bottles.value.some((bottle) => bottle.id === id)) { Matter.Composite.remove(engine.world, body); bodies.delete(id); }
  bottles.value.forEach((bottle, index) => {
    if (bodies.has(bottle.id)) return;
    const body = Matter.Bodies.rectangle(35 + index % Math.max(1, Math.floor((width - 40) / 45)) * 45, 30, 34, 62, { restitution: .32, friction: .45, frictionAir: .025, chamfer: { radius: 10 } });
    Matter.Body.setAngle(body, (index % 2 ? -1 : 1) * (1.1 + bottle.style % 4 * .12));
    bodies.set(bottle.id, body); Matter.Composite.add(engine.world, body);
  });
  start();
}
function resize() {
  width = root.value?.clientWidth || 320;
  Matter.Composite.remove(engine.world, walls);
  walls = [Matter.Bodies.rectangle(width / 2, height + 20, width + 80, 40, { isStatic: true }), Matter.Bodies.rectangle(-20, height / 2, 40, height * 3, { isStatic: true }), Matter.Bodies.rectangle(width + 20, height / 2, 40, height * 3, { isStatic: true }), Matter.Bodies.rectangle(width / 2, -60, width + 80, 40, { isStatic: true })];
  Matter.Composite.add(engine.world, walls);
  for (const body of bodies.values()) { Matter.Body.setPosition(body, { x: Math.max(28, Math.min(width - 28, body.position.x)), y: Math.min(height - 34, body.position.y) }); Matter.Sleeping.set(body, false); }
  start();
}
function tick(time: number) {
  frame = 0;
  if (disposed || document.hidden || !visible || !pageActive || opened.value || !bodies.size) return;
  const delta = lastTime ? Math.min(1000 / 60, time - lastTime) : 1000 / 60;
  lastTime = time;
  for (const body of bodies.values()) if (shake.x || shake.y) Matter.Body.applyForce(body, body.position, { x: shake.x * .0004, y: shake.y * .0004 });
  shake = { x: 0, y: 0 };
  Matter.Engine.update(engine, delta);
  transforms.value = Object.fromEntries([...bodies].map(([id, body]) => [id, `translate(${body.position.x - 28}px, ${body.position.y - 37}px) rotate(${body.angle}rad)`]));
  if ([...bodies.values()].some((body) => !body.isSleeping)) frame = requestAnimationFrame(tick);
}
function start() { if (!frame && !disposed && !document.hidden && visible && pageActive && !opened.value && bodies.size) { lastTime = 0; frame = requestAnimationFrame(tick); } }
function pause() { cancelAnimationFrame(frame); frame = 0; lastTime = 0; }
function motion(event: DeviceMotionEvent) {
  const a = event.acceleration;
  if (!a || a.x === null || a.y === null) return;
  const angle = (screen.orientation?.angle || 0) * Math.PI / 180;
  const x = Math.max(-12, Math.min(12, a.x)); const y = Math.max(-12, Math.min(12, a.y));
  shake = { x: -(x * Math.cos(angle) - y * Math.sin(angle)), y: y * Math.cos(angle) + x * Math.sin(angle) };
  if (Math.abs(x) + Math.abs(y) > .4) { for (const body of bodies.values()) Matter.Sleeping.set(body, false); start(); }
}
function orientation(event: DeviceOrientationEvent) {
  if (event.gamma === null || event.beta === null) return;
  const angle = (screen.orientation?.angle || 0) * Math.PI / 180;
  const x = Math.sin(event.gamma * Math.PI / 180); const y = Math.sin(event.beta * Math.PI / 180);
  engine.gravity.x = x * Math.cos(angle) - y * Math.sin(angle);
  engine.gravity.y = Math.max(.2, y * Math.cos(angle) + x * Math.sin(angle));
  for (const body of bodies.values()) Matter.Sleeping.set(body, false);
  start();
}
function attachSensors() { if (!disposed && !opened.value && sensorsEnabled.value && !document.hidden && visible && pageActive) { window.addEventListener("devicemotion", motion); window.addEventListener("deviceorientation", orientation); } }
function detachSensors() { window.removeEventListener("devicemotion", motion); window.removeEventListener("deviceorientation", orientation); shake = { x: 0, y: 0 }; }
defineExpose({ requestMotionPermission: () => { void bottleMotion.request(true, true); } });
function automaticMotion(userGesture = false) {
  if (bottles.value.length && visible && pageActive && !document.hidden) void bottleMotion.request(true, userGesture);
}
function gestureMotion(event: Event) {
  if (event.isTrusted && (event.type === "click" || (event instanceof KeyboardEvent && ["Enter", " "].includes(event.key)))) automaticMotion(true);
}
watch(() => bottles.value.length > 0, (present) => { if (present) automaticMotion(); });
watch(sensorsEnabled, (enabled) => {
  detachSensors();
  if (enabled) attachSensors();
  else { engine.gravity.x = 0; engine.gravity.y = 1; for (const body of bodies.values()) Matter.Sleeping.set(body, false); start(); }
});
function lifecycle() { automaticMotion(); pause(); detachSensors(); attachSensors(); start(); if (!document.hidden) void refresh(); }
function pageHide() { pageActive = false; pause(); detachSensors(); }
function pageShow() { pageActive = true; lifecycle(); }
async function open(bottle: Bottle) {
  if (openBusy.value) return;
  openBusy.value = true;
  const channelId = props.channelId;
  try {
    const result = await api<Bottle & { text: string }>(`/api/channels/${channelId}/bottles/${bottle.id}/open`, { method: "POST" });
    if (channelId !== props.channelId || disposed) return;
    listRevision++;
    opened.value = result; emit("reading", true); pause(); detachSensors();
    bottles.value = bottles.value.filter((item) => item.id !== bottle.id); syncBodies(); void refresh();
  } catch (e) { error.value = e instanceof Error ? e.message : "打开失败"; void refresh(); }
  finally { openBusy.value = false; }
}
function close() { opened.value = null; emit("reading", false); attachSensors(); start(); }
watch(() => props.channelId, () => { listRevision++; close(); bottles.value = []; syncBodies(); void refresh(); });
onMounted(() => {
  observer = new ResizeObserver(resize); if (root.value) observer.observe(root.value);
  const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; lifecycle(); });
  if (root.value) intersection.observe(root.value);
  stopIntersection = () => intersection.disconnect();
  document.addEventListener("click", gestureMotion, true); document.addEventListener("keydown", gestureMotion, true);
  document.addEventListener("visibilitychange", lifecycle); window.addEventListener("pagehide", pageHide); window.addEventListener("pageshow", pageShow);
  resize();
});
let stopIntersection = () => {};
onBeforeUnmount(() => { disposed = true; pause(); detachSensors(); observer?.disconnect(); stopIntersection(); Matter.Composite.clear(engine.world, false); Matter.Engine.clear(engine); emit("reading", false); document.removeEventListener("click", gestureMotion, true); document.removeEventListener("keydown", gestureMotion, true); document.removeEventListener("visibilitychange", lifecycle); window.removeEventListener("pagehide", pageHide); window.removeEventListener("pageshow", pageShow); });
</script>
<template>
  <div ref="root" class="bottle-shore">
    <button v-for="bottle in bottles" :key="bottle.id" type="button" class="shore-bottle" :style="{ transform: transforms[bottle.id] || 'translate(0,0)' }" :disabled="openBusy" aria-label="打开匿名漂流瓶" @click="open(bottle)"><span class="bottle-sprite" :style="spriteStyle(bottle.style)"></span></button>
    <p v-if="error" class="shore-error" role="alert">{{ error }} <button type="button" @click="refresh">重试</button><button type="button" @click="error = ''">关闭</button></p>
    <Teleport v-if="opened" defer to=".chat-pane > .messages-viewport:not(.favorites-viewport)">
      <BottleLetter :bottle="opened" @close="close" />
    </Teleport>
  </div>
</template>
<style scoped>
.bottle-shore { position: absolute; z-index: 12; left: 0; right: 0; bottom: 100%; height: 190px; pointer-events: none; }
.shore-bottle { position: absolute; left: 0; top: 0; width: 56px; height: 74px; border: 0; padding: 0; background: transparent; cursor: pointer; pointer-events: auto; filter: drop-shadow(0 3px 2px #0004); }
.bottle-sprite { display: block; width: 100%; height: 100%; background-image: url('/bottles/bottles.webp'); background-size: 400% 300%; background-repeat: no-repeat; }
.shore-error button { pointer-events: auto; }
.shore-error { position: absolute; bottom: 80px; background: var(--panel); color: var(--text); padding: 8px; }
</style>
