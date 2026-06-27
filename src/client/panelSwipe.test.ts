import {
  nextPanelAfterSwipe,
  normalizeChatPanel,
  panelDragOffset,
  panelSwitchDirection,
  resolveSwipeAxis
} from "./panelSwipe";

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

assertEqual(normalizeChatPanel("ai"), "ai", "valid saved panel");
assertEqual(normalizeChatPanel("bad-value"), "main", "invalid saved panel");

assertEqual(resolveSwipeAxis(9, 2), null, "gesture waits for lock distance");
assertEqual(resolveSwipeAxis(40, 42), "y", "diagonal scroll stays vertical");
assertEqual(resolveSwipeAxis(80, 20), "x", "clear horizontal gesture locks x");

assertEqual(panelDragOffset("future", 100), 35, "future panel resists right edge");
assertEqual(panelDragOffset("ai", -100), -35, "ai panel resists left edge");
assertEqual(panelDragOffset("main", -100), -100, "middle panel tracks drag");

assertEqual(
  nextPanelAfterSwipe({ currentPanel: "main", dx: -48, dy: 5, elapsedMs: 45, viewportWidth: 390 }),
  null,
  "short fast left flick does not switch"
);
assertEqual(
  nextPanelAfterSwipe({ currentPanel: "ai", dx: 52, dy: 4, elapsedMs: 55, viewportWidth: 390 }),
  null,
  "short fast right flick does not switch back"
);
assertEqual(
  nextPanelAfterSwipe({ currentPanel: "main", dx: -116, dy: 12, elapsedMs: 260, viewportWidth: 390 }),
  "ai",
  "deliberate left swipe opens ai panel"
);
assertEqual(
  nextPanelAfterSwipe({ currentPanel: "main", dx: 118, dy: 10, elapsedMs: 280, viewportWidth: 390 }),
  "future",
  "deliberate right swipe opens future panel"
);
assertEqual(
  nextPanelAfterSwipe({ currentPanel: "future", dx: 150, dy: 5, elapsedMs: 220, viewportWidth: 390 }),
  null,
  "future panel cannot switch past left edge"
);
assertEqual(
  nextPanelAfterSwipe({ currentPanel: "main", dx: -85, dy: 80, elapsedMs: 240, viewportWidth: 390 }),
  null,
  "diagonal gesture does not switch"
);

assertEqual(panelSwitchDirection("main", "ai"), 1, "ai enters from right");
assertEqual(panelSwitchDirection("main", "future"), -1, "future enters from left");

console.log("panelSwipe tests passed");
