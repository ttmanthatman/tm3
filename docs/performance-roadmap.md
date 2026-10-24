# 性能优化路线图（交接文档）

本文档记录 2026-08 加载性能专项的剩余工作，供后续会话直接接手。
已完成部分见 git 历史 `74abce0..fc014ef`（main）与 `CHANGELOG.md` 的 Unreleased 段落。
2026-10-24 状态复核（基线 `01aef47`）：下列条目已逐项对照源码更新完成状态，行号以复核当日为准。

## 已完成的优化（基线）

- 启动：localStorage 消息窗口缓存即时渲染；bootstrap 只等身份阶段；首页消息与 `auth/me` 并行；音乐链后台并行；图片/链接预载限流。
- 传输：`@fastify/compress`（br/gzip）；hash 静态资产 `immutable` 一年缓存；首屏 JS 从 1.44MB 拆到 719KB（brotli 线上实测 189KB）。
- 服务端：`/api/channels` 与 `/api/messages` 消除 N+1（`MessageSerializeBatch`）；未读数改为单次 `groupBy` 计数接口 `/api/messages/unread-counts`。
- `api()` GET 请求 20s 超时 + 一次传输重试。

## 必读上下文

- `AGENTS.md`（根 / src/client / src/server）与 `docs/development-index.md`、`docs/model-task-routing.md`——先读这些再动手。
- 部署与测试站信息在 `AGENTS.local.md`（本地忽略文件，不要提交、不要引用其中内容到受跟踪文件）。
- 验证按 [development-workflow.md](development-workflow.md#验证选择) 的风险矩阵选择：常规改动跑领域检查与受影响构建；高风险改动、推送/发布前才要求一次 `npm run verify:full`。旧文的“每次提交全量检查”不再是普通本地提交的默认要求。
- e2e 只能使用一次性 `tm3_e2e` 库：显式设置 `E2E_DATABASE_URL` 指向它后经 `npm run test:e2e` 运行（脚本自带校验、播种与 webServer）；不要通过修改 `.env` 的 `DATABASE_URL` 换库名，也不要对 `tm3_local` 等保留库运行 e2e。
- 注意管道会掩盖退出码：`npm run verify:full | tail` 永远返回 0，必须 `set -o pipefail` 或重定向到文件后看 `exit=$?`。
- `src/client/responsiveLayout.test.ts` 和 `src/server/musicPlaylistRoutes.test.ts` 是源码正则测试：改动 App.vue / server/index.ts 结构后需要同步更新断言（保持断言意图，不要删除）。

## 剩余优化项（按建议优先级）

### 0. 2026-08-10 快赢包（已完成，commit `24c1d22` + `066e82f`）

- ✅ 生产构建 NODE_ENV=production（首屏再减 ~15%）
- ✅ typing 客户端 3s 节流 + 服务端 2s 去抖 + 连接期身份复用
- ✅ presence/听众心跳仅变更时广播；新连接改单发快照
- ✅ UUID 内容寻址媒体路由 immutable 一年缓存
- ✅ link-preview 进程内缓存（30min 成功 / 60s 负缓存 / 500 条上限）

### 0.2 构建收尾 + 会话缓存（已完成，2026-08-10）

- ✅ vendor 分包：`vite.config.ts` 的 `advancedChunks` 把 marked/dompurify/socket.io 家族/lucide/vue 钉进稳定 vendor chunk（188KB，配合 immutable 跨版本复用）
- ✅ RELEASE_HISTORY 移出首屏：新增 `/api/version/history`，「关于」页与管理更新页打开时才拉取（entry 491→415KB min）
- ✅ 认证会话 TTL 缓存（roadmap 项 2 完成）：`verifyJwtToken` 正向结果 30s 缓存（上限 1000、负结果不缓存），失效统一挂在 `disconnectSessions`（logout/改密码/管理员改删号/账号删除/新登录顶替全部覆盖）

### 0.1 全栈扫描发现项（2026-08-10 扫描，已标注完成状态）

- **图片缩略图体系**（高）：✅ 2026-08-10 完成（commit `d8fb064`）——上传生成 480px 缩略图 + `/api/files/:id?thumb=1` 变体 + 启动回填；头像 256px、壁纸 2560px cap。demo 实测历史图 23MB→779KB。
- **MessageRow 子组件/行级 memo**（高）：消息行内联在 App.vue 巨型组件里，任何响应式变化（语音播放 4Hz 进度、特效 tick）触发整个渲染窗口重渲染，每行重跑 marked + DOMPurify + DOM 解析。✅ 2026-08-10 小改动版完成：`src/client/memoize.ts`（WeakMap 按消息对象记忆）接入 markdownMessageHtml/messageRichTextSegments/prayerRichTextSegments/chainTopicRichTextSegments/messagePreviewUrl/waveformForMessage。彻底版（抽 MessageRow 组件 + v-memo）仍未做，属 roadmap 第 5 项架构改造的一部分。
- **messages:refresh 扇出**（中）：✅ 2026-08-10 完成——prayed/prayer-status/AI 经文/撤回改发 `message:updated` 增量（广播点统一复用 hydrate 的 DTO，零额外查询）；客户端合并时保留本视角字段（`src/client/messageUpdates.ts`）。撤回路径冗余双发已去掉。批量删除/导入等真多消息场景保留 refresh。
- **channel:updated 客户端忽略 payload**（中）：✅ 2026-08-10 完成——已存在的频道做增量合并（保留本视角权限位/lastMessageId/pinned），新频道/删除/无 payload 事件回退 loadChannels。
- **socket 发消息双重 hydrateMessage**（中）：✅ 2026-08-10 部分完成——未做 DTO 复用，改为给 `hydrateMessage` 补 likes/favorites/musicScores/musicLyrics/voiceListens 预载（serializeMessage 走既有预载分支），每次 hydrate 从 3-5 条查询降为 1 条，同时覆盖 roadmap 项 4。
- **索引**（中，需迁移，高风险域）：schema 现有 `[channelId, id]`/`replyToId`/`chainRootId`，仍缺 prayer 计数用的 `@@index([type, channelId])`；音乐曲目列表查询全表扫 messages（缓存音乐频道 id 后走 `[channelId, id]`）。
- **/api/channels members include**（低）：全部频道拉全部成员 account 行，只有 direct 双成员频道用得到 directPeer。
- **vendor 分包**（中低）：✅ 已并入 0.2 节完成项。
- **RELEASE_HISTORY 移出首屏**（中低）：✅ 已并入 0.2 节完成项（改用 `/api/version/history` 端点方案，未动 release 工具链）。
- **socket.io 动态 import**（低）：~11KB br，代价是 WS 握手晚一轮，需权衡。
- **滚动路径减重**（中）：`saveReadPosition` 已有 400ms 防抖与签名去重（App.vue `scheduleSaveReadPosition`，✅ 2026-10-24 核实）；虚拟滚动观察器全量重建改增量未做。
- **缓存剪枝**（低-中）：`voicePlayers` 等已随播放体系重构移出 App.vue（2026-10-24 全仓检索无残留）；章节缓存已抽出 `src/client/bibleChapterCache.ts`，是否有界未复核，留待性能测量阶段确认。
- **小项**：parallax 图层强制无损 PNG（改 webp）；歌谱 webp q92 偏高（85 即可）；styles.css 约十余个死 CSS 家族；`switchPrayerView` 串行 await 改 Promise.all（store.ts 约 629 行，2026-10-24 仍为串行）；unread-counts 的 actor join 可用 `senderActorId != auth.actorId` 省掉；friend media 无 ETag 且不在 SW 缓存白名单（除标注外均未复核）。

### 1. `/api/music/tracks` 与歌单接口的负载裁剪（服务端，中等收益）

2026-09-22 进度：列表和歌单已不再读取/返回歌词全文与解析后的 cues，纯文本歌词也不再进入列表 DTO；播放中的歌词和歌曲详情改为按需读取单曲详情。歌谱页元数据仍随列表返回，分页/字段选择与真实设备耗时测量仍待处理。
下列“现状”描述为优化前基线。

- 位置：`src/server/routes/music.ts:130-161`、`src/server/services/musicService.ts`（`serializeTrack`、`playlistDto`）。
- 现状：曲目列表无分页，`musicLyrics: true` 把每首歌词全文塞进 DTO，且每首 `parseLyrics` 解析全部 cues；`playlistDto` 对歌单内每首曲目 include 全部歌谱页 + 歌词全文。曲库 100 首约数 MB JSON。
- 做法：列表 DTO 去掉歌词全文/cues（歌词查看时再单首拉取）；歌单 DTO 同样裁剪；评估加分页或字段选择。
- 风险：客户端歌词头、歌谱舞台直接消费 `track.lyrics.cues`，需要找到所有消费者并改为按需加载；`docs/development-index.md` 的 Music Player State Ownership 段落描述了边界。
- 验收：打开音乐面板首包体积显著下降；歌词显示、歌谱翻页、歌单播放全部正常；`npm run test:server` 通过（注意 `musicPlaylistRoutes.test.ts` 有 schema 不变量断言）。

### 2. 认证会话短 TTL 缓存（服务端，✅ 已完成，并入 0.2 节）

- 落点：`src/server/index.ts` `verifyJwtToken` 的 `authSessionCache`（30s TTL、上限 1000 淘汰最旧，2026-10-24 核实在位）；失效统一挂在 `disconnectSessions`（logout/改密码/管理员改删号/账号删除/新登录顶替）。

### 3. 公开频道 members 接口的字段裁剪（服务端，小收益）

- 位置：`src/server/index.ts` 的 `GET /api/channels/:id/members`（约 2820-2842 行，2026-10-24 复核）。
- 现状：公开频道 `where: {}` 拉全站 account 全字段（含 `passwordHash`、`biblePreferences`）过 ORM 后在内存丢弃。
- 做法：加 `select` 只取响应需要的 7 个字段；顺便去掉 preHandler 已查过的重复 channel 查询。
- 风险：低。确认没有下游消费被裁掉的字段。
- 验收：响应 shape 不变；`npm run test:server` 通过。

### 4. 单消息路径的序列化预载（服务端，✅ 已完成，随 0.1 节 socket 项落地）

- 落点：`src/server/services/messageSerialization.ts` `hydrateMessage`（约 388 行，2026-10-24 核实）include 预载 likes/favorites/musicScores/musicLyrics/voiceListens，`serializeMessage` 命中预载分支；socket 推送与单条路由共用该实现。

### 5. `App.vue` 继续拆分（客户端，架构级，主要收益是可维护性）

- 2026-10-24 复核：`App.vue` 已从约 12,412 行降至 6,911 行；`class="modal-shell"` 在 App.vue 内已清零，管理面板与设置面板分别迁至 `features/admin/AdminPanel.vue`、`features/settings/SettingsPanel.vue`，弹窗统一走 `components/ui/AppModal.vue` 与 `modalStack.ts`。“18 个 modal 在首屏 chunk”不再是当前结论。
- 剩余职责（导航/阅读位置、收藏、弹层接线、音频/乐谱协调、初始化与销毁）按 [development-index.md](development-index.md) 的 Next Deepening Opportunities 与全流程优化计划 P4/P5 分批处理；每批独立验收，不以行数为目标。

### 6. 小项（顺手做）

- 头像 `<img>` — ✅ 已统一走 `components/ui/AvatarImage.vue`（`decoding="async"`、失败回退文字头像）；未加 `loading="lazy"`，头像体积小、影响有限。
- `linkPreviewCache` 无上限 — ✅ 已重构为 `features/messages/linkPreviewQueue.ts`：缓存上限 120、并发 3、失败退避（5s/30s 后本会话放弃）、切频道/换账号 reset 并中止在途请求。
- `preloadMessageImages` 队列持续累积 — ✅ 已有界：只预热最新 30 张图（App.vue `preloadMessageImages`），按消息 id 去重入队。
- `checkServerVersion` 在 onMounted 串行 await 位于滚动定位之前 — 仍在（App.vue 约 1428 行）；改后台并发时保持首个 60s 轮询起点行为不变。

## 验证与部署纪律

1. 每次改动：`npm run test:client` / `test:server`（按域），提交前 `npm run verify:full` 且确认真实 exit code。
2. UI 行为变化跑本地 e2e（见上文「必读上下文」）。
3. 部署测试站按 `AGENTS.local.md` 的标准流程；部署后用无痕窗口自测冷启动，并用 curl 验证响应头。
4. 提交信息遵循现有 conventional commit 风格（`perf(client): ...` / `fix(server): ...`），用户可见变化在 `CHANGELOG.md` 的 `## Unreleased` 下补一条。
5. 不要推送、不要动 release 文件，除非用户明确要求。
