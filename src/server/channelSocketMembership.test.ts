import assert from "node:assert/strict";
import test from "node:test";
import { leaveAccountSocketsFromChannel } from "./channelSocketMembership.js";

test("leaving a channel removes every live socket for the account from its room", () => {
  const roomsLeft: string[] = [];
  const sockets = new Map([
    ["phone", { leave: (room: string) => roomsLeft.push(`phone:${room}`) }],
    ["desktop", { leave: (room: string) => roomsLeft.push(`desktop:${room}`) }]
  ]);

  leaveAccountSocketsFromChannel(new Set(["phone", "desktop", "stale"]), (socketId) => sockets.get(socketId), 7);

  assert.deepEqual(roomsLeft, ["phone:ch:7", "desktop:ch:7"]);
});
