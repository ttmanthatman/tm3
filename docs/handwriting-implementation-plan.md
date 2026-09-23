# 逐字手写消息：开发方案与模型任务卡

状态：规划，尚未实现。核对日期：2026-09-22。

基线：`502b0b7a7f755b9f66011c3ea916bbd242f0d7ab`，应用版本 `2.3.1`。检查开始时工作区干净；Node 22，依赖目录存在，但未验证安装完整性。本次刷新了代码图索引，并用当前源码复核关键入口；迁移 SQL 存在部分图解析缺失，不能依赖图谱判断迁移正确性。未查询远端分支，基线指当前本地源码。

用户已确认：保留逐字书写，适合中文短句。本文是可交接的开发计划，不授权提交、推送、部署或发布。

## 1. 旧设计评估

找到的旧材料是 [ADR-0001](adr/0001-handwriting-messages-as-stroke-vectors.md) 和 [CONTEXT.md](../CONTEXT.md)。前者记录存储决策，后者补充交互约定；目前没有完整实施任务书。

| 旧设计 | 本次判断 |
| --- | --- |
| 保存笔画向量，在客户端 Canvas 重播 | 保留。可按书写顺序播放，缩放清晰，不需要视频生成或附件上传 |
| 一次写一字，手动切字，上限 30 字 | 保留。这里的“字”是用户提交的字格，程序不识别汉字，也不能验证一个字格只写了一个字 |
| 历史消息静态、实时收到播放一次、点击重播 | 保留，补充可见性、去重、虚拟列表重挂载和后台生命周期规则 |
| “30 字最坏约 250KB” | 不是可依赖的上界。必须同时限制总点数、笔画数和 UTF-8 JSON 字节数 |
| 新增 MessageType，需要 Prisma 迁移 | 仍准确：当前 Prisma 使用 enum，payload 已是 Json，无需新增笔画表 |
| 与圣经抄写共用逐字结构 | 保留扩展可能，首版不接圣经、不引入识别库 |
| 尚未实施，基于 v1.13.2 | 版本描述已旧；当前仍没有 handwriting 类型，但消息模块和发送恢复能力已经变化 |

最需要更新的是接入方式：当前已有消息序列化服务、独立消息正文组件、发送幂等与未确认发送恢复，不能按旧大文件结构另起一套。

## 2. 第一版的可观察行为

1. 普通可发言频道和私聊的“更多”面板出现“手写”。音乐频道、无发言权限、代祷/恩典筛选视图不开放入口，防止发完在当前筛选中消失；不改变已有频道权限。
2. 独立弹窗包含：已写字格预览、当前字格的大方形画板、撤销一笔、清空当前字、完成此字、预览播放、发送。使用现有 AppModal，按钮沿用现有 SVG 图标风格。
3. 写完一字必须手动点“完成此字”。停顿、抬笔和切后台均不自动切字。首版单色、固定线宽；默认无压感、无笔锋模拟、无擦除笔。
4. 点已完成字格可删除整字，其余字保持顺序；通过“删除后重写”修改。清空全部需要明确的界面确认。弹窗关闭保留草稿，重新打开恢复；注销清理本账号本地草稿。
5. 发送时若当前画板还有有效笔画，将它作为最后一字纳入预览和发送快照；不得漏发最后一字。超 30 字时留在编辑界面明确提示，不静默丢弃。
6. 最多 30 个非空字格；没有笔画时不能发送。单击画板留下的一个点也是有效笔画，必须画出圆点。
7. 首版每行最多 6 个字格，固定格宽高比，按完整字数预留全部行高。小屏不足 6 格时减少列数；动画过程中格数和高度不变。卡片显示“手写消息 · N 字”，并提供键盘可访问的重播按钮。
8. 收到新消息时，当前聊天可见、消息在可见区域、页面在前台且未开启减少动态效果，才自动播放一次；其余情况显示完整静态字迹。历史加载、刷新、重连补拉、收藏页面均不自动播放。自己发送的回声默认显示成品，可手动重播。
9. 离屏、切频道或页面隐藏即暂停并取消帧调度；同一挂载实例重新可见可从进度继续。卸载/pagehide 销毁播放资源，重挂载默认静态。手动重播从头开始，不叠加多个循环。
10. 故障和未知数据显示“手写消息暂无法显示”，仍可阅读其他消息。减少动态效果模式默认静态，明确点击重播后可播放；隐藏/离屏规则仍适用。

