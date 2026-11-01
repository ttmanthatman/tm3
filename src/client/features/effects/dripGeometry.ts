export type DripCollisionRect = {
  id: number;
  width: number;
  height: number;
  layerLeft: number;
  layerRight: number;
  layerTop: number;
  layerBottom: number;
};

/** Sweep the fall between paints so limiting frame rate cannot skip a thin bubble. */
export function findDripCollision(particle: {
  x: number; y: number; radius: number; vy: number; sourceId: number;
}, previousY: number, rects: Map<number, DripCollisionRect>) {
  const bottom = particle.y + particle.radius * (1.1 + Math.min(0.7, particle.vy / 1100));
  let hit: DripCollisionRect | undefined;
  for (const [id, rect] of rects) {
    if (id !== particle.sourceId && particle.x >= rect.layerLeft - particle.radius && particle.x <= rect.layerRight + particle.radius
      && bottom >= rect.layerTop && previousY <= rect.layerBottom && (!hit || rect.layerTop < hit.layerTop)) hit = rect;
  }
  return hit;
}

/** Observe stable message rows; only moving bubbles need measurements on every paint. */
export function createDripGeometry(options: {
  scroller: () => HTMLElement | null;
  layer: () => HTMLCanvasElement | null;
}) {
  let root: HTMLElement | null = null;
  let layer: HTMLCanvasElement | null = null;
  let dirty = true;
  let nodesDirty = true;
  let resize: ResizeObserver | undefined;
  let mutation: MutationObserver | undefined;
  let nodes: Array<{ id: number; row: HTMLElement; bubble: HTMLElement }> = [];
  let moving: typeof nodes = [];
  let layerRect: DOMRect;
  const rects = new Map<number, DripCollisionRect>();
  const invalidate = () => { dirty = true; };

  function stop() {
    resize?.disconnect(); mutation?.disconnect();
    root?.removeEventListener("scroll", invalidate);
    root?.removeEventListener("load", invalidate, true);
    for (const event of ["animationstart", "animationend", "animationcancel", "transitionrun", "transitionend", "transitioncancel"]) root?.removeEventListener(event, invalidate);
    window.removeEventListener("resize", invalidate);
    window.visualViewport?.removeEventListener("resize", invalidate);
    window.visualViewport?.removeEventListener("scroll", invalidate);
    root = null; layer = null; nodes = []; moving = []; rects.clear();
    dirty = true; nodesDirty = true;
  }

  function start() {
    if (root === options.scroller() && layer === options.layer()) return;
    stop(); root = options.scroller(); layer = options.layer();
    if (!root || !layer) return;
    resize = new ResizeObserver(invalidate);
    mutation = new MutationObserver((records) => {
      if (records.some((record) => record.type === "childList" || record.attributeName === "data-message-id")) nodesDirty = true;
      invalidate();
    });
    mutation.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "src", "width", "height", "data-message-id"] });
    root.addEventListener("scroll", invalidate, { passive: true });
    root.addEventListener("load", invalidate, true);
    for (const event of ["animationstart", "animationend", "animationcancel", "transitionrun", "transitionend", "transitioncancel"]) root.addEventListener(event, invalidate);
    window.addEventListener("resize", invalidate, { passive: true });
    window.visualViewport?.addEventListener("resize", invalidate, { passive: true });
    window.visualViewport?.addEventListener("scroll", invalidate, { passive: true });
  }

  function measure(node: (typeof nodes)[number]) {
    const rect = node.bubble.getBoundingClientRect();
    rects.set(node.id, {
      id: node.id, width: rect.width, height: rect.height,
      layerLeft: rect.left - layerRect.left, layerRight: rect.right - layerRect.left,
      layerTop: rect.top - layerRect.top, layerBottom: rect.bottom - layerRect.top
    });
  }

  function snapshot() {
    start();
    if (!root || !layer) return null;
    if (dirty) {
      layerRect = layer.getBoundingClientRect();
      if (nodesDirty) {
        nodes = Array.from(root.querySelectorAll<HTMLElement>(".message-row[data-message-id]"))
          .map((row) => ({ id: Number(row.dataset.messageId), row, bubble: row.querySelector<HTMLElement>(".bubble") }))
          .filter((node): node is (typeof nodes)[number] => !!node.id && !!node.bubble);
        resize?.disconnect(); resize?.observe(root); resize?.observe(layer);
        for (const node of nodes) { resize?.observe(node.row); resize?.observe(node.bubble); }
        nodesDirty = false;
      }
      rects.clear();
      moving = nodes.filter(({ row, bubble }) => [row, bubble].some((element) => element.getAnimations().some((animation) =>
        animation.playState === "running" && animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some((frame) =>
          ["transform", "translate", "rotate", "scale"].some((property) => property in frame)
        )
      )));
      for (const node of nodes) measure(node);
      dirty = false;
    } else {
      for (const node of moving) measure(node);
    }
    return { width: Math.max(1, Math.floor(layerRect.width)), height: Math.max(1, Math.floor(layerRect.height)), rects };
  }

  return { stop, snapshot };
}
