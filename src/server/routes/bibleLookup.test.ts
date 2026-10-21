import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { registerBibleLookupRoutes } from "./bibleLookup.js";
import type { BibleLookupRouteDependencies } from "./bibleLookup.js";

test("Bible lookup route keeps the requested translation and rejects unknown sources", async (context) => {
  const app = Fastify();
  context.after(() => app.close());
  registerBibleLookupRoutes(app, {
    prisma: {} as PrismaClient,
    requireAuth: async () => {},
    aiSettings: {} as BibleLookupRouteDependencies["aiSettings"]
  });
  const translated = await app.inject({ method: "GET", url: `/api/bible/lookup?reference=${encodeURIComponent("约翰福音 3:16")}&translation=cmncbs` });
  assert.equal(translated.statusCode, 200);
  assert.equal(translated.json().result.sourceId, "cmncbs");
  assert.match(translated.json().result.verses[0].text, /上帝爱世人/);
  const defaultSource = await app.inject({ method: "GET", url: `/api/bible/lookup?reference=${encodeURIComponent("约翰福音 3:16")}` });
  assert.equal(defaultSource.json().result.sourceId, "cmn-cu89s");
  const unknown = await app.inject({ method: "GET", url: `/api/bible/lookup?reference=${encodeURIComponent("约翰福音 3:16")}&translation=unknown` });
  assert.equal(unknown.statusCode, 200);
  assert.deepEqual(unknown.json(), { success: false, message: "暂时找不到这处经文" });
});