第一版支持：发送、历史读取、引用的文字标签、点赞/收藏/撤回等现有通用动作、收藏中的静态显示和手动播放、备份往返。暂不支持手写消息逐条转发/合并转发、复制为文字、导出 GIF/视频、笔迹识别、圣经抄写、多人实时共同书写。转发入口继续按白名单排除手写，不把笔画当作附件。

## 3. 数据契约草案（P0 验证后由 S0 冻结）

新建 `src/shared/handwriting.ts`，只放类型、常量、纯验证和规范化逻辑；不依赖 DOM、Canvas、Node Buffer 或 Vue。

```ts
type HandwritingPointV1 = [x: number, y: number, t: number];

interface HandwritingPayloadV1 {
  kind: "handwriting";
  version: 1;
  characters: Array<{
    strokes: Array<{ points: HandwritingPointV1[] }>;
  }>;
}
```

- x/y：0–10000 的整数，在方形字格中的归一化坐标；显示尺寸和 DPR 不进持久化数据。
- t：非负整数毫秒，相对该字第一笔起点；第一点为 0，同一字内按笔画及点顺序不递减，允许同毫秒多个点。下一字重新从 0 开始。编辑等待和跨字切换时长不记录。
- 单点笔画合法；字符、笔画和点数组均不可为空。对象严格字段白名单，拒绝任意嵌套字段、颜色脚本、路径字符串或 URL。
- 初始硬上限建议：30 字；每字 64 笔；全消息 600 笔/6000 点；每笔 1024 点；每字时间不超过 600000ms；完整 payload 的 UTF-8 JSON 不超过 131072 字节。**这些是拟定的约束，不是现有能力或实测最优值。**
- 验证先做结构和数组数量检查，再遍历点，再计算 UTF-8 字节数；在昂贵规范化/hash/落库前拒绝异常手写。保留现有传输层大小保护，不为手写提高全局请求上限。
- 客户端在记录中做距离/时间采样，保留每笔首尾、拐点和单点；P0 用“永、我、鬱、你好、标点、长停顿”检查丢笔和形变。复杂几何平滑、离线抽稀优化留待有证据再做。
- 接近上限时显示提示；采样后的有效笔画仍超限时不得悄悄截断后发送，保留编辑内容，要求撤销/删除或分成多条。**发送按钮冻结的快照必须已经合规，重试绝不重新采样。**
- 发出外层对象：`{ channelId, type: "handwriting", content: "[手写消息]", payload, replyToId, clientRequestId }`。手写必须带 UUID。服务端自行生成固定 content 标签，不把客户端文本当作笔迹内容或有效性依据。
- 手写 hash 输入固定为：校验后的规范化 payload、服务端固定 content、type、channelId、规范化 replyToId；先校验再 hash。同一笔迹不能因伪造的客户端 content 改变幂等结果。已有文本等类型继续使用原 hash 规则。确定发生在落库前的手写校验失败返回现有 ACK 形状及 `code: "not_sent"`；结果不确定的异常不得误报 not_sent。
- 对已存消息进行安全解析：已知且有效版本进入播放器；未知 version/损坏数据只降级显示。新发送和导入不接受未知版本。不得把损坏记录改写为空白手写覆盖原数据。
- v1 不存色彩、缩略图、HTML、真实汉字、圣经引用和绝对时间。未来格式升级新增版本，不改变历史 v1 的解释规则。

重播时间线由纯函数推导：保留笔内相对时序；笔间空闲超过 1000ms 压为 500ms；字间增加固定 250ms；总时长超过 15 秒时按比例加速。只改变播放时间线，不更改存储笔迹。预览、聊天、收藏共用同一绘制和时间线实现；不可把“播放完成”写回消息 payload。

## 4. 对照当前源码的接入点

以下为基线上的证据，实施前按符号重新定位，不依赖永久行号。

