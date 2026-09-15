# Task Cards

A task card is the handoff contract for one bounded task. Every delegated or multi-session
task gets a card before work starts; fill every field, and write "none" with a reason when a
field does not apply instead of deleting it. The card travels with the task: the reviewer
checks the delivered diff against the card, not against a verbal summary.

Keep cards short. One card covers one behavior goal in one domain; do not bundle unrelated
cleanup. High-risk areas (schema/migrations, auth, Socket concurrency, file storage,
Service Worker caching) are owned by Sol; bounded client, test, and documentation tasks may
be delegated to a lighter model within the declared file scope.

## Template

```md
# 任务卡：<编号与一句话标题>

## 基线
- Commit / 版本：
- 环境（Node、依赖状态、图谱索引新旧）：

## 目标
- 要交付的可观察结果：

## 非目标
- 本任务明确不处理：

## 所有者
- 执行 / 复核：

## 依赖任务
- 必须先完成或并行冲突的任务：

## 允许修改文件
- 精确文件或目录：

## 禁止修改文件
- schema、迁移、发布文件、Service Worker 或其他越界区域：

## 复现
- 最小复现步骤或失败断言（先复现，再修复）：

## 验收条件
- 行为、接口、错误状态和兼容性要求：

## 检查
- 定向检查命令：
- 完整检查：`npm run verify:full`（跨提交时 verify:changed 须显式 `--base`）
- 任务需要的浏览器 / 迁移 / E2E 检查：

## 未验证项
- 已交付但未验证的部分及原因（如 iOS 真机、弱网实测）：

## 停止条件
- 同一失败连续两次；需要修改禁止文件；发现无法解释的工作区改动。

## 最终报告格式
- 修改文件：
- 测试结果（完整命令与退出结果）：
- 剩余风险：
```

## 示例：S1 请求全过程超时与主动取消

```md
# 任务卡：S1 GET 请求全生命周期超时与取消

## 基线
- Commit：28aef24（2026-09-15）
- 环境：Node 22，npm ci 干净安装，图谱索引已刷新。

## 目标
- 一次 GET 尝试从发起到读完响应体都受期限约束；主动取消不重试且立即终止退避等待。

## 非目标
- 不改 store 消息窗口逻辑；不动非 GET 的语义；不调整上传和流式接口的超时。

## 所有者
- 执行：Sol（api 层并发与取消语义）；复核：按验收用例独立复跑。

## 依赖任务
- 无前置；S2 依赖本任务完成后再动 store。

## 允许修改文件
- `src/client/api.ts`、`src/client/api.test.ts`；确有必要可新增 focused client network helper 及其测试。

## 禁止修改文件
- 服务端、shared DTO、schema/迁移、Service Worker、鉴权存储、store.ts。

## 复现
- 模拟 fetch：响应头立即到、响应体挂起；当前实现 20 秒计时在响应头到达后即被清除，读取阶段无期限。

## 验收条件
- 新用例覆盖：body 挂起、body 中途断开、调用前 abort、读取中 abort、退避时 abort、外部 signal 与内置超时共存、一次网络失败后成功、HTTP 错误不重试。
- 每个用例断言请求次数与最终状态；每条路径释放 timer/listener；保留现有 api 测试。

## 检查
- 定向：`npm run test:client`（api 相关用例）、`npm run check`。
- 完整：`npm run verify:full`。

## 未验证项
- 真实弱网设备表现（由 K2 的节流场景另行测量）。
```

## 示例：K1 共享弹窗焦点与键盘行为

```md
# 任务卡：K1 AppModal 焦点生命周期与最上层键盘控制

## 基线
- Commit：28aef24（2026-09-15）
- 环境：Node 22，npm ci 干净安装。

## 目标
- 打开时焦点进入弹窗，Tab/Shift+Tab 约束在最上层弹窗内，Escape 一次只关闭最上层，关闭后焦点归还触发元素。

## 非目标
- 不迁移全站弹窗；不重写 App.vue；不改变 busy、遮罩点击和显式关闭语义。

## 所有者
- 执行：Kimi（有界客户端原语任务）；复核：Sol 审查共享原语与叠层行为。

## 依赖任务
- 无；与 S1 在独立工作区并行，集成时 App.vue 挂接改动串行。

## 允许修改文件
- `src/client/components/ui/AppModal.vue`；必要时新增同目录 modal stack/focus helper；相关测试与独立 E2E 场景。

## 禁止修改文件
- 服务端、shared、schema/迁移、Service Worker；App.vue 仅允许必要挂接。

## 复现
- 真实浏览器打开两层 AppModal：一次 Escape 同时关闭两层；Tab 焦点逃逸到弹窗背后的页面。

## 验收条件
- 无可聚焦子项时有安全焦点；触发元素卸载时焦点回退合理；20 次开关无监听器残留。
- 360px、390px、1280px 宽度与长表单、busy 状态均通过。

## 检查
- 定向：弹窗行为测试、`npm run test:client`、`npm run check`。
- 完整：`npm run verify:full` 与相关隔离 E2E。

## 未验证项
- iOS 真机软键盘与输入法组合期间的 Escape 行为（未实测须写明）。
```
