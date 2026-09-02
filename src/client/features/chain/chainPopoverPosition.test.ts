import assert from "node:assert/strict";
import test from "node:test";
import { positionChainPopover } from "./chainPopoverPosition";

const viewport = { left: 0, top: 0, right: 1125, bottom: 1228 };

test("places the compact confirmation immediately beside its anchor", () => {
  assert.deepEqual(
    positionChainPopover(
      { left: 421, top: 1049, right: 513, bottom: 1089, width: 92, height: 40 },
      { width: 102, height: 82 },
      viewport
    ),
    { x: 521, y: 1028, placement: "right" }
  );
});

test("flips to the left near the right edge", () => {
  assert.deepEqual(
    positionChainPopover(
      { left: 1010, top: 300, right: 1102, bottom: 340, width: 92, height: 40 },
      { width: 102, height: 82 },
      viewport
    ),
    { x: 900, y: 279, placement: "left" }
  );
});

test("uses the space above for a large picker near the bottom", () => {
  assert.deepEqual(
    positionChainPopover(
      { left: 421, top: 1049, right: 513, bottom: 1089, width: 92, height: 40 },
      { width: 320, height: 360 },
      viewport
    ),
    { x: 307, y: 681, placement: "above" }
  );
});

test("keeps an oversized picker inside a narrow viewport", () => {
  const position = positionChainPopover(
    { left: 250, top: 580, right: 342, bottom: 620, width: 92, height: 40 },
    { width: 336, height: 420 },
    { left: 0, top: 20, right: 360, bottom: 640 }
  );
  assert.equal(position.x, 12);
  assert.ok(position.y >= 32);
  assert.ok(position.y + 420 <= 628);
});
