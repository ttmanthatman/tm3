import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { Prisma, PrismaClient } from "@prisma/client";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { DEFAULT_QUESTION_ASSISTANT_PROMPT } from "../../src/server/aiSettings.js";
import { createQuestionAssistantCatalog } from "../../src/server/services/questionAssistantCatalog.js";
import { createMusicScoreShareService } from "../../src/server/services/musicScoreLibrary.js";
import { generateQuestionAssistantReply } from "../../src/server/services/questionAssistantReply.js";
import { MUSIC_SCORE_DIR, UPLOAD_DIR } from "../../src/server/storageDirs.js";
import type { ChannelDTO, MessageDTO, MusicScoreDTO, MusicTrackDTO } from "../../src/shared/types.js";
import { focusChat } from "../helpers/chat.js";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

test.use({ serviceWorkers: "block" });
test.setTimeout(90_000);

function assertDisposableDatabase() {
  const url = new URL(process.env.DATABASE_URL || "invalid:");
  if (process.env.E2E_TEST_RUN !== "1" || process.env.NODE_ENV !== "test"
    || url.protocol !== "mysql:" || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
    || decodeURIComponent(url.pathname.slice(1)) !== "tm3_e2e") {
    throw new Error("Question assistant fixtures require the isolated local tm3_e2e runner.");
  }
}

async function login(page: Page) {
  await page.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  await focusChat(page);
  return { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("team-chat-token"))}` };
}

async function audioFixture(frequency: number) {
  const { stdout } = await promisify(execFile)("ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=${frequency}:duration=30`,
    "-ac", "1", "-ar", "22050", "-codec:a", "libmp3lame", "-f", "mp3", "pipe:1"
  ], { encoding: "buffer", maxBuffer: 2 * 1024 * 1024, timeout: 30_000 });
  return stdout;
}

function scoreFixture() {
  const stream = "BT /F1 24 Tf 48 760 Td (Assistant score fixture) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 840] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function uploadTrack(request: APIRequestContext, prisma: PrismaClient, headers: Record<string, string>, channelId: number, title: string, frequency: number) {
  const fileName = `upload-${randomUUID()}.mp3`;
  const uploaded = await request.post("/api/files/upload", { headers, multipart: {
    channelId: String(channelId), file: { name: fileName, mimeType: "audio/mpeg", buffer: await audioFixture(frequency) }
  } });
  expect(uploaded.ok()).toBe(true);
  const message = (await uploaded.json()).message as MessageDTO;
  const renamed = await request.patch(`/api/music/tracks/${message.id}`, { headers, data: { name: title } });
  expect(renamed.ok()).toBe(true);
  const track = (await renamed.json()).track as MusicTrackDTO;
  expect(track.title).toBe(title);
  expect(track.title).not.toBe(fileName);
  const stored = await prisma.message.findUniqueOrThrow({ where: { id: track.id }, select: { filePath: true } });
  return { id: track.id, title, uploadedFileName: fileName, storedFileName: stored.filePath };
}

