# EPUB 阅读器实施与验收记录

基线：`78e2c27`。本次按 `epub-reader-improvement-plan.md` 实施核心阅读体验和获单独授权的 P5；不把计划中的验收目标视为已经取得的结果。用户随后授权本地提交并推送；未部署，未修改 Service Worker。

## 已实现的改动

| 范围 | 改动文件及行为 |
| --- | --- |
| 打开与资源 | `src/client/components/BookWorkspace.vue`、`src/client/books/reader.ts`：封面一次点击流式打开，离线下载独立；取消旧开书意图，限制章节准备并发为 2，延迟前章插入，回收离屏 iframe/观察者/模型/资源引用。`bookSectionQueue.ts`、`bookAdjacentPreload.ts` 负责队列和引用。 |
| 文字模型 | `features/books/bookText.ts`、`bookTextModel.ts`、`bookLocator.ts`、`bookReaderLocations.ts`、`bookCfi.ts`：语义块空白规则、UTF-16 范围、字素边界、双向 DOM 映射、文件及文字版本、CFI 和有界引用校验。重复或版本不符有明确状态。 |
| 布局与设置 | `bookViewAnchor.ts`、`bookTypography.ts`、`useBookPanelGeometry.ts`、`reader.ts`、`BookWorkspace.vue`：可见文字锚点、合并重排、区分程序补偿和用户滚动、覆盖作者强正文样式、保留标题层级；设置面板使用实际工具栏及 visualViewport 边界，连续操作不关闭；固定版式保留原排版。 |
| 选择和笔记 | `bookNoteHighlights.ts`、`useBookNoteHighlights.ts`、`useBookSelection.ts`、`useBookQuoteNavigation.ts`、`useBookNoteEditor.ts`、`bookNotesClient.ts`：选择、笔记、模式切换和分享使用同一地址，卸载文档时清理监听/高亮；旧引用保留近似定位提示。 |
| 精确进度 | `src/shared/bookLocator.ts`、`src/server/routes/bookProgress.ts`、`services/bookProgress.ts`、`books.ts`、`bookProgressSync.ts`、`useBookProgress.ts`：文件摘要、严格 v2 DTO、账户/图书隔离、服务端 CAS 修订、最后一次写入幂等、离线合并待同步位置、显式冲突选择。关闭/切书尽力同步；冲突关闭重开仍需选择。 |
| 兼容与分享 | `src/shared/bookNotes.ts`、服务端 `bookNotes.ts` 路由/服务、`BookReadingActions.vue`、`BookNoteShareCard.vue`、`bookReading.ts`、`MessageRow.vue`、`readingShareMessage.ts`、`notesBackup.ts`：v2 私人笔记保存 locator，v1 返回和旧 `book_note` envelope 明确投影；地址放入版本化 URL 参数，旧链接继续可读。含精确地址的图书备份声明 v2，旧 v1 备份仍可导入。 |
| 迁移与旧书 | `prisma/schema.prisma`、`20261017043902_epub_precise_progress/migration.sql`：新增 Book 摘要和 BookProgress locator/revision/locatorRevision/lastMutationId。`src/server/books/revision.ts`、`src/scripts/backfill-book-revisions.ts` 提供有界、流式、只读 EPUB 字节的摘要补齐，未在保留数据上执行。 |

以上客户端模块路径若省略前缀，均位于 `src/client/features/books/`；`MessageRow.vue` 位于 `src/client/features/messages/`，`readingShareMessage.ts` 位于 `src/client/features/reading-shares/`，`notesBackup.ts` 位于 `src/client/features/notes/`。服务端服务路径位于 `src/server/services/`。

## 定位、同步和未来接口边界

