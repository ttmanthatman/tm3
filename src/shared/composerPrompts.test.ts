import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPOSER_PROMPT_ANIM_MAX,
  COMPOSER_PROMPT_ANIM_MIN,
  COMPOSER_PROMPT_GAP_MAX,
  COMPOSER_PROMPT_GAP_MIN,
  COMPOSER_PROMPT_INTERVAL_MAX,
  COMPOSER_PROMPT_INTERVAL_MIN,
  DEFAULT_COMPOSER_PROMPT_APPEAR,
  DEFAULT_COMPOSER_PROMPT_DISAPPEAR,
  DEFAULT_COMPOSER_PROMPT_GAP,
  DEFAULT_COMPOSER_PROMPT_INTERVAL,
  cleanComposerPromptAppearSeconds,
  cleanComposerPromptDisappearSeconds,
  cleanComposerPromptGapSeconds,
  cleanComposerPromptIntervalSeconds,
  cleanComposerPrompts,
  composerPromptCharTiming
} from "./composerPrompts.js";

test("cleans composer prompts by trimming, dropping blanks, and capping size", () => {
  assert.deepEqual(cleanComposerPrompts(undefined), []);
  assert.deepEqual(cleanComposerPrompts("not-an-array"), []);
  assert.deepEqual(cleanComposerPrompts(["  分享下今天的恩典？ ", "", "   ", 42, "第二条"]), ["分享下今天的恩典？", "第二条"]);
  assert.equal(cleanComposerPrompts(["x".repeat(120)])[0].length, 80);
  assert.equal(cleanComposerPrompts(Array.from({ length: 60 }, (_, index) => `提示${index}`)).length, 50);
});

test("cleans the composer prompt interval into the supported range", () => {
  assert.equal(cleanComposerPromptIntervalSeconds(undefined), DEFAULT_COMPOSER_PROMPT_INTERVAL);
  assert.equal(cleanComposerPromptIntervalSeconds("not-a-number"), DEFAULT_COMPOSER_PROMPT_INTERVAL);
  assert.equal(cleanComposerPromptIntervalSeconds(0.2), COMPOSER_PROMPT_INTERVAL_MIN);
  assert.equal(cleanComposerPromptIntervalSeconds(99), COMPOSER_PROMPT_INTERVAL_MAX);
  assert.equal(cleanComposerPromptIntervalSeconds("4.5"), 4.5);
});

test("cleans the composer prompt appear and disappear times into the supported range", () => {
  assert.equal(cleanComposerPromptAppearSeconds(undefined), DEFAULT_COMPOSER_PROMPT_APPEAR);
  assert.equal(cleanComposerPromptAppearSeconds("not-a-number"), DEFAULT_COMPOSER_PROMPT_APPEAR);
  assert.equal(cleanComposerPromptAppearSeconds(0.1), COMPOSER_PROMPT_ANIM_MIN);
  assert.equal(cleanComposerPromptAppearSeconds(99), COMPOSER_PROMPT_ANIM_MAX);
  assert.equal(cleanComposerPromptAppearSeconds("2.5"), 2.5);
  assert.equal(cleanComposerPromptDisappearSeconds(undefined), DEFAULT_COMPOSER_PROMPT_DISAPPEAR);
  assert.equal(cleanComposerPromptDisappearSeconds("not-a-number"), DEFAULT_COMPOSER_PROMPT_DISAPPEAR);
  assert.equal(cleanComposerPromptDisappearSeconds(0.1), COMPOSER_PROMPT_ANIM_MIN);
  assert.equal(cleanComposerPromptDisappearSeconds(99), COMPOSER_PROMPT_ANIM_MAX);
  assert.equal(cleanComposerPromptDisappearSeconds("0.8"), 0.8);
});

test("cleans the composer prompt gap into the supported range", () => {
  assert.equal(cleanComposerPromptGapSeconds(undefined), DEFAULT_COMPOSER_PROMPT_GAP);
  assert.equal(cleanComposerPromptGapSeconds("not-a-number"), DEFAULT_COMPOSER_PROMPT_GAP);
  assert.equal(cleanComposerPromptGapSeconds(0.2), COMPOSER_PROMPT_GAP_MIN);
  assert.equal(cleanComposerPromptGapSeconds(999), COMPOSER_PROMPT_GAP_MAX);
  assert.equal(cleanComposerPromptGapSeconds("12"), 12);
});

test("char timing spreads the light-up across the animation budget", () => {
  const { stagger, duration } = composerPromptCharTiming(10, 1);
  assert.ok(stagger > 0);
  assert.ok(duration >= 0.15 && duration <= 0.5);
  assert.ok(9 * stagger + duration <= 1.2);
  const single = composerPromptCharTiming(1, 1);
  assert.equal(single.stagger, 1);
  const clamped = composerPromptCharTiming(5, 99);
  assert.ok(clamped.stagger <= COMPOSER_PROMPT_ANIM_MAX / 5 + Number.EPSILON);
});
