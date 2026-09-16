# E2E 测试（Playwright）

隔离的浏览器端验收与性能基线，运行于独立的 `tm3_e2e` MySQL 数据库，绝不允许指向其他库。

## 运行方式

标准入口（需要本机 Docker + Compose，自动起一次性 MySQL 33306 并在结束后销毁）：

```bash
npm run test:e2e:local
```

没有 Docker 时，自备一个本地 MySQL（任意端口），先建好同名库和账号：

```sql
CREATE DATABASE IF NOT EXISTS tm3_e2e CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'tm3_e2e'@'127.0.0.1' IDENTIFIED BY 'tm3_e2e';
CREATE USER IF NOT EXISTS 'tm3_e2e'@'localhost' IDENTIFIED BY 'tm3_e2e';
GRANT ALL PRIVILEGES ON tm3_e2e.* TO 'tm3_e2e'@'127.0.0.1';
GRANT ALL PRIVILEGES ON tm3_e2e.* TO 'tm3_e2e'@'localhost';
FLUSH PRIVILEGES;
```

然后显式给出连接串（`e2e/prepare.ts` 会强制校验主机必须是本地、库名必须是 `tm3_e2e`）：

```bash
E2E_DATABASE_URL="mysql://tm3_e2e:tm3_e2e@127.0.0.1:3306/tm3_e2e" npm run test:e2e
```

跑单个 spec（参数原样透传给 Playwright）：

```bash
E2E_DATABASE_URL="mysql://tm3_e2e:tm3_e2e@127.0.0.1:3306/tm3_e2e" npm run test:e2e -- e2e/tests/weak-network.spec.ts
```

每次运行前 `e2e/prepare.ts` 会 **重置整个 `tm3_e2e` 库** 并重新播种：管理员账号、默认/第二频道、以及 300 条消息的性能基线频道。

## 测试分组

| 文件 | 内容 | 性质 |
| --- | --- | --- |
| `smoke.spec.ts` | 登录、频道、消息持久化、转发、接龙、断线保草稿、圣经、账号管理 | 回归门禁 |
| `app-modal.spec.ts` | 退出频道确认弹窗、转发弹窗的焦点陷阱（真实应用） | 回归门禁 |
| `app-modal-harness.spec.ts` | 离线编译 AppModal 宿主页：双层叠放 Escape/Tab、busy 不响应 Escape、焦点归还触发元素 | 回归门禁 |
| `weak-network.spec.ts` | GET 20s×2 超时预算、快速往返切换频道的代际隔离、失败后点按横幅重试 | 回归门禁 |
| `modal-keyboard.spec.ts` | 转发弹窗在 1280/390/360px 的焦点矩阵 | 回归门禁 |
| `perf-baseline.spec.ts` | 首进/切频道/滚动/后台停留的耗时与 longtask 采样 | 仅记录，不设阈值 |

## 性能基线（perf-baseline.spec.ts）

每轮使用全新浏览器上下文保证冷启动一致，分"正常网络"和"弱网节流（400ms 延迟、200KB/s 下行、4x CPU，CDP 实现，仅 Chromium）"两组条件。轮数默认 5，可用环境变量调整：

```bash
E2E_PERF_ROUNDS=2 E2E_DATABASE_URL="mysql://tm3_e2e:tm3_e2e@127.0.0.1:3306/tm3_e2e" npm run test:e2e -- e2e/tests/perf-baseline.spec.ts
```

结果写入 gitignore 的 `output/e2e/`：

- `perf-baseline-<时间戳>.json`：每轮全量采样；
- `perf-baseline-latest.md`：最近一次的中位数与范围汇总表。

刻意不设 CI 阈值断言：绝对耗时随机器漂移，报告用于纵向对比同机趋势，红灯门禁由上面的回归 spec 承担。

## 已知未覆盖项

- **后台（hidden）标签页**：本环境 headless Chromium 所有页面恒为 `visible`（已验证 `bringToFront` 与 CDP 焦点模拟均不改变 `visibilityState`），因此 `perf-baseline.spec.ts` 的"后台停留投递"步骤会自动跳过并在报告中标记为环境不支持；真机后台行为需人工验收。
- **WebSocket 弱网**（丢包/高延迟下的 socket 行为）不能用 HTTP route 拦截冒充；现有断线保草稿覆盖见 `smoke.spec.ts` 的 socket disconnect/connect 用例。
- **部分响应滴灌**（先返回响应头再卡住 body）：Playwright route 不支持按字节节流，`weak-network.spec.ts` 以整体挂起代替，超时预算仍覆盖"全程 20s"语义。
- **DevTools 节流 ≠ iOS 真机**：CDP 的 CPU/网络节流只是近似，真机验收仍需人工。
- **双层 AppModal 在真实应用中无场景**（频道编辑器先关再出确认框），双层语义由 harness 覆盖。