- 上传处理是通用入口 `POST /api/admin/books`，对每一次新上传执行容器校验、元数据/封面提取（缺封面则生成）、原文件保存和 SHA-256 摘要计算；没有既有图书 ID、书名或文件名白名单，不需要逐本补丁或上传后手动运行维护脚本。后续上传自动适用阅读器的通用加载和文字定位逻辑。
- 上传处理不等于后端预先转换全书或生成所有章节的文字索引：正文仍在客户端开书时按需解析。现有校验边界为 60 MB、4000 个 ZIP 条目、有效容器/OPF、无非法路径；已识别的 Adobe DRM 会被拒绝。不能承诺损坏文件、其他未识别加密或任意非标准 EPUB 均能阅读；固定版式保留原版式，不承诺通用 Aa 重排。
- `publicationRevision` 为原 EPUB 字节的 SHA-256。上传对已接收的缓冲计算，不在开书时全量下载计算；缺少摘要时只允许粗略进度/会话地址。将来若替换原文件，必须同时更新摘要；当前无原位替换接口。
- 正文规范化算法为 `epub-text-v1`：静态语义块、空白折叠、保留隐藏原文、排除脚本/控件/注音及装饰。源码中的块名单和版本定义是后续后台复现的依据。文档模型最多 4 个、总计约 100 万 UTF-16 单位；单个超大章允许独占并超出预算。原文正文按不可变源处理，不支持运行中任意脚本替换文字。
- 正常驻留窗口最多 7 章，最多 2 个正在准备的 frame；正文声明大小预算约 2 MB。当前与相邻章、选文及共享高亮有保护，因此属于软预算，不能宣称硬内存上限。
- locator 精确校验、CFI 恢复及有界引用恢复在已指明章节内完成。旧 fraction/quote 保留近似入口；未实现任意跨章全文搜索，不能把缺失/歧义地址称为精确恢复。
- v1 百分比写入在同一数据库操作中清空 locator 与 locatorRevision 并递增 revision。v2 按 baseRevision 比较并写入；最后一个 mutationId 可重试，更旧队列得到冲突，不按客户端时间或最大百分比覆盖。
- 离线队列键包含 accountId/bookId，关闭/换书持久化且尽力提交；联网后重试已知待同步队列。GET 超时不让迟到远端响应搬动已开始阅读的位置。401/账号变化终止旧账号任务。
- `bookTextModel.readText/range/rects`、`bookTextSubrange` 和现有 Range 高亮接口可供将来的句子定位与装饰使用；`data-book-decoration` 排除在源索引外。合成样例覆盖选文内句子范围、跨标签、emoji/组合字符/ruby、非法范围和重排。没有录音、ASR、音频上传、播放按钮或新公开分享权限。

## 验证记录

- 浏览器：38 个 EPUB 场景分批执行；覆盖 Chromium 360/390/994/1280 和 WebKit 移动尺寸、真实 EPUB 聊天室分享后原生 iframe 滚轮、Aa 极值/连续操作/旋转/模式往返、100 章遍历回收、图片迟到、旧导航取消、笔记与备份/故事/邀请、真实 MySQL 的并发/幂等/v1 失效/账户隔离，以及精确重开、离线关闭重开重试和显式冲突选择。最终结果见本记录下方的收尾状态。
- 专项源码测试：队列、引用计数、严格 locator/旧 DTO、离线合并/失败重试/冲突持久化/账户隔离、Range 尾部读取、旧书摘要维护、笔记与备份兼容。
- 新上传通用性回归：同一服务进程依次上传随机标识/书名的 EPUB 2、嵌套 OPF 多章 EPUB 3、固定版式 EPUB 3，使用相同上传文件名；逐本验证独立元数据、提取/生成封面、原文件字节、独立摘要和书架可见性，不执行旧书补齐脚本。`src/server/routes/books.test.ts` 通过。
- 迁移：`prisma migrate dev` 在一次性开发库生成并应用；`MIGRATION_VERIFY_RUN=1 npm run test:migrations` 在新建 `tm3_migration_verify` 成功，24 个迁移及 schema diff 通过；另在一次性升级库先应用旧 23 个迁移并插入旧图书/进度，再部署新增迁移，核验原 fraction=.625 与图书保留、新列 null、revision=0。
- 隔离浏览器测试对保留副本先备份、后恢复并核对各表行数，资产树未改；新 migration 没有应用到保留环境。本地预览保持停止，避免启动脚本未经授权自动迁移。
- 收尾：`npm run verify:full` 退出 0，包含 230 个源码测试文件、lint、类型检查和客户端/服务端构建；38 个 EPUB 浏览器场景分批通过，最后 4 项持久化/账户隔离/完整笔记分享验收通过且备份恢复结束；迁移验证及旧数据升级验证均退出 0。包括新增文件的公有树扫描与 `git diff --check` 通过。日志留在仓库外，不提交私人截图、运行数据或连接配置。

## 尚未取得的验收证据与风险

- 未做物理 iOS/Android 触摸、惯性滚动、真实软键盘及安全区测试；WebKit 引擎和移动视口仅是自动化证据。嵌入式浏览器重复开关/空白页面问题仍未验证。
- Aa 测试带首次文字时间和每组 10 次反馈样本，但没有同设备、同书、同网络的冷/热/离线 ≥20 次前后对照，未证明计划中的 p95/长任务目标，也未测真实设备峰值内存。
- Foliate 分页组合场景仍有 `ResizeObserver loop completed with undelivered notifications` 开发日志；文字/点击/分享断言通过，未把日志当成已解决。
- 保留环境尚未迁移和补齐旧书摘要。启用本地/正式预览前需另行授权相应环境的备份、`prisma migrate deploy` 和有界摘要补齐；没有摘要的旧书仍是近似进度。
- P0/P6 的真机、嵌入式和性能证据仍未闭合。本次交付的是可评审实现及自动化回归结果，不是完整平台验收或上线声明。
