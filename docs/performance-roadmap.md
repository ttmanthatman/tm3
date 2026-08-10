# 性能优化路线图（交接文档）

本文档记录 2026-08 加载性能专项的剩余工作，供后续会话直接接手。
已完成部分见 git 历史 `74abce0..fc014ef`（main）与 `CHANGELOG.md` 的 Unreleased 段落。

## 已完成的优化（基线）

- 启动：localStorage 消息窗口缓存即时渲染；bootstrap 只等身份阶段；首页消息与 `auth/me` 并行；音乐链后台并行；图片/链接预载限流。
- 传输：`@fastify/compress`（br/gzip）；hash 静态资产 `immutable` 一年缓存；首屏 JS 从 1.44MB 拆到 719KB（brotli 线上实测 189KB）。
- 服务端：`/api/channels` 与 `/api/messages` 消除 N+1（`MessageSerializeBatch`）；未读数改为单次 `groupBy` 计数接口 `/api/messages/unread-counts`。
- `api()` GET 请求 20s 超时 + 一次传输重试。

## 必读上下文

- `AGENTS.md`（根 / src/client / src/server）与 `docs/development-index.md`、`docs/model-task-routing.md`——先读这些再动手。
- 部署与测试站信息在 `AGENTS.local.md`（本地忽略文件，不要提交、不要引用其中内容到受跟踪文件）。
- 验证命令：`npm run verify:full`（提交前必须 exit 0）；e2e 需要本地 MySQL 的 `tm3_e2e` 库，用 `.env` 里的 `DATABASE_URL` 改库名得到 `E2E_DATABASE_URL` 后跑 `npm run test:e2e`。
- 注意管道会掩盖退出码：`npm run verify:full | tail` 永远返回 0，必须 `set -o pipefail` 或重定向到文件后看 `exit=$?`。
- `src/client/responsiveLayout.test.ts` 和 `src/server/musicPlaylistRoutes.test.ts` 是源码正则测试：改动 App.vue / server/index.ts 结构后需要同步更新断言（保持断言意图，不要删除）。

## 剩余优化项（按建议优先级）

### 0. 2026-08-10 快赢包（已完成，commit `24c1d22` + `066e82f`）

- ✅ 生产构建 NODE_ENV=production（首屏再减 ~15%）
- ✅ typing 客户端 3s 节流 + 服务端 2s 去抖 + 连接期身份复用
- ✅ presence/听众心跳仅变更时广播；新连接改单发快照
- ✅ UUID 内容寻址媒体路由 immutable 一年缓存
- ✅ link-preview 进程内缓存（30min 成功 / 60s 负缓存 / 500 条上限）

### 0.1 全栈扫描发现、尚未做的项（2026-08-10 扫描）

- **图片缩略图体系**（高）：全代码库无 `.resize()`——气泡显示 ≤260px 却传全尺寸 webp，头像 36px 也传全尺寸。做法：上传时生成 ~480px 缩略图变体 + 头像 256px 缩放 + 壁纸长边 cap 2560px；`compressImageFile` 加 maxDimension 参数一处改三处用。涉及上传管线与 DTO，单独一轮做。
- **MessageRow 子组件/行级 memo**（高）：消息行内联在 App.vue 巨型组件里，任何响应式变化（语音播放 4Hz 进度、特效 tick）触发整个渲染窗口重渲染，每行重跑 marked + DOMPurify + DOM 解析。做法：抽 MessageRow 组件或先给 `messageRichTextSegments`/`markdownMessageHtml`/`linkPreviewFor` 按 (id, content) 加 Map 缓存。
- **messages:refresh 扇出**（中）：代祷打卡/撤回等事件让全房间客户端整窗重拉；多数路径服务端已有 DTO，改发增量 `message:updated`（撤回路径还有冗余双发）。注意与「hydrateMessage 预载」项协同。
- **channel:updated 客户端忽略 payload**（中）：`store.ts` 收到事件直接 loadChannels 三连重拉；事件里已带 DTO，做增量更新、无 payload 才回退。
- **socket 发消息双重 hydrateMessage**（中）：emitMessage 已 hydrate + 广播，ack 又 hydrate 一次；新消息的 reactions/voiceListened 必为空，可复用第一份 DTO。
- **索引**（中，需迁移，Sol 域）：prayer 计数需 `@@index([type, channelId])`；音乐曲目列表查询全表扫 messages（缓存音乐频道 id 后走 `[channelId, id]`）。
- **/api/channels members include**（低）：全部频道拉全部成员 account 行，只有 direct 双成员频道用得到 directPeer。
- **vendor 分包**（中低）：marked/dompurify/socket.io-client/lucide 钉成稳定 vendor chunk，发版后老用户少重下 ~26KB br。
- **RELEASE_HISTORY 移出首屏**（中低）：`src/shared/release.ts` 历史更新日志 ~7KB br，更新日志弹窗首次打开时再 import。
- **socket.io 动态 import**（低）：~11KB br，代价是 WS 握手晚一轮，需权衡。
- **滚动路径减重**（中）：`saveReadPosition` 每滚动帧强制布局 + 同步 localStorage 写 → 复用 idle timer 节流；虚拟滚动观察器全量重建改增量 + forward overscan 320px 偏小。
- **缓存剪枝**（低-中）：`voicePlayers`/`voiceProgress`/`resolvedMessageImageDimensions` 等按消息 id 累积且全量 spread 写入，切频道不清理；BibleWorkspace `chapterCache` 无上限（~20 章 LRU）。
- **小项**：parallax 图层强制无损 PNG（改 webp）；歌谱 webp q92 偏高（85 即可）；styles.css 约十余个死 CSS 家族；`switchPrayerView` 串行 await 改 Promise.all；unread-counts 的 actor join 可用 `senderActorId != auth.actorId` 省掉；friend media 无 ETag 且不在 SW 缓存白名单。

