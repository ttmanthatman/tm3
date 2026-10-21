import { computed, ref } from "vue";

export type ScorePoint = { x: number; y: number };
export type ScoreTransform = ScorePoint & { scale: number };
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;

export function zoomScoreAt(transform: ScoreTransform, scale: number, anchor: ScorePoint): ScoreTransform {
  const nextScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
  const ratio = nextScale / transform.scale;
  return { scale: nextScale, x: anchor.x - (anchor.x - transform.x) * ratio, y: anchor.y - (anchor.y - transform.y) * ratio };
}

export function pinchScoreAt(transform: ScoreTransform, start: [ScorePoint, ScorePoint], current: [ScorePoint, ScorePoint]): ScoreTransform {
  const midpoint = (points: [ScorePoint, ScorePoint]) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
  const distance = (points: [ScorePoint, ScorePoint]) => Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  const before = midpoint(start);
  const after = midpoint(current);
  const next = zoomScoreAt(transform, transform.scale * distance(current) / Math.max(1, distance(start)), before);
  return { ...next, x: next.x + after.x - before.x, y: next.y + after.y - before.y };
}

export function useScorePanZoom(onTap: () => void = () => {}) {
  const transform = ref<ScoreTransform>({ scale: 1, x: 0, y: 0 });
  const dragging = ref(false);
  const pointers = new Map<number, ScorePoint>();
  let gesture: { transform: ScoreTransform; points: ScorePoint[] } | null = null;
  let tap: { pointerId: number; point: ScorePoint } | null = null;
  const contentStyle = computed(() => ({ transform: `translate3d(${transform.value.x}px, ${transform.value.y}px, 0) scale(${transform.value.scale})` }));

  function reset() {
    transform.value = { scale: 1, x: 0, y: 0 };
    pointers.clear();
    gesture = null;
    tap = null;
    dragging.value = false;
  }
  function zoomBy(factor: number) {
    transform.value = zoomScoreAt(transform.value, transform.value.scale * factor, { x: 0, y: 0 });
  }
  function eventPoint(event: PointerEvent | WheelEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
  }
  function startGesture() {
    gesture = { transform: { ...transform.value }, points: [...pointers.values()].slice(0, 2) };
    dragging.value = pointers.size > 0;
  }
  function onPointerDown(event: PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    const point = eventPoint(event);
    tap = pointers.size ? null : { pointerId: event.pointerId, point };
    pointers.set(event.pointerId, point);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    startGesture();
  }
  function onPointerMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId) || !gesture) return;
    event.preventDefault();
    const point = eventPoint(event);
    if (tap && Math.hypot(point.x - tap.point.x, point.y - tap.point.y) > 8) tap = null;
    pointers.set(event.pointerId, point);
    const current = [...pointers.values()].slice(0, 2);
    if (current.length >= 2 && gesture.points.length >= 2) {
      transform.value = pinchScoreAt(gesture.transform, [gesture.points[0], gesture.points[1]], [current[0], current[1]]);
    } else {
      transform.value = { ...gesture.transform, x: gesture.transform.x + current[0].x - gesture.points[0].x, y: gesture.transform.y + current[0].y - gesture.points[0].y };
    }
  }
  function onPointerEnd(event: PointerEvent) {
    const point = eventPoint(event);
    const tapped = event.type === "pointerup" && tap?.pointerId === event.pointerId
      && Math.hypot(point.x - tap.point.x, point.y - tap.point.y) <= 8;
    if (!pointers.delete(event.pointerId)) return;
    tap = null;
    if (pointers.size) startGesture();
    else { gesture = null; dragging.value = false; }
    if (tapped) onTap();
  }
  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 160 : 1);
    transform.value = zoomScoreAt(transform.value, transform.value.scale * Math.exp(-Math.max(-250, Math.min(250, delta)) * 0.002), eventPoint(event));
  }

  return { transform, dragging, contentStyle, reset, zoomBy, onPointerDown, onPointerMove, onPointerEnd, onWheel };
}
