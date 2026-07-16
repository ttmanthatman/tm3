/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { canRemoveChannelMember, memberRoleLabel } from "./memberManagement";

test("canRemoveChannelMember allows managers to remove regular human members", () => {
  assert.equal(canRemoveChannelMember({ kind: "human", accountId: 2, role: "member" }, { canManage: true, currentAccountId: 1 }), true);
  assert.equal(canRemoveChannelMember({ kind: "human", accountId: 3, role: "admin", membershipRole: "member" }, { canManage: true, currentAccountId: 1 }), true);
  assert.equal(canRemoveChannelMember({ kind: "virtual", characterId: 7, role: "virtual" }, { canManage: true, currentAccountId: 1 }), true);
});

test("canRemoveChannelMember blocks unsafe or non-member removals", () => {
  const options = { canManage: true, currentAccountId: 1 };
  assert.equal(canRemoveChannelMember({ kind: "human", accountId: 1, role: "owner" }, options), false);
  assert.equal(canRemoveChannelMember({ kind: "human", accountId: 2, role: "owner" }, options), false);
  assert.equal(canRemoveChannelMember({ kind: "human", accountId: 3, role: "admin" }, options), false);
  assert.equal(canRemoveChannelMember({ kind: "virtual", role: "virtual" }, options), false);
  assert.equal(canRemoveChannelMember({ kind: "human", role: "member" }, options), false);
});

test("canRemoveChannelMember requires channel management permission", () => {
  assert.equal(canRemoveChannelMember({ kind: "human", accountId: 2, role: "member" }, { canManage: false, currentAccountId: 1 }), false);
});

test("memberRoleLabel keeps member grid role labels stable", () => {
  assert.equal(memberRoleLabel({ kind: "human", role: "owner" }), "创建者");
  assert.equal(memberRoleLabel({ kind: "human", role: "admin" }), "管理员");
  assert.equal(memberRoleLabel({ kind: "virtual", role: "virtual" }), "角色");
  assert.equal(memberRoleLabel({ kind: "human", role: "member" }), "");
});
