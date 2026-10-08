// The true-v1 nib uses the same contact centre as the other natural brushes.
// Only its tail profile and distance-driven paper fold differ.
export type NibPoint = { x: number; y: number };
export type TrueBrushShape = NibPoint & { width: number; angle: number; spread: number; contact: number };
export type TrueBrushFold = {
  source: TrueBrushShape;
  pin: NibPoint;
  heading: number;
  reflectedSide: -1 | 1;
  creaseStart: number;
  distance: number;
  travel: number;
};

export function trueBrushControlPoints(shape: TrueBrushShape, expansion = 0): NibPoint[] {
  const width = Math.max(1, shape.width + expansion);
  const spread = Math.max(0.12, Math.min(1, shape.spread));
  const halfWidth = width * 0.5 * (0.78 + 0.22 * spread);
  const length = width * (0.42 + 0.28 * spread);
  const tail = -length * 1.5;
  const nose = length * (0.58 + 0.16 * (1 - spread));
  const alongSide = [
    [tail, 0], [tail * 0.6, halfWidth * 0.18],
    [length * 0.04, halfWidth], [nose * 0.68, halfWidth * 0.62],
    [nose, 0], [nose * 0.68, -halfWidth * 0.62],
    [length * 0.04, -halfWidth], [tail * 0.6, -halfWidth * 0.18]
  ];
  const dx = Math.cos(shape.angle);
  const dy = Math.sin(shape.angle);
  return alongSide.map(([along, side]) => ({
    x: shape.x + dx * along - dy * side,
    y: shape.y + dy * along + dx * side
  }));
}

function shapeOutline(shape: TrueBrushShape, expansion = 0): NibPoint[] {
  const points = trueBrushControlPoints(shape, expansion);
  return [[0, 7, 6, 5], [5, 4, 4, 3], [3, 2, 1, 0]].flatMap((indices) =>
    Array.from({ length: 16 }, (_, index) => {
      const t = index / 16;
      const weights = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3];
      return {
        x: indices.reduce((sum, pointIndex, i) => sum + points[pointIndex].x * weights[i], 0),
        y: indices.reduce((sum, pointIndex, i) => sum + points[pointIndex].y * weights[i], 0)
      };
    })
  );
}

export function foldProjection(fold: TrueBrushFold, point: NibPoint) {
  return (point.x - fold.pin.x) * Math.cos(fold.heading) + (point.y - fold.pin.y) * Math.sin(fold.heading);
}

export function trueBrushCrease(fold: TrueBrushFold) {
  return fold.creaseStart * (1 - Math.min(1, fold.travel / fold.distance));
}

export function reflectFoldPoint(fold: TrueBrushFold, point: NibPoint): NibPoint {
  const displacement = 2 * (trueBrushCrease(fold) - foldProjection(fold, point));
  return { x: point.x + displacement * Math.cos(fold.heading), y: point.y + displacement * Math.sin(fold.heading) };
}

export function beginTrueBrushFold(source: TrueBrushShape, heading: number): TrueBrushFold {
  const pin = trueBrushControlPoints(source)[0];
  const fold: TrueBrushFold = { source: { ...source }, pin, heading, reflectedSide: -1, creaseStart: 0, distance: 1, travel: 0 };
  // Slow angular following can leave the nib facing away from the preceding
  // travel heading. Start at the far edge of whichever side holds the body.
  fold.reflectedSide = foldProjection(fold, source) <= 0 ? -1 : 1;
  const projections = shapeOutline(source).map((point) => foldProjection(fold, point));
  fold.creaseStart = fold.reflectedSide === -1 ? Math.min(...projections) : Math.max(...projections);
  fold.distance = Math.max(64, Math.abs(fold.creaseStart));
  return fold;
}

export function retargetTrueBrushFold(fold: TrueBrushFold, heading: number) {
  fold.heading = heading;
  const projections = shapeOutline(fold.source).map((point) => foldProjection(fold, point));
  fold.creaseStart = fold.reflectedSide === -1 ? Math.min(...projections) : Math.max(...projections);
}

function clipFold(points: NibPoint[], fold: TrueBrushFold, reflected: boolean): NibPoint[] {
  const crease = trueBrushCrease(fold);
  const inside = (projection: number) => reflected ? (projection - crease) * fold.reflectedSide >= 0 : (projection - crease) * fold.reflectedSide <= 0;
  const clipped: NibPoint[] = [];
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const da = foldProjection(fold, a);
    const db = foldProjection(fold, b);
    if (inside(da)) clipped.push(a);
    if (inside(da) !== inside(db)) {
      const t = (crease - da) / (db - da);
      clipped.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  // Reflection reverses winding. Keep both contact layers positive so their
  // overlap deposits ink instead of cancelling in a single canvas fill.
  return reflected ? clipped.map((point) => reflectFoldPoint(fold, point)).reverse() : clipped;
}

export function trueBrushContours(shape: TrueBrushShape, fold?: TrueBrushFold, expansion = 0): NibPoint[][] {
  if (!fold) return [shapeOutline(shape, expansion)];
  // Reflect expanded glow around the physical ink crease as well. Shifting
  // its expanded tail onto the pin would make glow jump at fold release.
  const points = shapeOutline(fold.source, expansion);
  if (fold.travel >= fold.distance) return [[], points.map((point) => reflectFoldPoint(fold, point)).reverse()];
  return [clipFold(points, fold, false), clipFold(points, fold, true)];
}
