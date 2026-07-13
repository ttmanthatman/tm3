import assert from "node:assert/strict";
import test from "node:test";
import Matter from "matter-js";
import { keepReturningBodyAwake, returnHasSettled } from "./oopsPhysics";

test("a returning glyph keeps moving after it previously fell asleep", () => {
  const engine = Matter.Engine.create({ enableSleeping: true });
  const body = Matter.Bodies.rectangle(0, 0, 12, 18);
  Matter.Composite.add(engine.world, body);
  Matter.Sleeping.set(body, true);

  Matter.Body.setVelocity(body, { x: 0, y: -5 });
  Matter.Engine.update(engine, 16.666);
  assert.equal(body.position.y, 0);

  keepReturningBodyAwake(Matter, body);
  Matter.Body.setVelocity(body, { x: 0, y: -5 });
  Matter.Engine.update(engine, 16.666);
  assert.ok(body.position.y < -4);
});

test("return completion depends on every glyph reaching its target, not a timeout", () => {
  assert.equal(returnHasSettled(2_500, [0.2, 8]), false);
  assert.equal(returnHasSettled(300, [0.2, 0.3]), false);
  assert.equal(returnHasSettled(600, [0.2, 0.3]), true);
});
