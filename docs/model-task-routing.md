# Codex Model Task Routing

This document defines the repository's task-size and risk routing rules. Use it with the
[repository guidance](../AGENTS.md), the [development index](development-index.md), and
any nested `AGENTS.md` in the files being changed. The development index remains the
canonical module map and validation reference; this document does not duplicate it.

Routing priority is **Sol > Terra > Luna**. File count never lowers the model required by
the risk. If any Sol rule applies, route the whole task to Sol or split out a genuinely
independent lower-risk task with its own acceptance criteria.

**When Sol is unavailable, work does not stop — risk ownership moves to the user.** In
order: (1) split out and finish the genuinely independent lower-risk parts; (2) defer the
high-risk part until Sol is available; or (3) the user explicitly authorizes a lighter
model to proceed — record the authorization on the task card, tighten acceptance (more
targeted failure cases plus an independent review), and never deliver a downgraded task
against the original standard silently. The Sol-only list below still defines what counts
as high risk; unavailability does not reclassify it.

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

A task card ([docs/task-cards.md](task-cards.md)) is required only for tasks that cross a
boundary: delegated to another model or session, run in parallel with other work, or
touching a Sol-risk area. Routine single-session fixes inside one domain do not need one.
The card carries baseline, goal, owner, dependencies, allowed/forbidden files,
reproduction, acceptance, targeted/full checks, and unverified items. Fill every field;
write "none" with a reason instead of deleting a field.

## 多模型协作规则

- **Ownership:** Sol owns high-risk areas (schema/migrations, auth, Socket concurrency,
  file storage, Service Worker caching, architecture). Kimi takes bounded client, test,
  and documentation tasks with an explicit file scope. File count never lowers the model
  required by the risk, and Sol unavailability follows the downgrade rule at the top of
  this document — it never silently reclassifies a task.
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