| 当前入口 | 现状与接入要求 |
| --- | --- |
| `prisma/schema.prisma`：MessageType、Message | enum 缺 handwriting；Message.payload 为 Json；已有 senderActorId/clientRequestId 唯一约束。只添加枚举迁移，沿用现有幂等列 |
| `src/shared/types.ts`：MessageType、MessageDTO | 联合类型补 handwriting；payload 仍通过专用解析器从 unknown 收窄，不使用 any |
| `src/server/index.ts`：message:send（基线约 4303 行） | 当前仅 text/prayer/sermon_request，先要求非空文本。新增手写分支复用权限、幂等、createMessageFromActor；手写验证放 focused service，index 仅必要接线 |
| `src/server/services/messageSendIdempotency.ts` | 已支持任意 type/payload 的规范化 hash，数组顺序保留；不另建幂等表，不改变已有文本 hash 语义 |
| `src/server/index.ts`：createMessageFromActor（约 2202 行） | 已有落库→广播→异步 push/条件自动化。保留顺序和重试语义，不把手写接入文本机器人触发条件 |
| `src/server/index.ts`：POST /api/messages | 另一套白名单，当前无同等幂等恢复。第一版保持不接收 handwriting；不能让客户端绕过 Socket 改用此入口 |
| `src/server/services/messageSerialization.ts` | 统一 DTO 投影，完整 payload 已能透传；历史、Socket、ACK、收藏的 v1 数据必须一致，不新增查询或另一份 serializer |
| `src/client/messageSending.ts`：useMessageSender | 已有共享发送锁/ACK 超时结果；仅靠它尚不足以恢复手写草稿，需 S3 补恢复协调 |
| `src/client/features/composer/useComposer.ts`、`unconfirmedSends.ts` | 当前未确认记录与文本草稿字符串、文本清理逻辑耦合。不得把手写塞进 text input 或凭同一个占位文本匹配重试 |
| `src/client/store.ts`：message:new | 更新 lastIncomingMessage、追加消息和未读。只在此唯一实时入口发出手写播放资格事件；不要在每个播放器另订阅 Socket |
| `src/client/features/composer/ComposerBar.vue` | “更多”入口；只新增按钮/props/事件，业务放 handwriting 功能目录 |
| `src/client/features/messages/MessageRow.vue` | 同时承载 timeline 和 favorite 正文；两个分支都需处理手写，收藏不自动播放 |
| `src/client/features/timeline/useVirtualTimeline.ts`、`App.vue` | 虚拟列表有高度估算和测量。按最终字格行数预留，App 只挂接；不得为了动画重建整个消息窗口 |
| `src/client/messageWindowCache.ts` | 最新 80 条、8 个视图键、约 2MB 预算；单个窗口当前可能超过预算。大量笔画将放大 JSON/localStorage 成本，需要针对手写做有界缓存策略 |
| `src/server/index.ts`：messagePushBody；引用/预览消费者 | 明确返回 [手写消息]；不得把笔画 JSON 发进通知、引用正文、AI 提示或 HTML 渲染 |
| `src/shared/demoMode.ts`、`src/server/demo/bundle.ts` | 各有类型白名单，需补类型和 payload 校验 |
| `src/server/routes/adminData.ts` | 管理员导出包含 payload，导入当前直接 upsert；导入手写必须校验并保留时间序列，异常项明确失败，不静默忽略 |
| `src/client/messageForward.ts`、`src/server/routes/forward.ts` | 首版保留排除手写的白名单，并补回归测试。未来转发不能只加类型：非 text 现有条件依赖 filePath，合并记录也缺笔画字段 |
| `src/scripts/wechat-relay/managedSource.ts`、`src/shared/wechatRelayNotifications.ts` | 独立类型解析/映射。首版允许读取手写并降级为固定标签，不能让一条手写导致整批轮询失败；测试使用 mock，不实际发微信 |

容量风险：Socket 当前 1,000,000 字节限制；历史默认 50 条、最多 200 条且 payload 完整返回。旧方案 250KB × 50 条约为 12.5MB，本文建议上限 128KiB × 50 条也有约 6.25MiB；均为未压缩理论数据量，**不是网络实测**。上线门槛必须包括密集历史页的传输、解析和缓存测量，不能只验收单条短消息。

## 5. 发送恢复、播放资格与缓存的明确规则

### 发送恢复（S3 所有）

