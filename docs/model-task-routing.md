# Codex Model Task Routing

This document defines the repository's task-size and risk routing rules. Use it with the
[repository guidance](../AGENTS.md), the [development index](development-index.md), and
any nested `AGENTS.md` in the files being changed. The development index remains the
canonical module map and validation reference; this document does not duplicate it.

## 默认由执行者选择流程

用户负责描述想要的结果，执行者负责确定范围、实现和验收。普通小改动在当前会话由一个执行者完成，不要求用户选择模型、理解代码或填写任务卡。模型名称不是正确性的保证；按风险和已观察到的能力升级，不为一个小改动默认启动多模型协作。

| 级别 | 典型任务 | 执行要求 |
| --- | --- | --- |
| 小改动 | 文案、单组件样式、明确的单点修复、文档同步 | 就近定位，最小修改，针对性验收；不做全仓审计或另起评审任务 |
| 常规开发 | 一个领域的组件、composable、普通路由或功能 | 跟踪相关调用者，完成领域检查和受影响构建 |
| 高风险 | schema/迁移、认证权限、账号删除、Socket 并发和消息一致性、文件访问/上传/删除/SSRF、Service Worker、凭据加密、AI 写入顺序、跨领域共享契约、架构拆分、验证基础设施 | 先列不变量和失败场景，再实现；完成全量验证及相关 E2E/迁移检查，必要时独立复核 |

单文件也可能高风险。AI 激活及虚拟角色授权属于高风险；不改变激活、权限、持久化或共享契约的纯提示词文案可按小改动处理。具体检查以[开发流程](development-workflow.md)为准，不能仅凭 `verify:changed` 的路径分类判断风险。

保留当前会话的模型设置，不声称已经自动切换模型或推理强度。若当前执行者连续两次无法解决同一故障，保留证据和可复核改动，说明阻碍与下一步；需要交接时才创建简短任务卡，不把技术风险转交给不会编程的用户判断。

## 统一任务模板

A task card ([docs/task-cards.md](task-cards.md)) is required only for tasks that cross a
boundary: delegated to another model or session, run in parallel with other work, or
touching a high-risk area. Routine single-session fixes inside one domain do not need one.
The card carries baseline, goal, owner, dependencies, allowed/forbidden files,
reproduction, acceptance, targeted/full checks, and unverified items. Fill every field;
write "none" with a reason instead of deleting a field.

## 多模型协作规则

- **Ownership:** one executor owns the complete task by default. When delegation is
  justified, assign independent scopes and acceptance criteria. High-risk work requires
  adequate capability and evidence, regardless of model branding; file count never lowers risk.
- **Shared files serialize:** tasks that write `App.vue`, `store.ts`, or `api.ts` run one
  at a time, never in parallel. Independent tasks use separate worktrees; a separate
  worktree prevents tree pollution but not logical conflicts, so the integration order is
  declared in the task cards before work starts.
- **Baseline before conclusions:** record the commit, environment, and graph-index
  freshness on the card. A clean Git diff does not prove a fresh index; a failed check
  caused by missing dependencies is an environment problem, not a source regression.
- **Independent review on handoff:** the reviewer re-runs the card's acceptance scenarios
  against the delivered diff — actual call wiring, lifecycle cleanup, and test realism —
  and fixes only the findings, without expanding into a second refactor.

## 审计背景

The architecture audit behind these routing rules (baseline metrics, application-shell
reduction, test inventory, CI checks, coupling analysis, retained source-regex suites)
lives in [docs/architecture-audit.md](architecture-audit.md). Read it only when a task
needs that background; it is not part of session startup.
