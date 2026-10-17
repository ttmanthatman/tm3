import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { HANDWRITING_DEFAULT_PREFERENCES, normalizeHandwritingPreferences } from "../../shared/handwriting.js";
import { biblePreferencesJson } from "../biblePreferences.js";
import { registerAuthRoutes } from "./auth.js";

function createHarness() {
  let preferences = structuredClone(HANDWRITING_DEFAULT_PREFERENCES);
  let writes = 0;
  let transactionActive = false;
  let biblePreferences: unknown;
  const prisma = {
    $queryRaw: async () => [],
    $transaction: async (action: (tx: unknown) => Promise<unknown>) => {
      transactionActive = true;
      try { return await action(prisma); }
      finally { transactionActive = false; }
    },
    account: {
      findUnique: async () => ({ handwritingPreferences: preferences, biblePreferences }),
      update: async ({ data }: { data: Prisma.AccountUpdateInput }) => {
        if (data.handwritingPreferences !== undefined) preferences = normalizeHandwritingPreferences(data.handwritingPreferences);
        if (data.biblePreferences !== undefined) biblePreferences = data.biblePreferences;
        writes++;
        return { id: 1, handwritingPreferences: preferences, biblePreferences };
      }
    }
  } as unknown as PrismaClient;
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ success: false });
    return reply.send(error);
  });
  registerAuthRoutes(app, {
    prisma,
    requireAuth: async (request, reply) => {
      if (request.headers.authorization !== "member") return reply.code(401).send({ success: false });
      Object.assign(request, { auth: { accountId: 1 } });
    },
    authLoginRateLimitMax: 100,
    settingBool: async (_key, fallback = false) => fallback,
    themeExists: async () => { assert.equal(transactionActive, false, "theme lookup must not acquire an outer connection inside the preference transaction"); return true; },
    signToken: () => "test-token",
    authDto: (account) => ({ id: account.id, handwritingPreferences: account.handwritingPreferences, biblePreferences: account.biblePreferences }),
    createAuthSession: async () => ({ id: "test-session" }),
    sessionExpiresAt: () => new Date(),
    writeLoginLog: async () => undefined,
    disconnectSessions: () => undefined,
    refreshAccountConnections: () => undefined,
    updateAccountAvatarFromUpload: async () => undefined,
    deleteOwnedReceptionRooms: async () => undefined
  });
  return { app, writes: () => writes, preferences: () => preferences };
}

test("theme validation completes before the preference transaction starts", async () => {
  const { app } = createHarness();
  try {
    const response = await app.inject({ method: "PATCH", url: "/api/me/preferences", headers: { authorization: "member" }, payload: { theme: "wechat" } });
    assert.equal(response.statusCode, 200, response.body);
  } finally { await app.close(); }
});

test("handwriting preferences save all algorithms, rotation lag bounds and selected color", async () => {
  const { app, preferences } = createHarness();
  try {
    for (const algorithm of ["follow", "slanted", "true-v1"] as const) {
      for (const rotationLag of [0, 35, 100]) {
        const next = normalizeHandwritingPreferences({
          ...HANDWRITING_DEFAULT_PREFERENCES,
          pen: "brush",
          selectedIndex: 4,
          brush: { ...HANDWRITING_DEFAULT_PREFERENCES.brush, algorithm, rotationLag, ...(algorithm === "true-v1" ? { pauseThresholdMs: 275, pausedRotationScale: 0.025 } : {}) }
        });
        const response = await app.inject({
          method: "PATCH", url: "/api/me/preferences", headers: { authorization: "member" },
          payload: { handwritingPreferences: next }
        });
        assert.equal(response.statusCode, 200, response.body);
        assert.deepEqual(response.json(), { success: true, account: { id: 1, handwritingPreferences: next } });
        assert.deepEqual(preferences(), next);
      }
    }
    const legacy = await app.inject({
      method: "PATCH", url: "/api/me/preferences", headers: { authorization: "member" },
      payload: { handwritingPreferences: { brush: { size: 45, sensitivity: 65, lag: 35, algorithm: "follow" } } }
    });
    assert.equal(legacy.statusCode, 200);
    assert.equal(legacy.json().account.handwritingPreferences.brush.rotationLag, 35);
  } finally {
    await app.close();
  }
});

test("handwriting preferences reject unauthenticated, malformed and unknown brush fields without writing", async () => {
  const { app, writes, preferences } = createHarness();
  try {
    const denied = await app.inject({
      method: "PATCH", url: "/api/me/preferences", payload: { handwritingPreferences: HANDWRITING_DEFAULT_PREFERENCES }
    });
    assert.equal(denied.statusCode, 401);
    const invalidBrushes = [
      ...[-1, 101, 1.5, "35", null].map((rotationLag) => ({ ...HANDWRITING_DEFAULT_PREFERENCES.brush, rotationLag })),
      ...[-1, 60001, 1.5, "200", null].map((pauseThresholdMs) => ({ ...HANDWRITING_DEFAULT_PREFERENCES.brush, algorithm: "true-v1", pauseThresholdMs })),
      ...[-1, 10.1, "0.1", null].map((pausedRotationScale) => ({ ...HANDWRITING_DEFAULT_PREFERENCES.brush, algorithm: "true-v1", pausedRotationScale })),
      { ...HANDWRITING_DEFAULT_PREFERENCES.brush, unknown: true }
    ];
    for (const brush of invalidBrushes) {
      const response = await app.inject({
        method: "PATCH", url: "/api/me/preferences", headers: { authorization: "member" },
        payload: { handwritingPreferences: { brush } }
      });
      assert.equal(response.statusCode, 400, response.body);
      assert.deepEqual(response.json(), { success: false });
    }
    assert.equal(writes(), 0);
    assert.deepEqual(preferences(), HANDWRITING_DEFAULT_PREFERENCES);
  } finally {
    await app.close();
  }
});

test("Bible preferences validate account options and preserve unrelated settings", async () => {
  const { app, writes } = createHarness();
  const update = (biblePreferences: unknown) => app.inject({ method: "PATCH", url: "/api/me/preferences", headers: { authorization: "member" }, payload: { biblePreferences } });
  try {
    const first = await update({ notesAlwaysPublic: true, outputFormat: "numberedVerses", shareIncludeTranslation: true, shareConfirm: false, fontSize: 24, defaultSearchMode: "text" });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().account.biblePreferences.shareIncludeTranslation, true);
    const next = await update({ fontSize: 26 });
    assert.equal(next.statusCode, 200, next.body);
    assert.deepEqual(next.json().account.biblePreferences, biblePreferencesJson({ notesAlwaysPublic: true, outputFormat: "numberedVerses", shareIncludeTranslation: true, shareConfirm: false, fontSize: 26, defaultSearchMode: "text" }));
    const before = writes();
    for (const patch of [{ shareConfirm: "false" }, { fontSize: 41 }, { fontSize: 15 }, { fontSize: 20.5 }, { defaultSearchMode: "unknown" }, { shareIncludeTranslation: null }, { notesAlwaysPublic: 1 }]) {
      const invalid = await update(patch);
      assert.equal(invalid.statusCode, 400, invalid.body);
    }
    assert.equal(writes(), before);
  } finally { await app.close(); }
});
