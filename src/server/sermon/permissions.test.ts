import assert from "node:assert/strict";
import test from "node:test";
import {
  SERMON_PERMANENT_UNTIL,
  canPresentSermon,
  isPermanentSermonUntil,
  sermonUntilForDuration
} from "./permissions.js";

const NOW = new Date("2026-08-27T12:00:00.000Z");

test("管理员始终有讲道权限", () => {
  assert.equal(canPresentSermon({ isAdmin: true, sermonPresenterUntil: null }, NOW), true);
  assert.equal(canPresentSermon({ isAdmin: true, sermonPresenterUntil: new Date("2000-01-01") }, NOW), true);
});

test("普通用户在有效期内有权限", () => {
  const until = new Date(NOW.getTime() + 60_000);
  assert.equal(canPresentSermon({ isAdmin: false, sermonPresenterUntil: until }, NOW), true);
});

test("普通用户过期后无权限", () => {
  const until = new Date(NOW.getTime() - 60_000);
  assert.equal(canPresentSermon({ isAdmin: false, sermonPresenterUntil: until }, NOW), false);
  // 恰好等于当前时刻也视为过期
  assert.equal(canPresentSermon({ isAdmin: false, sermonPresenterUntil: NOW }, NOW), false);
});

test("从未授权的普通用户无权限", () => {
  assert.equal(canPresentSermon({ isAdmin: false, sermonPresenterUntil: null }, NOW), false);
});

test("sermonUntilForDuration 计算各档有效期", () => {
  assert.equal(sermonUntilForDuration("24h", NOW).getTime(), NOW.getTime() + 24 * 60 * 60 * 1000);
  assert.equal(sermonUntilForDuration("7d", NOW).getTime(), NOW.getTime() + 7 * 24 * 60 * 60 * 1000);
  assert.equal(sermonUntilForDuration("30d", NOW).getTime(), NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
  assert.equal(sermonUntilForDuration("permanent", NOW).getTime(), SERMON_PERMANENT_UNTIL.getTime());
  assert.equal(isPermanentSermonUntil(sermonUntilForDuration("permanent", NOW)), true);
  assert.equal(isPermanentSermonUntil(sermonUntilForDuration("30d", NOW)), false);
  // 哨兵日期本身就有讲道权限
  assert.equal(canPresentSermon({ isAdmin: false, sermonPresenterUntil: SERMON_PERMANENT_UNTIL }, NOW), true);
});
