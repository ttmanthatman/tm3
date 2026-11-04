<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import Matter from "matter-js";
import type { Bottle } from "@shared/social";
import { api } from "../../api";
import AppModal from "../../components/ui/AppModal.vue";
import { useSocialRefresh } from "./useSocialRefresh";
const props = defineProps<{ channelId: number }>();
const emit = defineEmits<{ reading: [active: boolean] }>();
const root = ref<HTMLElement | null>(null);
const bottles = ref<Bottle[]>([]);
const transforms = ref<Record<string, string>>({});
const opened = ref<(Bottle & { text: string }) | null>(null);
const openBusy = ref(false);
const error = ref("");
const sensorStatus = ref("");
const sensorsEnabled = ref(false);
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
  try {
    const response = await api<{ bottles: Bottle[] }>(`/api/channels/${channelId}/bottles`);
    if (!disposed && channelId === props.channelId) { bottles.value = response.bottles; error.value = ""; syncBodies(); }
  } catch (e) { if (!disposed && channelId === props.channelId) error.value = e instanceof Error ? e.message : "漂流瓶加载失败"; }
}, (event) => event.channelId === props.channelId && !event.pollId);
function syncBodies() {
  for (const [id, body] of bodies) if (!bottles.value.some((bottle) => bottle.id === id)) { Matter.Composite.remove(engine.world, body); bodies.delete(id); }
  bottles.value.forEach((bottle, index) => {
    if (bodies.has(bottle.id)) return;
    const body = Matter.Bodies.rectangle(35 + index % Math.max(1, Math.floor((width - 40) / 45)) * 45, 30, 34, 62, { restitution: .32, friction: .45, frictionAir: .025, chamfer: { radius: 10 } });
    Matter.Body.setAngle(body, (index % 3 - 1) * .2);
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
  const delta = lastTime ? Math.min(1000 / 30, time - lastTime) : 1000 / 60;
  lastTime = time;
  for (const body of bodies.values()) if (shake.x || shake.y) Matter.Body.applyForce(body, body.position, { x: shake.x * .0004, y: shake.y * .0004 });
  shake = { x: 0, y: 0 };
  Matter.Engine.update(engine, delta);
  transforms.value = Object.fromEntries([...bodies].map(([id, body]) => [id, `translate(${body.position.x - 28}px, ${body.position.y - 37}px) rotate(${body.angle}rad)`]));
  if (sensorsEnabled.value || [...bodies.values()].some((body) => !body.isSleeping)) frame = requestAnimationFrame(tick);
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
type PermissionConstructor = { requestPermission?: () => Promise<string> };
async function enableSensors() {
  if (sensorsEnabled.value) { sensorsEnabled.value = false; detachSensors(); engine.gravity.x = 0; engine.gravity.y = 1; sensorStatus.value = "已关闭摇晃感应"; return; }
  if (!window.isSecureContext || !("DeviceMotionEvent" in window)) { sensorStatus.value = "此设备暂不支持感应，瓶子仍会自然沉积"; return; }
  try {
    const constructors: PermissionConstructor[] = [window.DeviceMotionEvent as unknown as PermissionConstructor, window.DeviceOrientationEvent as unknown as PermissionConstructor];
    const permissions = await Promise.all(constructors.map((ctor) => ctor?.requestPermission ? ctor.requestPermission() : Promise.resolve("granted")));
    if (disposed) return;
    if (permissions.some((permission) => permission !== "granted")) { sensorStatus.value = "未启用权限，瓶子仍会自然沉积"; return; }
    sensorsEnabled.value = true; sensorStatus.value = "已启用摇晃感应"; attachSensors(); start();
  } catch { sensorStatus.value = "未启用感应，瓶子仍会自然沉积"; }
}
function lifecycle() { pause(); detachSensors(); attachSensors(); start(); if (!document.hidden) void refresh(); }
function pageHide() { pageActive = false; pause(); detachSensors(); }
function pageShow() { pageActive = true; lifecycle(); }
async function open(bottle: Bottle) {
  if (openBusy.value) return;
  openBusy.value = true;
  const channelId = props.channelId;
  try {
    const result = await api<Bottle & { text: string }>(`/api/channels/${channelId}/bottles/${bottle.id}/open`, { method: "POST" });
    if (channelId !== props.channelId || disposed) return;
    opened.value = result; emit("reading", true); pause(); detachSensors();
    bottles.value = bottles.value.filter((item) => item.id !== bottle.id); syncBodies();
  } catch (e) { error.value = e instanceof Error ? e.message : "打开失败"; void refresh(); }
  finally { openBusy.value = false; }
}
function close() { opened.value = null; emit("reading", false); attachSensors(); start(); }
watch(() => props.channelId, () => { close(); bottles.value = []; syncBodies(); void refresh(); });
onMounted(() => {
  observer = new ResizeObserver(resize); if (root.value) observer.observe(root.value);
  const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; lifecycle(); });
  if (root.value) intersection.observe(root.value);
  stopIntersection = () => intersection.disconnect();
  document.addEventListener("visibilitychange", lifecycle); window.addEventListener("pagehide", pageHide); window.addEventListener("pageshow", pageShow);
  resize();
});
let stopIntersection = () => {};
onBeforeUnmount(() => { disposed = true; pause(); detachSensors(); observer?.disconnect(); stopIntersection(); Matter.Composite.clear(engine.world, false); Matter.Engine.clear(engine); emit("reading", false); document.removeEventListener("visibilitychange", lifecycle); window.removeEventListener("pagehide", pageHide); window.removeEventListener("pageshow", pageShow); });
</script>
<template>
  <div ref="root" class="bottle-shore">
    <button v-for="bottle in bottles" :key="bottle.id" type="button" class="shore-bottle" :style="{ transform: transforms[bottle.id] || 'translate(0,0)' }" :disabled="openBusy" aria-label="打开匿名漂流瓶" @click="open(bottle)"><span class="bottle-sprite" :style="spriteStyle(bottle.style)"></span></button>
    <div v-if="bottles.length" class="shore-controls"><button type="button" :aria-pressed="sensorsEnabled" @click="enableSensors">{{ sensorsEnabled ? '关闭摇晃' : '启用摇晃' }}</button><span role="status">{{ sensorStatus }}</span></div>
    <p v-if="error" class="shore-error" role="alert">{{ error }} <button type="button" @click="refresh">重试</button><button type="button" @click="error = ''">关闭</button></p>
    <AppModal :open="!!opened" title="一封匿名瓶中信" content-class="bottle-reading" @close="close">
      <div v-if="opened" class="bottle-letter">
        <div class="opened-bottle"><span class="bottle-sprite" :style="spriteStyle(opened.style)"></span><span class="bottle-cork"></span></div>
        <p>{{ opened.text }}</p><button type="button" class="primary-btn" @click="close">读完了，让它随风而去</button>
      </div>
    </AppModal>
  </div>
</template>
<style scoped>
.bottle-shore { position: absolute; z-index: 12; left: 0; right: 0; bottom: 100%; height: 190px; pointer-events: none; }
.bottle-shore :deep(.modal-shell) { pointer-events: auto; }
.shore-bottle { position: absolute; left: 0; top: 0; width: 56px; height: 74px; border: 0; padding: 0; background: transparent; cursor: pointer; pointer-events: auto; filter: drop-shadow(0 3px 2px #0004); }
.bottle-sprite { display: block; width: 100%; height: 100%; background-image: url('/bottles/bottles.webp'); background-size: 400% 300%; background-repeat: no-repeat; }
.shore-controls { position: absolute; right: 8px; bottom: 150px; display: flex; flex-direction: column; align-items: end; gap: 4px; max-width: 65%; font-size: 11px; }
.shore-controls button, .shore-error button { pointer-events: auto; border: 1px solid var(--line); border-radius: 15px; padding: 5px 9px; background: var(--panel); color: var(--text); }
.shore-controls span { background: var(--panel); border-radius: 6px; }
.shore-error { position: absolute; bottom: 80px; background: var(--panel); color: var(--text); padding: 8px; }
.bottle-letter { padding: 18px; max-height: 70dvh; overflow: auto; }
.bottle-letter p { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.9; padding: 14px; color: #533d28; background: #f8edd5; border-radius: 5px; }
.opened-bottle { position: relative; width: 100px; height: 130px; margin: 16px auto; }
.opened-bottle .bottle-sprite { clip-path: inset(14% 0 0); transform: rotate(-12deg); }
.bottle-cork { position: absolute; top: 0; right: 4px; width: 16px; height: 13px; background: #b59160; border-radius: 3px; transform: rotate(32deg); box-shadow: inset -4px -2px 4px #715431; }
</style>
