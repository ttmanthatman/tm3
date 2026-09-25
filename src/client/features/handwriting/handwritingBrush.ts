import type { HandwritingPoint, HandwritingStroke } from "@shared/handwriting";

export type BrushDab = { x: number; y: number; width: number };
type BrushGeometry = { dabs: BrushDab[]; ends: number[]; speed: number };
const cache = new WeakMap<HandwritingStroke, BrushGeometry>();

// Geometry depends only on persisted coordinates, time and this stroke's settings.
// Extending a stroke only computes its new samples; replay reuses the same prefix.
export function handwritingBrushGeometry(stroke: HandwritingStroke): BrushGeometry {
  let geometry = cache.get(stroke);
  if (!geometry || geometry.ends.length > stroke.points.length) {
    geometry = { dabs: [], ends: [], speed: 0 };
    cache.set(stroke, geometry);
  }
  const brush = stroke.brush;
  if (!brush) return geometry;
  const maxWidth = 120 + brush.size * 12;
  for (let index = geometry.ends.length; index < stroke.points.length; index += 1) {
    const point = stroke.points[index];
    if (index === 0) {
      geometry.dabs.push({ x: point[0], y: point[1], width: maxWidth * 0.55 });
    } else {
      const previous: HandwritingPoint = stroke.points[index - 1];
      const dx = point[0] - previous[0];
      const dy = point[1] - previous[1];
      const distance = Math.hypot(dx, dy);
      // Equal timestamps can occur in coalesced events. A finite fallback avoids spikes.
      const elapsed = Math.max(1, point[2] - previous[2]);
      const steps = Math.min(16, Math.max(1, Math.ceil(distance / 60), Math.ceil(Math.min(elapsed, 128) / 8)));
      const dt = elapsed / steps;
      const speed = distance / elapsed;
      for (let step = 1; step <= steps; step += 1) {
        const last = geometry.dabs[geometry.dabs.length - 1];
        const smooth = 1 - Math.exp(-dt / 18);
        geometry.speed += (speed - geometry.speed) * smooth;
        const targetWidth = maxWidth * (0.12 + 0.88 / (1 + geometry.speed * brush.sensitivity / 250));
        const follow = brush.lag === 0 ? 1 : 1 - Math.exp(-dt / (brush.lag * 0.5));
        const x = previous[0] + dx * step / steps;
        const y = previous[1] + dy * step / steps;
        // Limit the trailing tip to 5% of the cell even on a very fast stroke.
        const rawX = last.x + (x - last.x) * follow;
        const rawY = last.y + (y - last.y) * follow;
        const trailing = Math.hypot(x - rawX, y - rawY);
        const scale = trailing > 500 ? 500 / trailing : 1;
        geometry.dabs.push({
          x: x + (rawX - x) * scale,
          y: y + (rawY - y) * scale,
          width: last.width + (targetWidth - last.width) * (1 - Math.exp(-dt / 24))
        });
      }
    }
    geometry.ends.push(geometry.dabs.length);
  }
  return geometry;
}
