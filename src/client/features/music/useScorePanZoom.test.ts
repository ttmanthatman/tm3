import assert from "node:assert/strict";
import test from "node:test";
import { pinchScoreAt, useScorePanZoom, zoomScoreAt } from "./useScorePanZoom";

test("score zoom keeps the page point beneath the cursor fixed and bounds magnification", () => {
  assert.deepEqual(zoomScoreAt({ scale: 1, x: 10, y: 20 }, 2, { x: 100, y: 60 }), { scale: 2, x: -80, y: -20 });
  assert.equal(zoomScoreAt({ scale: 1, x: 0, y: 0 }, 100, { x: 0, y: 0 }).scale, 8);
  assert.equal(zoomScoreAt({ scale: 1, x: 0, y: 0 }, 0, { x: 0, y: 0 }).scale, .25);
});

test("a pinch combines finger separation and midpoint movement", () => {
  assert.deepEqual(pinchScoreAt({ scale: 1, x: 0, y: 0 }, [{ x: -50, y: 0 }, { x: 50, y: 0 }], [{ x: -80, y: 30 }, { x: 120, y: 30 }]), { scale: 2, x: 20, y: 30 });
});

function pointer(pointerId: number, x: number, y: number, type = "pointerup"): PointerEvent {
  return { type, pointerId, clientX: x, clientY: y, pointerType: "touch", button: 0, preventDefault() {}, currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }), setPointerCapture() {} } } as unknown as PointerEvent;
}

test("score taps toggle controls while drags, pinches and canceled pointers do not", () => {
  let controlsOpen = true;
  const zoom = useScorePanZoom(() => { controlsOpen = !controlsOpen; });
  zoom.onPointerDown(pointer(1, 100, 100));
  zoom.onPointerEnd(pointer(1, 103, 101));
  assert.equal(controlsOpen, false);
  zoom.onPointerDown(pointer(1, 100, 100));
  zoom.onPointerEnd(pointer(1, 100, 100));
  assert.equal(controlsOpen, true);
  zoom.onPointerDown(pointer(1, 100, 100));
  zoom.onPointerMove(pointer(1, 130, 100));
  zoom.onPointerMove(pointer(1, 100, 100));
  zoom.onPointerEnd(pointer(1, 100, 100));
  assert.equal(controlsOpen, true, "returning a drag to its start is not a tap");
  zoom.onPointerDown(pointer(1, 100, 100));
  zoom.onPointerDown(pointer(2, 120, 100));
  zoom.onPointerEnd(pointer(2, 120, 100));
  zoom.onPointerEnd(pointer(1, 100, 100));
  assert.equal(controlsOpen, true, "a second finger cancels tap detection even without movement");
  for (const type of ["pointercancel", "lostpointercapture"]) {
    zoom.onPointerDown(pointer(1, 100, 100));
    zoom.onPointerEnd(pointer(1, 100, 100, type));
    assert.equal(controlsOpen, true);
  }
  zoom.onPointerDown(pointer(1, 100, 100));
  zoom.reset();
  zoom.onPointerEnd(pointer(1, 100, 100));
  assert.equal(controlsOpen, true, "a page change resets pending taps");
});

test("touch pan continues smoothly after one pinch finger lifts, and fitting clears the gesture", () => {
  const zoom = useScorePanZoom();
  zoom.onPointerDown(pointer(1, 50, 100));
  zoom.onPointerDown(pointer(2, 150, 100));
  zoom.onPointerMove(pointer(2, 250, 100));
  assert.deepEqual(zoom.transform.value, { scale: 2, x: 50, y: 0 });
  zoom.onPointerEnd(pointer(2, 250, 100));
  zoom.onPointerMove(pointer(1, 70, 110));
  assert.deepEqual(zoom.transform.value, { scale: 2, x: 70, y: 10 });
  zoom.reset();
  zoom.onPointerMove(pointer(1, 90, 130));
  assert.deepEqual(zoom.transform.value, { scale: 1, x: 0, y: 0 });
  assert.equal(zoom.dragging.value, false);
});

test("a normal wheel scales at its cursor without requiring a modifier key", () => {
  const zoom = useScorePanZoom();
  let prevented = false;
  zoom.onWheel({ clientX: 150, clientY: 100, deltaY: -100, deltaMode: 0, preventDefault: () => { prevented = true; }, currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) } } as unknown as WheelEvent);
  assert.ok(zoom.transform.value.scale > 1);
  assert.ok(zoom.transform.value.x < 0);
  assert.equal(prevented, true);
});