- 编辑草稿绑定 accountId + actorId + channelId；发送快照同时冻结 replyToId、payload、content、UUID 和草稿修订号。账号或频道切换后的迟到结果不能清空新的草稿。
- 手写使用独立、有界的 IndexedDB 草稿/待确认记录模块，参考现有上传草稿做法；不塞入文本的 localStorage 数组，不改上传数据库结构。编辑草稿与待确认记录共同占用最多 8 个频道配额，每频道最多一个待确认发送；不能自动驱逐未确认记录。满额且没有可安全回收项时拒绝创建新频道草稿/新发送，提示先处理已有记录。
- 单个编辑草稿另设 12000 点/256KiB 硬保护，到达时明确停止继续采集，保留已有笔迹并提示撤销/分条；超过发送预算的草稿不可发送。未确认快照必须满足 128KiB 发送预算。保护编辑内存与草稿存储不能只限制已发 payload。
- 必须先持久化待确认快照，再发送。持久化失败时保留画板并明确提示，不能假装已保存继续清空草稿。内存中的大草稿有数量上限，关闭/切账号释放。
- 状态：editing → sending → confirmed；超时/连接中断 → unconfirmed；明确 not_sent → 可编辑重试；conflict → 保留快照并提示冲突。未确认期间该快照只可查看、查状态、用原 UUID 重试，不能边改笔画边用原 UUID 发送。
- 共用已有 useMessageSender 锁，防止文字与手写同时抢发。ACK、本人 message:new 的 clientRequestId、重连 message:status 的 sent 都可确认；任何确认只清理对应快照，重复确认幂等。
- 页面刷新后恢复 UUID 与原始 payload；重新发送相同意图仍用原 UUID。不能把“未查到”当作服务器绝不会完成：重试仍用原 UUID，不另发一份。
- 退出账号先终止恢复协调，再清理该账号本地记录；注销后迟到的查询/ACK 不得向本地库写回。不能通过伪造 actorId 在客户端改变发送身份。

### 播放资格（S3 接线，K3 消费）

- 单一入站接线按 account + channel + messageId 产生短暂资格；来源必须是实时 message:new，不从 createdAt、未读数、数组新增或组件 mounted 推断。
- 同步接收每一个事件再入队，避免只 watch 一个 lastIncomingMessage 引用丢掉同一 tick 的连续消息。队列最多 20 条、资格有效期 5 秒；超过上限/过期显示静态，不积压数分钟后突然播放。
- 播放前再检查当前视图、可见性、sender 和减少动态效果。一次最多一条自动播放；手动播放停止此前的手写播放。消耗资格在启动时完成，重复 Socket 事件不重新授予。
- 播放/已见 ID 仅驻留会话内，有上限；已见记录使用会话内最新 ID 水位配合近期集合，淘汰旧 ID 后也不把旧事件识别为新消息。退出/换账号清空。历史未见消息不会仅因 ID 较大获得资格。
- IntersectionObserver 观察稳定消息外框；Canvas 不改变尺寸。收藏页与聊天页同消息的两个实例不能同时消费自动播放资格。

### 消息窗口缓存（S3 所有）

- 优先限定本地窗口缓存的真实序列化字节预算：超限时裁掉该窗口最老记录并设置 hasOlder=true，仍保存完整的被保留 MessageDTO；所有窗口合计也必须有界。
- 不把裁剪后的半份 payload 当成有效手写缓存；不因 localStorage 满额而阻塞在线消息展示。需要针对“只有一个窗口仍超限”补测试，并保留原有文本缓存、未读和滚动语义。
- 暂不新增服务器笔画详情接口或附件文件存储。密集历史测试不达标时停止上线，交高级模型评估分页预算/按需载荷；较低模型不得自行重写 API。

## 6. 执行顺序与任务卡

遵循 [模型路由](model-task-routing.md) 和 [任务卡模板](task-cards.md)。不要把整篇文档作为“一次做完”的命令。

推荐顺序：`P0 → 用户确认原型 → S0 → S1 → S2 → S3 → K1 → K2 → K3 → K4 → R0`。这是节省协调成本的串行路线；K1/K2/K3 可由同一较低能力模型在三个独立任务中完成。S2 同一服务端领域内再分发送与备份两个检查点，逐次交付；不同时改客户端。

Sol 指仓库规定的高级模型职责；Terra/Kimi 指边界明确的客户端实现职责；Luna 仅适合冻结接口后的纯函数、边界测试和小范围样式。用户希望交给较低模型，并不自动等于授权它独立处理数据库、Socket 一致性或高风险审查。若只有较低模型，先完成 P0；高风险阶段需要明确降级授权及独立复核，不能静默降低验收标准。

所有任务卡共同字段（每张卡必须继承，启动时填写实际结果）：

