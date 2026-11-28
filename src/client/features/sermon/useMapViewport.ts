import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type { MapCamera, SermonMap } from "@shared/sermonMap";
import { mapCamera } from "./mapCamera";

type Point = { x: number; y: number };
export function useMapViewport(map: () => SermonMap, box: Ref<HTMLElement | null>,
  send: (camera: MapCamera) => void, reset: () => void) {
  const origin = crypto.randomUUID();
  const local = ref<MapCamera>();
  const width = ref(600), height = ref(360);
  const moving = ref(false);
  const camera = computed(() => local.value ?? mapCamera(map()));
  const scale = computed(() => Math.min(width.value / camera.value.width, height.value / camera.value.height));
  const style = computed(() => ({ transform: `translate(${width.value/2-camera.value.x*scale.value}px,${height.value/2-camera.value.y*scale.value}px) scale(${scale.value})` }));
  const pointers = new Map<number, Point>();
  let observer: ResizeObserver | undefined;
  let dragged = false;
  let step = map().step;
  watch(() => JSON.stringify([map().step, map().focus, map().overview, map().camera]), () => {
    if (step === map().step && map().camera?.origin === origin) return;
    step = map().step;
    pointers.clear();
    local.value = undefined;
    moving.value = false;
    reset();
  });
  onMounted(() => {
    observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width && entry.contentRect.height) {
        width.value = entry.contentRect.width;
        height.value = entry.contentRect.height;
      }
    });
    if (box.value) observer.observe(box.value);
  });
  onBeforeUnmount(() => { observer?.disconnect(); pointers.clear(); });
  function set(next: MapCamera) {
    local.value = { ...next, origin };
    send(local.value);
  }
  function point(event: MouseEvent): Point {
    const rect = box.value!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * width.value / rect.width - width.value/2,
      y: (event.clientY - rect.top) * height.value / rect.height - height.value/2 };
  }
  function pair() {
    const [a,b] = [...pointers.values()];
    return b ? { x: (a.x+b.x)/2, y: (a.y+b.y)/2, distance: Math.hypot(a.x-b.x,a.y-b.y) }
      : { ...a, distance: 0 };
  }
  function change(before: Point, after: Point, factor: number) {
    const old = scale.value;
    const zoom = Math.max(Math.max(width.value,height.value)/450000, Math.min(12,old*factor));
    const bound = (v: number) => Math.max(-240000, Math.min(240000,v));
    set({ x: bound(camera.value.x + before.x/old - after.x/zoom),
      y: bound(camera.value.y + before.y/old - after.y/zoom),
      width: width.value/zoom, height: height.value/zoom });
  }
  function down(event: PointerEvent) {
    if (event.button !== 0 || pointers.size >= 2) return;
    if (!pointers.size) dragged = false;
    pointers.set(event.pointerId,point(event));
    (event.target as Element).setPointerCapture(event.pointerId);
    if (pointers.size === 2) dragged = true;
  }
  function move(event: PointerEvent) {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    const next = point(event);
    if (!dragged && Math.hypot(last.x-next.x,last.y-next.y)<3) return;
    dragged = true;
    moving.value = true;
    const before = pair();
    pointers.set(event.pointerId,next);
    const after = pair();
    change(before,after,before.distance && after.distance ? after.distance/before.distance : 1);
  }
  function up(event: PointerEvent) {
    pointers.delete(event.pointerId);
    if (!pointers.size) moving.value = false;
  }
  function wheel(event: WheelEvent) {
    const p = point(event);
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height.value : 1);
    change(p,p,Math.exp(-Math.max(-400, Math.min(400,delta)) * (event.ctrlKey ? .01 : .002)));
  }
  function guardClick(event: MouseEvent) {
    if (dragged && event.detail) { event.stopPropagation(); event.preventDefault(); }
    dragged = false;
  }
  return { style, moving, set, down, move, up, wheel, guardClick };
}
