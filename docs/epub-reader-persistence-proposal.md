# EPUB 精确位置持久化：已授权实现方案

状态：用户已授权 P5 本地实现及一次性数据库迁移验证。实现与检查记录见 [实施记录](epub-reader-implementation.md)。保留环境迁移、元数据补齐和部署仍不在本次执行范围；旧书没有摘要时继续使用粗略进度及会话地址。

## 数据差异

已新增以下字段（现有列保留）：

```prisma
// Book
publicationRevision String? @map("publication_revision") @db.Char(64)

// BookProgress
locator         Json?
revision        Int  @default(0)
locatorRevision Int? @map("locator_revision")
lastMutationId  String? @map("last_mutation_id") @db.VarChar(64)
```

- `publicationRevision`：上传时对已有上传缓冲计算 SHA-256，旧书维护时流式计算摘要；旧书用有界的只读维护任务补齐。不得在开书时重新下载全书计算摘要。原文件替换必须同时更新摘要；没有摘要时只允许粗略进度或会话内地址。
- `locator`：版本化章节 href、规范文本 UTF-16 范围及有界校验片段。服务端校验 bookId、文件摘要、textRevision、数值及消息体上限。
- `revision`：同一 account/book 的服务端递增序号。
- `locatorRevision`：仅当与 revision 一致时，locator 才能用于恢复。旧客户端写 fraction 必须在同一事务清空 locator/locatorRevision 并递增 revision。

## 接口与旧客户端

保留已有 v1 路由和返回投影，不直接向旧严格 DTO 添加字段。新增 `/api/books/:id/progress/v2` GET/PUT，PUT 接收 `{ fraction, locator, baseRevision, mutationId }`。重复 mutationId 返回原结果；版本冲突返回 409 和当前服务器快照。创建及并发更新使用事务和唯一键，不能先读后无条件覆盖。

幂等 mutationId 通过 BookProgress 的 `lastMutationId String? @db.VarChar(64)` 记录，它只保证最后一次写入重试；更久的离线队列按 baseRevision 得到冲突，不假定成功。新客户端只维护一个合并后的待同步位置。

笔记仍存 Setting JSON。新增 v2 notes 路由及 schema，存可选 locator；v1 路由去掉新字段后返回，保持旧客户端可读。不得向仍由旧客户端解析的 `book_note` envelope 添加未知字段。实现使用现有消息正文中的版本化 `bookLocatorV1` URL 参数携带有界地址；不新增服务器定位引用存储，也不扩展旧 `book_note` envelope。新卡片读取该参数，旧卡片仍读取原有 fraction/quote。地址只包含已分享原文的校验片段，不能返回私人笔记；图书读取仍需原有鉴权。完整笔记→发送→接收→原书链路纳入隔离回归。

## 客户端同步

以账户、图书及服务端 revision 为单位保存离线待同步项；程序布局补偿不产生进度写入。真实滚动/主动定位更新本地待同步项；关闭/切书尽力提交；失败仍保留待同步状态。401/登出停止旧账户任务。

409 不自动取最大百分比，也不以客户端时间覆盖服务端；保留本地位置并显示“保留本机位置 / 使用另一设备位置”的明确选择。开书后迟到的远端读取只更新同步状态，不移动已开始阅读的位置。旧客户端的新 fraction 写入后，不得复活旧 locator。

## 迁移及验证范围

仅在得到数据库变更授权后，在一次性开发库运行 `prisma migrate dev` 生成新增 migration；不修改已提交 migration，不对保留库运行 db push。迁移验证使用规定的一次性迁移库，已有数据应保留且旧 locator 默认 null。正式/保留环境迁移及部署各自另需授权。

必须验证：旧客户端写入使 locator 失效、v1 严格 schema 投影、版本不符、离线重试、同书回读、两设备同时写入、切书/关闭时提交、账户隔离、文件摘要补齐/替换，以及笔记与分享端到端恢复。最终运行一次完整验证和隔离 E2E。

本提案不要求更换 EPUB 格式、不实现录音/ASR、不修改 Service Worker，也不授权生产部署。
