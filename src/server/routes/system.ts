import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { APP_VERSION, RELEASE_DATE, RELEASE_DEVELOPER, RELEASE_NOTES } from "../../shared/release.js";
import { RELEASE_HISTORY } from "../../shared/releaseHistory.js";
import { demoModeAvailable } from "../demo/config.js";
import { applyFileResponseHeaders, applyFileValidation } from "../fileResponses.js";
import { AVATAR_DIR, BG_DIR } from "../storageDirs.js";
import { configuredUpdateBranch, UPDATE_PM2_APP, UPDATE_REPO_URL, UPDATE_RESTART_MODE } from "./adminUpdate.js";

const RELEASE_DISPLAY_DEVELOPER = process.env.APP_RELEASE_DEVELOPER || process.env.RELEASE_DEVELOPER || RELEASE_DEVELOPER;
const DEMO_MODE_AVAILABLE = demoModeAvailable();

export function registerSystemRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => ({ ok: true, name: "team-chat", time: new Date().toISOString() }));

  app.get("/api/version", async () => ({
    version: APP_VERSION,
    date: RELEASE_DATE,
    developer: RELEASE_DISPLAY_DEVELOPER,
    notes: RELEASE_NOTES,
    ...(DEMO_MODE_AVAILABLE ? { demo: { available: true as const } } : {}),
    update: {
      repoUrl: UPDATE_REPO_URL,
      branch: configuredUpdateBranch(),
      restartMode: UPDATE_RESTART_MODE,
      pm2App: UPDATE_PM2_APP
    }
  }));

  // Past-version notes are only needed when someone opens the release modal,
  // keeping the full history out of the client entry chunk.
  app.get("/api/version/history", async () => ({ history: RELEASE_HISTORY }));

  app.get("/avatars/:file", async (request, reply) => {
    const file = path.basename((request.params as { file: string }).file);
    const filePath = path.join(AVATAR_DIR, file);
    if (!fs.existsSync(filePath)) return reply.code(404).send("Not found");
    const stat = fs.statSync(filePath);
    applyFileResponseHeaders(reply, file, false);
    if (applyFileValidation(request, reply, stat)) return reply.code(304).send();
    reply.header("Cache-Control", "public, no-cache");
    reply.header("Content-Length", String(stat.size));
    return reply.send(fs.createReadStream(filePath));
  });

  app.get("/backgrounds/:file", async (request, reply) => {
    const file = path.basename((request.params as { file: string }).file);
    const filePath = path.join(BG_DIR, file);
    if (!fs.existsSync(filePath)) return reply.code(404).send("Not found");
    const stat = fs.statSync(filePath);
    applyFileResponseHeaders(reply, file, false);
    if (applyFileValidation(request, reply, stat)) return reply.code(304).send();
    reply.header("Cache-Control", "public, no-cache");
    reply.header("Content-Length", String(stat.size));
    return reply.send(fs.createReadStream(filePath));
  });
}