- **基线/环境**：记录本卡起点 commit、前置任务 diff/交付、Node、依赖、图索引状态；不能假定仍是本文基线。
- **禁止文件**：除卡片明确允许外，禁止修改其他域、已有迁移、版本/CHANGELOG/发布文件、Service Worker、环境文件、运行数据、AGENTS；不得修改旧 ADR 伪装成历史决策。所有任务禁止擅自提交/推送/部署。
- **测试文件补充授权**：生产代码卡如需浏览器验证，可新增本卡独占的 `e2e/tests/handwriting-<卡编号>.spec.ts` 和 `e2e/fixtures/handwriting/<卡编号>/` 合成测试宿主；不得修改其他卡的 harness 或使用真实业务数据。独立组件测试不证明尚未完成的生产接线。
- **完整检查**：生产代码任务交付前 `npm run verify:full`；跨提交的 `verify:changed` 显式指定本卡基线。P0 只有隔离静态原型，记录专项浏览器验证和 public-tree，不把原型验证冒充生产完整验证。
- **未验证项**：本计划未执行任何功能测试；每张完成卡必须列出实际未跑的检查，尤其真机 iOS、后台、Socket 丢包和迁移。
- **停止条件**：同一失败两次、需要改禁止文件、无法解释工作区变化、依赖契约不清、预算门槛失败。保留现场并交高级模型，禁止扩大重写。
- **最终报告**：仅修改文件、完整测试命令/结果、剩余风险与下一卡依赖；不得只说“应该可用”。

### P0：逐字书写可交互原型

- 目标：让用户实际试写“你好”、删除重写、30 字、动画重播，确认手感与控件位置。
- 非目标：生产接入、真实账号/网络发送、数据库、持久化承诺；无前置依赖。
- 所有者：Terra/Kimi；复核：用户试写 + 后续 S0 契约复核。
- 允许文件：`prototype/handwriting/` 内的独立 HTML/JS/CSS、合成样本、README；不改根配置、依赖或 src。
- 复现：静态原型模拟发送到“收件人”区域，在同页看到逐笔重播。
- 验收：360/390/1280px；手指/鼠标画点、折线、越界、取消、旋转；暂停不切字、最后一字发送不丢；公开标注模拟发送。记录 2/10/30 字样本点数、字节数及外观。
- 检查：独立浏览器运行、控制台无错误、`npm run check:public-tree`、`git diff --check`。需要 iOS 真机手指试写；未具备设备时明确未验证，不据此宣称手感达标。

### S0：冻结共享笔画协议

- 目标：客户端/服务端对同一合法或非法 payload 得出一致结论。
- 非目标：数据库和发消息；依赖：P0 验收通过。
- 所有者：Sol 定义/复核；冻结后的单个边界测试可交 Luna。
- 允许文件：`src/shared/handwriting.ts`、`src/shared/handwriting.test.ts`、`src/shared/types.ts`、`src/shared/demoMode.ts`、本文契约章节。
- 复现：有效点、空格、非有限数、越界、倒序时间、超字数/笔数/点数/字节、未知版本，逐一构造输入。
- 验收：确定性 canonical payload；拒绝所有上限+1；浏览器与 Node 字节计算一致；版本降级解析不抛到 UI；不加入可选而未定义语义的扩展字段。
- 检查：`npm run test:shared`、`npm run check`，共同完整检查；本卡无浏览器交互/数据库迁移。

### S1：新增消息枚举迁移

- 目标：数据库能存 handwriting，现有数据与幂等唯一约束保持有效。
- 非目标：改任何已有迁移/表结构重构；依赖：S0。
- 所有者：Sol 执行，独立高级复核。
- 允许文件：`prisma/schema.prisma`、通过 Prisma 生成的新迁移目录、确有必要的迁移验证测试。
- 复现：旧 schema 拒绝新类型；使用可销毁开发库生成新 enum 迁移。
- 验收：只增 enum 值，payload 继续 Json；已有消息不丢，已有唯一键不变；新库全链及基线升级均成功。生成用 `prisma migrate dev`，长期库只能 `migrate deploy`。
- 检查：`npm run prisma:generate`、`npm run test:scripts`、在明确隔离的 `tm3_migration_verify` 库下 `MIGRATION_VERIFY_RUN=1 npm run test:migrations`，共同完整检查。不得使用业务库或 db push。

### S2：服务端发送与读取兼容