// Keep the model deterministic and offline. The real catalog, reply protocol, score copier,
// database serialization, message components and audio player remain in this browser test.
// Model requests and the reply protocol are covered by the assistant service tests;
// this fixture does not exercise the server's asynchronous activation wiring.
test("ai_slmm native scripture, song and score replies survive reload and see newly uploaded song titles", async ({ page, request }) => {
  assertDisposableDatabase();
  const prisma = new PrismaClient();
  try {
    const headers = await login(page);
    const channels = (await (await request.get("/api/channels", { headers })).json()).channels as ChannelDTO[];
    const chat = channels.find(channel => channel.name === E2E_CHANNELS.default)!;
    const music = channels.find(channel => channel.kind === "music")!;
    expect(chat).toBeTruthy();
    expect(music).toBeTruthy();
    const account = await prisma.account.findUniqueOrThrow({ where: { username: E2E_ADMIN.username }, include: { actor: true } });
    expect(account.actor).not.toBeNull();
    // This read creates the normal built-in assistant actor without storing a key or model endpoint.
    expect((await request.get("/api/admin/ai-settings", { headers })).ok()).toBe(true);
    const assistant = await prisma.actor.findUniqueOrThrow({ where: { username: "ai_slmm" } });
    const catalog = createQuestionAssistantCatalog({ prisma, auth: { accountId: account.id, isAdmin: true, canPinMessages: false } });
    const sharing = createMusicScoreShareService(prisma, { scores: MUSIC_SCORE_DIR, uploads: UPLOAD_DIR });
    const suffix = randomUUID().slice(0, 8);
    const first = await uploadTrack(request, prisma, headers, music.id, `平安赞美诗 ${suffix}`, 440);
    const lateTitle = `后来上架的盼望赞美诗 ${suffix}`;
    expect((await catalog.search({ query: lateTitle })).tracks).toEqual([]);

    type Reply = { kind: "reply"; text: string; items: Array<{ kind: "scripture"; reference: string } | { kind: "track"; trackId: number }>; scoreIds?: number[] };
    async function reply(question: string, final: Reply, search?: { query: string; category: "all" | "tracks" | "scores"; expectedTitle: string; forbiddenNames: Array<string | null> }) {
      // Inserting only fixtures avoids invoking a real provider, even when other suites configured a fake key.
      const trigger = await prisma.message.create({ data: { channelId: chat.id, senderActorId: account.actor!.id, content: question } });
      let calls = 0;
      const searches: Awaited<ReturnType<typeof catalog.search>>[] = [];
      const output = await generateQuestionAssistantReply({
        prompt: DEFAULT_QUESTION_ASSISTANT_PROMPT,
        context: `消息：${question}`,
        complete: async (messages) => {
          if (search && calls++ === 0) return JSON.stringify({ kind: "search_music", query: search.query, category: search.category, offset: 0 });
          if (search) {
            expect(messages.at(-1)?.content).toContain(search.expectedTitle);
            for (const name of search.forbiddenNames) if (name) expect(JSON.stringify(messages)).not.toContain(name);
          }
          return JSON.stringify(final);
        },
        searchMusic: async (input) => {
          const found = await catalog.search({ query: input.query, kind: input.category, offset: input.offset });
          searches.push(found);
          return found;
        },
        resolveTrack: (id) => catalog.getTrack(id),
        canShareScore: async (id) => !!await catalog.getScore(id)
      });
      const created = [];
      for (const message of output.messages) {
        created.push(await prisma.message.create({ data: {
          channelId: chat.id, senderActorId: assistant.id, replyToId: trigger.id, content: message.content,
          payload: { ...message.payload, aiRole: "ai_slmm", triggerMessageId: trigger.id, aiActivationMode: "direct", activationAnchorMessageId: trigger.id } as Prisma.InputJsonObject
        } }));
      }
      const sharedIds: number[] = [];
      for (const scoreId of output.scoreIds) {
        const score = await catalog.getScore(scoreId);
        expect(score).not.toBeNull();
        sharedIds.push(...(await sharing.share({
          score: score!, actorId: assistant.id, channelId: chat.id, clientRequestId: randomUUID(),
          reply: { messageId: trigger.id, aiRole: "ai_slmm", activationMode: "direct", anchorMessageId: trigger.id }
        })).messageIds);
      }
      return { trigger, output, created, searches, sharedIds };
    }

    const mixed = await reply("@ai_slmm 我想听关于平安的赞美诗，也想读关于平安的经文", {
      kind: "reply", text: `**先听诗歌，再读经文。** ${suffix}`,
      items: [{ kind: "track", trackId: first.id }, { kind: "scripture", reference: "诗篇23" }]
    }, { query: first.title, category: "tracks", expectedTitle: first.title, forbiddenNames: [first.uploadedFileName, first.storedFileName] });
    expect(mixed.searches).toHaveLength(1);
    expect(mixed.searches[0].tracks).toEqual([expect.objectContaining({ id: first.id, title: first.title })]);

    const scripture = await reply("@ai_slmm 关于安慰的经文", {
      kind: "reply", text: `可以从这段经文开始。 ${suffix}`,
      items: [{ kind: "scripture", reference: "约翰福音3:16" }]
    });

    // Reuse the catalog instance after an upload: a prompt-time/static library snapshot would miss this.
    const late = await uploadTrack(request, prisma, headers, music.id, lateTitle, 660);
    const scoreName = `scan-${suffix}.pdf`;
    const pdf = scoreFixture();
    const scoreUpload = await request.put(`/api/music/tracks/${late.id}/score?title=${encodeURIComponent(`盼望钢琴谱 ${suffix}`)}`, { headers, multipart: {
      file: { name: scoreName, mimeType: "application/pdf", buffer: pdf }
    } });
    expect(scoreUpload.ok()).toBe(true);
    const score = (await scoreUpload.json()).score as MusicScoreDTO;
    const song = await reply(`@ai_slmm 我想听${late.title}，也请发送这首歌的谱子`, {
      kind: "reply", text: `这是刚上架的诗歌和曲谱。 ${suffix}`,
      items: [{ kind: "track", trackId: late.id }], scoreIds: [score.id]
    }, { query: late.title, category: "all", expectedTitle: late.title, forbiddenNames: [late.uploadedFileName, late.storedFileName, scoreName] });
    expect(song.searches).toHaveLength(1);
    expect(song.searches[0].tracks).toEqual([expect.objectContaining({ id: late.id, title: late.title })]);
    expect(song.searches[0].scores).toEqual([expect.objectContaining({ id: score.id, trackId: late.id, trackTitle: late.title })]);
    expect(song.output.scoreIds).toEqual([score.id]);
    expect(song.sharedIds).toHaveLength(1);

    await page.reload();
    await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
    await focusChat(page);
    const row = (id: number) => page.locator(`.message-row[data-message-id="${id}"]`);
    const mixedCard = row(mixed.created.find(message => (message.payload as Prisma.JsonObject)?.kind === "listen_playlist")!.id).locator(".listen-card");
    await expect(mixedCard).toBeVisible();
    await expect(mixedCard.locator(".listen-card-label")).toHaveText([first.title, "诗篇 第23章"]);
    await expect(mixedCard.getByRole("button", { name: `播放 ${first.title}`, exact: true })).toBeEnabled();
    await expect(row(mixed.created.find(message => message.content?.includes("先听诗歌"))!.id).locator(".markdown-render strong")).toHaveText("先听诗歌，再读经文。");

    const scriptureCard = row(scripture.created.find(message => (message.payload as Prisma.JsonObject)?.kind === "listen_playlist")!.id).locator(".listen-card");
    await expect(scriptureCard).toHaveClass(/bible-scripture-card/);
    await expect(scriptureCard.getByRole("link")).toHaveText("约翰福音 3:16");
    await expect(scriptureCard.getByRole("button", { name: "复制经文", exact: true })).toBeEnabled();
    await expect(scriptureCard.getByRole("button", { name: "播放经文", exact: true })).toBeEnabled();

    const songRow = row(song.created.find(message => (message.payload as Prisma.JsonObject)?.musicTrackId === late.id)!.id);
    await expect(songRow.locator(".music-mention-title")).toHaveText(late.title);
    await songRow.getByRole("button", { name: "播放歌曲", exact: true }).click();
    await expect(songRow.locator(".music-mention-capsule")).toHaveClass(/playing/);
    const player = page.getByRole("dialog", { name: "音乐播放器", exact: true });
    await expect(player).toBeVisible();
    await player.getByRole("button", { name: "关闭播放器", exact: true }).click();
    await expect(player).toBeHidden();
    await expect(songRow.getByRole("button", { name: "暂停歌曲", exact: true })).toBeVisible();
    await songRow.getByRole("button", { name: "暂停歌曲", exact: true }).click();
    await expect(songRow.getByRole("button", { name: "播放歌曲", exact: true })).toBeVisible();

    const scoreRow = row(song.sharedIds[0]);
    await expect(scoreRow.locator(".file-card")).toContainText(scoreName);
    const attachment = await request.get(`/api/files/${song.sharedIds[0]}`, { headers });
    expect(attachment.ok()).toBe(true);
    expect(await attachment.body()).toEqual(pdf);
    const sharedMessage = await prisma.message.findUniqueOrThrow({ where: { id: song.sharedIds[0] } });
    expect(sharedMessage.senderActorId).toBe(assistant.id);
    expect(sharedMessage.replyToId).toBe(song.trigger.id);
    expect(sharedMessage.payload).toMatchObject({
      sourceMusicScoreId: score.id, aiRole: "ai_slmm", aiActivationMode: "direct",
      triggerMessageId: song.trigger.id, activationAnchorMessageId: song.trigger.id
    });
  } finally {
    await prisma.$disconnect();
  }
});
