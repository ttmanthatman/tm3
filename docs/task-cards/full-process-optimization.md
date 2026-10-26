# 全流程优化总任务卡（2026-10-24 起）

跨会话、多批次的高风险治理任务；执行路线图全文在私有记录（本机忽略目录
`output/optimization/2026-10-24/` 的计划副本与批次记录），本卡只保留公开安全的
阶段状态与证据索引。环境代号「Azure 测试站」的主机、凭据与部署细节一律留在
私有记录，不写入受跟踪文件。

## 目标 / 验收

按 P0–P10 路线图完成基线、验收护栏、部署闭环、测试质量、前后端结构治理、
性能实测与工作流闭环的批次化优化。每个修改运行代码的批次都部署到 Azure
测试站完成公共冒烟与本轮专项；真机（iPhone/Android/桌面）结果齐备才算验收，
缺真机证据时状态保持「待真机验收」，不以模拟视口冒充。不以入口文件行数或
文件总数为完成门槛；收益表述绑定测量或结构证据。

## 基线 / 所有者

- 起点 SHA：`01aef47`（v2.12.0），ZCode 工作区 main 分支。
- 指标基线（计数口径、入口尺寸、lint=0 警告、test:all 21s、build 11s、CI job
  耗时）见私有记录 `output/optimization/2026-10-24/metrics-baseline.txt`。
- CI 起始状态：Verify 与 Prisma 迁移基线 job 绿；Browser smoke（WebKit 优先跑
  `e2e/tests/books.spec.ts`）自 `b5522a0` 起持续红，根因是该 spec 390px 分支
  使用仅 Chromium 可用的 CDP 触摸派发。

## 范围

- 允许：全仓代码、测试、文档、CI 与验证脚本按批次修改；每批次声明不变量与
  允许文件清单。
- 禁止（除非另行授权）：提交/推送/生产部署/版本号/release 元数据/schema 与
  已提交迁移/Service Worker 变更；删除 `musicPlayer.ts`；一次性大拆
  `App.vue`；对保留库执行 reset/seed。

## 阶段状态

| 阶段 | 主题 | 状态 | 备注 |
| --- | --- | --- | --- |
| P0 | 基线与文档漂移 | 通过；真机/写入基线**待验收** | 指标/文档/ADR/任务卡完成；CI 既有红已定位并修复（P0-F1）；仅有匿名只读 Azure 基线，登录后行为与真机基线待账号 |
| P0-F1 | CI WebKit books 冒烟修复 | **通过**（随 e7dd62a 部署） | 分支 CI 的「iPhone WebKit book smoke」步骤由红转绿；Azure 已运行该修复所在构建 |
| P1-A | 远程护栏 profile 化 | 代码完成，`verify:full` 通过 | demo/azure 精确允许列表 + 同目标校验 + 11 组拒绝矩阵 |
| P1-B | Azure 专用账号验收与远程冒烟 | 浏览器维度**通过**；真机**待验收** | 专用账号/私有频道建立并核实隔离；`test:e2e:remote` 连续两轮 2 passed（360/390/桌面 + Socket/SW/持久化/圣经跳转）；spec 按当前构建做了 6 项环境适配（证据见私有台账） |
| P1 | Azure 验收护栏与远程冒烟 | 剩真机验收与登录后行为基线 | 凭据就绪、护栏与冒烟全绿；真机清单已交用户 |
| P2 | 构建身份、增量部署与回退 | **通过** | 优化工作在分支 `codex/full-process-optimization`（main 保持 01aef47）；Azure 已从分支部署 e7dd62a（2.12.0）并三核对+远程冒烟全绿；回退演练与部署前快照俱备；CI 的 WebKit 红点在分支转绿 |
| P3 | 测试质量与渐进门禁 | 确定性失败清零（两轮 CI 验证）；剩登记项待用户/后续 | 字号保存回写竞态已修（产品级：镜像 watch 待保存守卫+定向回归，未修时 22≠23 可复现）；story-drop 圣经遮挡、三处 WebKit 超时、夹具公开性/分享竞态/helper 时序等全部修复并连续两轮全绿（ff2d64b）；剩余=录音 WebKit×3（Linux 无 MediaRecorder，三选项待用户）+playback alpha 待 Linux 像素证据+每轮 0-2 个单发测量漂移（均登记）；CI 已四分片（job 7-15 分钟）。详见私有 ci-band-register.md |
| P4–P10 | 前端治理/后端模块/性能/安全/CI 闭环/终验 | 待实施 | 按路线图依赖顺序推进 |

## 进度 / 下一步

- 已完成：开工检查与脏树保护；指标基线；performance-roadmap/architecture-audit/
  ADR-0001 漂移修正；CI 失败根因修复（待推送观察）；Azure 匿名只读基线；
  P1-A 护栏改造与 `verify:full`。
- 下一步（接手者第一个动作）：等待用户提供的 Azure 连接与测试账号核实结果；
  拿到有效凭据后核实/建立专用账号与私有频道、验证外部通知隔离，再运行
  `npm run test:e2e:remote` 完成远程冒烟与多分辨率浏览器验收。

## 检查

- 各批次记录（含命令、退出码、日志路径）在本机忽略目录
  `output/optimization/2026-10-24/batches.md`；不复制长日志入公开文件。
- P0-F1：`e2e/tests/books.spec.ts` WebKit 6 passed / Chromium 6 passed（退出码
  均 0），双引擎经 `E2E_DATABASE_URL`→`tm3_e2e` 一次性库运行。

## 风险 / 阻碍

- Azure 部署连接方式（host/user/key、应用目录、pm2 之外的细节）未在任何私有
  记录中找到；用户/Codex 正在核实，等待结果，不能用生产站或 ledouniu 参数套用。
- 真机验收依赖用户提供 iPhone/Android 实测结果；未提供期间相关批次保持待验收。
- 远端 `/api/version` 自述的 pm2 自更新链路只在只读探测中确认过显示值，真实
  部署/回退能力要在 P2 首轮部署时验证。