- 目标：合法手写一次落库、一次广播，历史和备份可恢复同一笔迹。
- 非目标：新的 HTTP 手写接口、上传文件、转发功能、机器人识字；依赖：S0/S1。
- 所有者：Sol 执行，独立高级复核。
- 允许文件：新增 `src/server/services/handwriting.ts` 及测试；`src/server/index.ts` 仅现有消息入口必要接线/标签；`src/server/services/messageSendIdempotency.test.ts`、`messageSerialization.test.ts`；`src/server/demo/bundle.ts` 及测试；`src/server/routes/adminData.ts` 及测试；`src/server/routes/forward.test.ts`；对应 focused socket 测试。
- 复现：当前 message:send 拒绝新 type；验证合法单点、30 字、无权限、音乐频道、假 content、重复 UUID、ACK 丢失、服务重启后重试。
- 验收：手写校验和受控标签在落库前完成；按第 3 节冻结手写 hash 输入，现有 text hash 不变；同 UUID 同笔画复用 messageId，改一笔冲突；写入/广播/push 不重复；状态查询保持现有权限；备份往返点/时间完全一致，损坏导入明确失败；HTTP 入口仍拒绝手写；纯手写转发请求被拒绝，混合请求沿用既有跳过统计并正确处理可转发文本。
- 检查：focused service/socket/serialization/demo/adminData 测试、`npm run test:server`、共同完整检查。必须测试真实入口接线和 create/emit 调用次数，不能只有纯 hash 测试。实际数据库唯一竞争由 R0 隔离集成验收。

### S3：客户端可靠发送、实时资格与有界缓存

- 目标：ACK 不确定/刷新/切频道不丢草稿、不重复发；只有真实新消息产生播放资格，缓存受预算限制。
- 非目标：画板视觉、重写所有文本发送/Socket 系统；依赖：S2。
- 所有者：Sol 执行，独立高级复核。
- 允许文件：`src/client/features/handwriting/` 下新增 `handwritingDrafts.ts`、`useHandwritingMessaging.ts`、`handwritingPlaybackRegistry.ts` 及各自测试；`src/client/store.ts` 最小入站/退出接线；`src/client/messageWindowCache.ts` 及测试；必要的 `src/client/messageSending.ts` 类型补充及测试。
- 复现：模拟落库成功但 ACK 丢失后刷新；同 tick 连收两条；字格编辑后旧 ACK 到达；单窗口缓存超预算。
- 验收：以依赖注入/harness 满足第 5 节的状态与数据规则；mock 组件可依赖 `submit(snapshot)`、`retry(requestId)`、`checkStatus(requestId)`、draft 状态和播放资格接口；编辑器不自己收 Socket；注入同一个 sender 时共用锁；pending 状态持久化失败可见；有界缓存不损坏 retained payload。App 中现有 sender 实例由 K4a 注入，本卡不得另建生产 sender 或宣称完成实际发送接线。
- 检查：该目录 focused tests、`messageSending.test.ts`、`messageWindowCache.test.ts`、store 对应 tests、`npm run test:client`、`npm run check`、共同完整检查；本卡浏览器 harness 验证 IndexedDB 刷新恢复，完整生产 Socket/刷新链路在 K4a/R0 验收。

### K1：纯绘制和重播时间线

- 目标：同一 payload 任意尺寸下保持笔迹，最终静态图与动画最后一帧一致。
- 非目标：网络、store、DOM 生命周期、弹窗；依赖：S0，按串行路线在 S3 后开始。
- 所有者：Terra/Kimi；复核：独立高级检查时间线边界。Luna 可单独承担一个纯时间线函数。
- 允许文件：`src/client/features/handwriting/handwritingRenderer.ts`、`handwritingTimeline.ts` 和对应 tests。
- 复现：单点、零间隔连续点、长笔间停顿、多字、删除一个字后的剩余序列、15 秒总长压缩。
- 验收：按第 3 节时间规则，无负时间/除零；静态、预览和播放器调用同一 draw 函数；DPR 只影响像素清晰度；每帧增量推进，不每帧重新解析全部 JSON。
- 检查：focused tests、`npm run test:client`、共同完整检查；浏览器用合成固定字迹比较静态/末帧，不以源码正则代替画面。

### K2：画板与逐字编辑器

