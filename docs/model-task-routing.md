# Codex Model Task Routing

This document defines the repository's task-size and risk routing rules. Use it with the
[repository guidance](../AGENTS.md), the [development index](development-index.md), and
any nested `AGENTS.md` in the files being changed. The development index remains the
canonical module map and validation reference; this document does not duplicate it.

Routing priority is **Sol > Terra > Luna**. File count never lowers the model required by
the risk. If any Sol rule applies, route the whole task to Sol or split out a genuinely
independent lower-risk task with its own acceptance criteria.

## Luna 可处理

- 单一纯函数。
- 已有明确失败测试的简单 bug。
- 文案、类型、测试补充。
- 单组件小范围样式。
- 机械配置与文档同步。
- 不超过 1—3 个紧密相关文件。

Luna tasks must have a narrow interface, an established local pattern, and a deterministic
targeted check. Luna must stop and escalate when the change crosses a domain seam, exposes
an unstated invariant, or reaches any Sol area.

## Terra 可处理

- 单一领域功能。
- 3—8 个紧密相关文件。
- 普通客户端组件和 composable。
- 单一路由模块。
- 有明确验收和测试的重构。
- 一般 UI 和 API bug。

Terra is the default implementation model for normal repository work. Keep the task inside
one domain where possible, trace consumers before changing a shared interface, and use the
targeted and full checks declared in the task. Two failed attempts against the same failure
are a mandatory Sol escalation, not permission for a broad rewrite.

## Sol 必须处理

- Prisma schema 和数据迁移。
- 认证、权限和账号删除。
- Socket 并发、重连和消息一致性。
- 文件访问、上传、删除和 SSRF。
- Service Worker 缓存一致性。
- 跨三个以上领域的改动。
- Terra 连续失败两次的任务。
- 架构拆分和高风险 PR 审查。

Sol is also required when work changes AI credential encryption, assistant activation and
message-writing order, or virtual-role authorization across the main application and the
multichar engine. Pure prompt copy that does not alter activation, permissions, persistence,
or shared contracts may still follow the ordinary Luna/Terra limits.

## 统一任务模板

```md
# 任务

## 目标
- 要交付的可观察结果：

## 非目标
- 本任务明确不处理：

## 允许修改文件
- 精确文件或目录：

## 禁止修改文件
- schema、迁移、发布文件、Service Worker 或其他越界区域：

## 验收条件
- 行为、接口、错误状态和兼容性要求：

## 定向测试
- 最小复现或失败测试：
- 领域检查命令：

## 完整测试
- `npm run verify:full`
- 任务需要的浏览器、迁移或其他独立检查：

## 停止条件
- 同一失败连续两次。
- 需要修改禁止文件、扩大到第三个以上领域或取得新权限。
- 发现无法解释的工作区改动、数据风险、安全风险或秘密信息。

## 最终报告格式
- 修改文件：
- 测试结果：
- 剩余风险：
```

## 审计背景

The architecture audit behind these routing rules (baseline metrics, application-shell
reduction, test inventory, CI checks, coupling analysis, retained source-regex suites)
lives in [docs/architecture-audit.md](architecture-audit.md). Read it only when a task
needs that background; it is not part of session startup.