### 1. `/api/music/tracks` 与歌单接口的负载裁剪（服务端，中等收益）

- 位置：`src/server/routes/music.ts:130-161`、`src/server/services/musicService.ts`（`serializeTrack`、`playlistDto`）。
- 现状：曲目列表无分页，`musicLyrics: true` 把每首歌词全文塞进 DTO，且每首 `parseLyrics` 解析全部 cues；`playlistDto` 对歌单内每首曲目 include 全部歌谱页 + 歌词全文。曲库 100 首约数 MB JSON。
- 做法：列表 DTO 去掉歌词全文/cues（歌词查看时再单首拉取）；歌单 DTO 同样裁剪；评估加分页或字段选择。
- 风险：客户端歌词头、歌谱舞台直接消费 `track.lyrics.cues`，需要找到所有消费者并改为按需加载；`docs/development-index.md` 的 Music Player State Ownership 段落描述了边界。
- 验收：打开音乐面板首包体积显著下降；歌词显示、歌谱翻页、歌单播放全部正常；`npm run test:server` 通过（注意 `musicPlaylistRoutes.test.ts` 有 schema 不变量断言）。

### 2. 认证会话短 TTL 缓存（服务端，小收益但简单）

- 位置：`src/server/index.ts` 的 `verifyJwtToken`（约 574-594 行）。
- 现状：每个带认证的请求固定 `account.findUnique` + `accountSession.findUnique` 两条 SQL（+5 分钟一次的 `updateMany`）。启动并发 6+ 请求放大成 12+ 条。
- 做法：给 `(accountId, sessionId)` 加 30-60s 内存缓存（注意登出/撤销会话时失效，`logout` 和账号删除路径要主动清）。也可以选择只缓存 account 行、session 仍实时查（撤销即时生效，安全属性更保守）。
- 风险：会话撤销后缓存窗口内仍放行——这是安全相关权衡，按 `docs/model-task-routing.md` 属于 Sol 域，改动前明确失效策略。
- 验收：重复请求在 TTL 内 0 额外 SQL；登出后立即 401。

### 3. 公开频道 members 接口的字段裁剪（服务端，小收益）

- 位置：`src/server/index.ts` 的 `GET /api/channels/:id/members`（约 3720-3764 行）。
- 现状：公开频道 `where: {}` 拉全站 account 全字段（含 `passwordHash`、`biblePreferences`）过 ORM 后在内存丢弃。
- 做法：加 `select` 只取响应需要的 7 个字段；顺便去掉 preHandler 已查过的重复 channel 查询。
- 风险：低。确认没有下游消费被裁掉的字段。
- 验收：响应 shape 不变；`npm run test:server` 通过。

### 4. 单消息路径的序列化预载（服务端，小收益）

- 位置：`src/server/index.ts` 的 `hydrateMessage` / `emitMessage`（socket 推送新消息走这里）。
- 现状：`hydrateMessage` 的 include 不含 likes/favorites，`serializeMessage` 无 batch 时对每条消息额外 2 条查询；语音/音频/代祷同理走单条查询路径。
- 做法：给 `hydrateMessage` 的 include 补上 `likes`/`favorites`（serializeMessage 已有预载分支，零改动复用）；语音/音频/代祷单条查询量小，可不动。
- 风险：低。
- 验收：高频发消息时段 socket 推送路径 SQL 数下降；消息 reactions 显示正常。

### 5. `App.vue` 模态框与管理面板继续拆分（客户端，架构级，主要收益是可维护性）

- 位置：`src/client/App.vue`（约 12k 行，18 个 modal 仍在首屏 chunk）。
- 现状：首屏 chunk 仍有 ~719KB，其中大头是 App.vue 自身模板与逻辑（管理面板、设置、各种弹窗）。
- 做法：按 `docs/development-index.md` 的 "Next Deepening Opportunities" 顺序来：先抽 modal shell 模块，再把 admin 数据工具、设置页拆成 `defineAsyncComponent` 组件。每拆一个跑 `npm run test:client`（responsiveLayout 正则断言需要同步）。
- 风险：这是审计文档列出的耦合区 #1，改动面广；建议每个 modal 一个 commit，逐个体测。
- 验收：首屏 chunk 进一步下降；全部 e2e 通过；移动端 360/390px 与桌面 1280px 逐一检查弹窗。

### 6. 小项（顺手做）

- 头像 `<img>` 无 `loading="lazy"`/`decoding="async"`（如 `App.vue` 成员列表处）——消息列表外的头像加 lazy。
- `linkPreviewCache` 无上限无淘汰（`App.vue` 约 801 行）——长会话内存增长，加个 LRU 上限（如 200 条）。
- `preloadMessageImages` 的队列在历史分页时持续累积（`App.vue` 约 2230 行）——给队列设上限或跳过分页加载的旧图。
- `checkServerVersion` 在 onMounted 里串行 await 在滚动定位之前（约 1071 行）——改为后台并发。

## 验证与部署纪律

1. 每次改动：`npm run test:client` / `test:server`（按域），提交前 `npm run verify:full` 且确认真实 exit code。
2. UI 行为变化跑本地 e2e（见上文「必读上下文」）。
3. 部署测试站按 `AGENTS.local.md` 的标准流程；部署后用无痕窗口自测冷启动，并用 curl 验证响应头。
4. 提交信息遵循现有 conventional commit 风格（`perf(client): ...` / `fix(server): ...`），用户可见变化在 `CHANGELOG.md` 的 `## Unreleased` 下补一条。
5. 不要推送、不要动 release 文件，除非用户明确要求。