- 目标：只靠 props/emit 完成第 2 节的编辑操作，输出冻结协议快照。
- 非目标：自己发请求、自己定义消息 DTO、改 AppModal 原语；依赖：S0/S3/K1。
- 所有者：Terra/Kimi；复核：高级模型审查边界 + 用户真机试写。
- 允许文件：`src/client/features/handwriting/HandwritingPad.vue`、`HandwritingComposer.vue`、`useHandwritingComposer.ts` 和对应 tests，局部 scoped CSS。
- 复现：pointerdown→move→up；pointercancel/lostpointercapture；画到边缘；第二根手指进入；切后台；第 30 字尚未切字就发送。
- 验收：仅追踪一个活动 pointer；画板局部 touch-action:none，不禁用页面全局滚动；pointer capture 越界仍可结束，坐标限制在格内；cancel 保留已采集有效笔迹且恢复可继续写状态；resize 从向量重绘，不能拉伸位图；busy/未确认禁改快照；关闭保草稿；取消清空不能误删。
- 检查：状态机 tests、`npm run test:client`、`npm run check`、共同完整检查；360/390/1280px、iPhone WebKit、真机手指/软键盘与横竖屏。无浏览器证据不算交互完成。

### K3：消息卡片播放器

- 目标：手写正文稳定呈现，播放行为严格受资格与可见性控制。
- 非目标：Socket、未读、数据库、自动播放推断；依赖：S3/K1。
- 所有者：Terra/Kimi；复核：高级模型审查生命周期。
- 允许文件：`src/client/features/handwriting/HandwritingMessage.vue`、`useHandwritingPlayback.ts` 及 tests，局部 scoped CSS。
- 复现：同消息卸载重挂、历史静态、手动连点、滚出屏幕、隐藏页面、切频道、两个播放实例、未知版本。
- 验收：固定最终高度；静态状态无 RAF；离屏/后台无活动帧；卸载取消帧、observer、listener；重入遵循第 2/5 节；无泄漏自动播放资格；reduced-motion 和键盘重播可用。
- 检查：可注入时钟/observer 的生命周期 tests、真实浏览器帧/布局观察、`npm run test:client`、共同完整检查。headless 无法真实隐藏时单列未验证，不假称覆盖。

### K4：生产 UI 挂接与旁路标签兼容

- 目标：用户可从更多面板发送，并在聊天/收藏重播；微信读取不被新类型阻断。
- 非目标：新业务逻辑塞进 App、转发笔画、跨域大清理；依赖：S2/S3/K2/K3。
- 所有者：拆为 K4a 客户端（Terra/Kimi）→ K4b shared 标签（Luna）→ K4c 工具读取（Terra/Kimi），三个任务串行；高级模型独立复核。
- 允许文件：K4a `ComposerBar.vue`、`MessageRow.vue`、`App.vue` 仅组装、`features/messages/useMessageRendering.ts`、必要的 `features/timeline/useVirtualTimeline.ts` 高度接线、`messageForward.test.ts` 及相关客户端测试；K4b `src/shared/wechatRelayNotifications.ts` 及测试；K4c `src/scripts/wechat-relay/managedSource.ts` 及测试。每个子任务禁止修改另两个子任务域。
- 复现：更多打开→写字→发送→另一账号看到动画→收藏→返回；含手写和普通文本的混合微信源返回。
- 验收：K4a 把 App 已有 useMessageSender 实例注入 S3 协调器，并验证文字与手写真实共用锁；权限/筛选入口规则明确；引用、推送、频道预览均标签化；收藏静态+手动重播；长按通用菜单无冲突；转发仍不开放；微信只输出占位标签且后续普通消息继续处理。不能实际发送微信作为验收。
- 检查：按子任务运行 `npm run test:client` / `test:shared` / `test:scripts`，每次交付共同完整检查；K4a 隔离 E2E；K4b/K4c mock 验证。

### R0：独立复核与上线前证据

- 目标：按下面的验收矩阵确认完整垂直链路，并只修发现的问题。
- 非目标：发布、版本号、顺手重构；依赖：所有卡片通过。
- 所有者：Sol 级独立复核；原执行模型不能用自己的报告代替复核。
- 允许文件：新增 `e2e/tests/handwriting.spec.ts` 及必要的隔离合成 fixture、本文验收结果、`docs/development-index.md` 相关模块说明；生产问题修复退回原卡授权文件。
- 复现：使用两个独立登录上下文真实发收，含 ACK 丢失/重复提交/刷新/重连/撤回，不只 mock send 函数。
- 验收：第 7 节全部完成或明确阻断；确认源码与文档一致；仅文档示例不是功能证据。
- 检查：`npm run verify:full`、隔离库 `npm run test:e2e -- e2e/tests/handwriting.spec.ts` 及受影响的 `smoke.spec.ts`、S1 迁移检查、`git diff --check`。E2E 连接串按 e2e/README.md 显式指向可重置的本地 tm3_e2e，禁止沿用未核对的环境值。

