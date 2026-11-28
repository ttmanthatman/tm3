import type { MapCamera, SermonMap } from "@shared/sermonMap";

type Node = SermonMap["nodes"][number];
export const nodeWidth = 250;
export const nodeHeight = 78;
export function mapPosition(node: Node) {
  return { x: node.column * 315, y: node.row * 96 };
}

// World-space framing keeps the same center on a phone and a projector.
export function frameNodes(nodes: Node[]): MapCamera {
  const positions = nodes.map(mapPosition);
  const left = Math.min(...positions.map(p => p.x));
  const top = Math.min(...positions.map(p => p.y));
  const width = Math.max(...positions.map(p => p.x)) + nodeWidth - left;
  const height = Math.max(...positions.map(p => p.y)) + nodeHeight - top;
  return { x: left + width / 2, y: top + height / 2, width: width + 64, height: height + 64 };
}

export function familyNodes(map: SermonMap) {
  const focus = map.nodes.find(n => n.id === map.focus)!;
  return map.nodes.filter(n => n.id === focus.id || focus.parents.includes(n.id));
}

export function mapCamera(map: SermonMap) {
  return map.camera ?? frameNodes(map.overview ? map.nodes : familyNodes(map));
}

export function revealCamera(previous: SermonMap | undefined, next: SermonMap): MapCamera {
  if (!previous) return frameNodes(familyNodes(next));
  const camera = mapCamera(previous);
  const point = mapPosition(next.nodes.find(n => n.id === next.focus)!);
  // Keep the scale. Pan only as far as necessary to bring the new point into view.
  function center(old: number, start: number, size: number, span: number) {
    if (span < size + 32) return start + size / 2;
    return Math.max(start + size + 16 - span/2, Math.min(old, start - 16 + span/2));
  }
  return { ...camera, x: center(camera.x,point.x,nodeWidth,camera.width),
    y: center(camera.y,point.y,nodeHeight,camera.height) };
}