## 7. 交付验收矩阵

| 类别 | 必须拿到的证据 |
| --- | --- |
| 完整链路 | 两账号 A 逐字写“你好”并发送；B 收到逐笔动画；动画末帧等于 A 预览；刷新 B 得静态成品；手动可重播 |
| 编辑边界 | 单点/密集点/最后一字/30 字/超预算；撤销、删字、关闭重开、旋转、中断指针后继续；不会空白发送或丢最后一笔 |
| 消息一致性 | ACK 丢失、并发相同 UUID、落库后广播失败再重试、服务重启重试；数据库只有一条，后续历史可恢复；同 UUID 不同笔画明确冲突 |
| 草稿隔离 | 发送中切频道/账号，迟到 ACK/状态响应；刷新原账号频道保留原 UUID；退出账号不残留或被旧回调写回 |
| 播放生命周期 | 连续实时消息不漏事件、不无限排队；历史/收藏不自播；重复事件不自播；离屏/后台 RAF 为 0；卸载重挂不重播 |
| 安全与兼容 | 无权/音乐频道被服务端拒绝；未知版本、超限、恶意对象拒绝；损坏历史不拖垮列表；备份往返、引用、收藏、撤回、微信读取正常 |
| 滚动和密集历史 | 2/10/30 字的合成与真人样本；50/200 条密集历史测传输量、JSON 解析、longtask、滚动；缓存总字节有界；动画期间行高/scrollHeight/阅读锚点不跳 |
| 设备 | 360/390/1280px，Chromium + iPhone WebKit；iOS 真机手写、横竖屏、后台恢复；模拟 viewport/HTTP 节流不能宣称真机或 Socket 弱网通过 |

初始验收目标：绘制期间单帧工作 p95 不超过 8ms、由动画引发的 longtask 为 0、播放前后高度误差不超过 1px。需在报告注明设备、浏览器、样本和采样方法；这是待验证目标，不是本次测量结果。密集历史若有明显主线程阻塞、缓存超预算或无法顺畅操作，暂停上线，由高级模型调整数据预算或载荷策略。

## 8. 可直接交给后续模型的启动提示词

```text
先阅读 docs/handwriting-implementation-plan.md，以及仓库和目标目录 AGENTS.md。
本次只执行任务卡【P0】，不得自动继续后续卡片。

开始先检查 git status --short / git log --oneline -n 5，确认没有不理解的已有改动。
记录当前基线和环境；优先代码图工具发现，关键结论用当前源码复核。
将本卡的共同字段和专属字段展开为完整任务卡，严格遵守允许/禁止文件。

已确定的产品要求：逐字书写、手动切字、不做识别、最多30字；发送时包含尚未切字的最后一字；
保存向量，收件人按笔画动画播放。P0 只在 prototype/handwriting/ 做模拟发送原型。
不能改 src、数据库、版本、发布文件或 Service Worker；不能安装依赖、提交、推送、部署。

交付可运行原型、启动说明、合成样本、360/390/1280px 浏览器证据。
检查单点、越界、pointercancel、删字、撤销、长停顿、30字、最后一字与动画末帧。
说明哪些浏览器/真机验证没有做；不要用源码正则或 mock 按钮证明手写手感。
同一失败两次或需要越界即停止并报告证据，不扩展重写。
最后只报告修改文件、测试命令/结果、剩余风险，等待用户确认原型。
```

后续每次将【P0】替换成获准的**单张卡**，并把提示词中的 P0 特有范围替换为该卡范围。不要仅替换编号而保留互相矛盾的允许文件。S3 完成前，不应让较低模型自行猜测发送、持久化和自动播放接口。

独立复核提示词：

```text
按 docs/handwriting-implementation-plan.md 的任务卡【实际编号】和当前完整 diff 独立审查。
重跑验收，不相信原模型“已通过”的总结。重点检查真实调用接线、消息去重、迟到响应隔离、
草稿持久化、历史/实时来源区分、离屏资源释放、恶意 payload 与预算上界。
只修改已证实的问题；需要越界时退回对应任务卡。给出命令、结果、未验证项。
未明确授权不得提交、推送、部署或更改版本。
```
