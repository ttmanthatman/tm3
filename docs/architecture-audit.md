# Architecture Audit

This document preserves the architecture audit behind the model routing rules in
[model-task-routing.md](model-task-routing.md). It is background reading for tasks that
need audit evidence (coupling analysis, test inventory, CI structure); it is not part of
session startup.

## 审计基线和结论

The audit used `main` at `5283926` and compares line-count reduction with `7dabb68`, the
last release commit before the current Codex workflow-improvement sequence. Counts use
physical lines from `wc -l`.

The repository is ready for Terra as the daily primary model and Luna for bounded,
low-risk work, provided the routing priority above is enforced. The extracted modules
improve locality, test seams, and application startup, but the remaining application shells
are still too broad for low-context architectural changes.

## Application shell reduction

| Module | Baseline | Current | Reduction |
| --- | ---: | ---: | ---: |
| `src/client/App.vue` | 13,104 | 12,412 | 692 lines (5.3%) |
| `src/server/index.ts` | 7,643 | 6,899 | 744 lines (9.7%) |

`src/server/main.ts` is now a separate 34-line process-lifecycle adapter. The server
application count above intentionally refers to `src/server/index.ts`, which still constructs
Fastify and owns the main route/socket implementation.

## Test inventory

There are **60 test files** in the repository:

| Classification | Files | Canonical command or role |
| --- | ---: | --- |
| Client | 24 | `npm run test:client` |
| Server | 21 | `npm run test:server` |
| Shared | 5 | `npm run test:shared` |
| Scripts | 6 | `npm run test:scripts` |
| Service Worker | 1 | `npm run test:service-worker` |
| Isolated local E2E | 1 | Seven critical Playwright flows via `npm run test:e2e` |
| Non-destructive remote E2E | 2 | Diagnostic and retained-test-station smoke flows |

`npm run test:all` classifies and runs the first 57 source test files exactly once. Browser
files are intentionally separate because they require isolated database/browser infrastructure
or the guarded remote test environment.

## `verify:changed` coverage

The planner in
[`src/scripts/verify-changed.ts`](../src/scripts/verify-changed.ts) recognizes ten domains:
client, server, shared, Prisma, Service Worker, scripts, documentation/release, GitHub
workflow, configuration, and unknown critical.

- Client and server changes receive their matching type check and focused test group.
- Shared changes receive both type checks plus client, server, and shared tests.
- Prisma changes generate the client and run server type, test, and build checks.
- Service Worker changes receive release consistency and Service Worker tests.
- Script changes receive server type checking and script tests.
- Documentation/release changes receive the public-tree check, plus release consistency for
  managed release files.
- Workflow, dependency/build configuration, and unknown critical changes fall back to
  `npm run verify:full`.

This command is an iteration shortcut. It does not replace E2E or migration verification,
and final handoff/CI must continue to use `npm run verify:full`.

## CI checks

The [CI workflow](../.github/workflows/ci.yml) runs on pull requests, pushes to `main`, and
manual dispatch:

1. **Verify** uses Node.js 22, `npm ci`, Prisma client generation, and
   `npm run verify:full`. That covers public-tree safety, release consistency, client/server
   type checks, all 57 classified source tests, and client/server production builds.
2. **Prisma migration baseline** uses a disposable MySQL 8.4 database to apply committed
   migrations, check migration status, verify no schema diff, and confirm the `0_init`
   history.
3. **Browser smoke tests** use a separate disposable MySQL 8.4 database, install Chromium,
   reset/seed only the guarded E2E database, and run the seven critical Playwright flows.
   Failure-only browser artifacts are retained for seven days.

CI does not deploy, publish, push, connect to a retained application database, or run the
remote E2E suite.

## Manual release work

The [release checklist](development-index.md#release-checklist) and
`npm run release:prepare -- <version>` automate version-file synchronization, changelog
archiving, shared release metadata, and consistency checks. A release owner must still:

1. Confirm `Unreleased` notes and select the target SemVer.
2. Review the dry run and generated diff, then verify the settings/admin release display.
3. Run final full verification and review the complete release diff.
4. Create the release commit and tag, push them, create any GitHub Release or publication,
   and perform deployment, production migration, restart, and health checks under separately
   granted authority.

Release preparation deliberately performs none of the actions in step 4.

## Five strongest remaining coupling areas

1. **Client application shell** — `src/client/App.vue` still combines auth, chat, Why,
   administration, settings, music, Bible, modal, composer, effect, and release interfaces.
   Its 18 modal shells and cross-domain lifecycle cleanup keep knowledge and verification
   spread through one shallow module, so locality remains low.
2. **Server application shell** — `src/server/index.ts` still contains 116 HTTP route
   registrations plus the Socket connection and event handlers. Transport, business rules,
   Prisma access, filesystem effects, AI, and administration remain in one implementation
   despite the new process and focused route seams.
3. **Chat navigation and realtime message windows** — `src/client/App.vue`,
   `src/client/store.ts`, `src/server/index.ts`, and `src/shared/types.ts` share ordering
   invariants for channel selection, cached windows, HTTP reloads, Socket reconciliation,
   room membership, and read positions. The interface is distributed, reducing locality.
4. **Message, attachment, and media lifecycle** — message serialization, upload, recall,
   download, deletion, music assets, DTO variants, disk paths, transactions, Socket events,
   and push ordering span the server shell, music route/service modules, file-policy modules,
   shared types, and client rendering. A missed invariant can cause unauthorized access,
   orphaned files, or inconsistent clients.
5. **AI and virtual roles** — assistant settings, encrypted credentials, activation,
   context construction, message writes, channel visibility, and the multichar engine span
   both application shells, `src/server/multichar/`, shared types, and Prisma models. The
   main-assistant and multichar implementations share a wide configuration and message seam.

These are audit findings, not authorization to refactor them in an unrelated task.

## Retained source-regex tests

Eight suites still inspect source text or generated source structure with regular
expressions:

| Suite | Why it remains |
| --- | --- |
| `src/client/responsiveLayout.test.ts` | Legacy structural safety net for responsive CSS, App template wiring, modal layers, and extracted-module ownership where no mounted-component harness covers the same breadth. It is the largest and most brittle suite and should be replaced incrementally, not deleted wholesale. |
| `src/client/musicPlaylistActions.test.ts` | Protects dialog ordering, focus wiring, template hooks, and related CSS until those interactions have focused component/browser coverage. |
| `src/server/likeNotification.test.ts` | Protects the route's Socket-then-push notification wiring while that route still lacks a focused injectable seam. |
| `src/server/musicPlaylistRoutes.test.ts` | Protects schema invariants, authorization patterns, media validators, and the rule that music endpoint bodies stay out of the main server module; behavioral route tests only partially overlap it. |
| `src/scripts/prisma-migrations.test.ts` | Source inspection is appropriate for immutable DDL parity and for forbidding destructive, environment-specific, or data-bearing SQL in the baseline. |
| `src/scripts/release.test.ts` | Verifies the exact structure generated in release metadata and changelog fixtures so the parser and writer remain synchronized. |
| `src/scripts/remote-e2e.test.ts` | Enforces a negative safety property: the guarded remote runner and specs must not contain reset, seed, or destructive database commands, and local credentials/artifacts must stay ignored. |
| `src/scripts/service-worker.test.ts` | Combines a VM-executed fetch handler with static checks for cache partitioning, authenticated content routes, byte ranges, and revalidation that lack a complete browser-worker harness. |

Regex coverage is not proof of runtime behavior. New work should prefer tests through a
module's interface, Fastify injection, or Playwright; retain these tests only until equivalent
behavioral coverage exists.

## Sol-only high-risk domains

The mandatory Sol list above is grounded in the remaining seams: migrations and schema
history; authentication, permissions, sessions, and deletion; Socket ordering and message
consistency; filesystem and outbound-network security; Service Worker/release cache
coordination; AI credential and virtual-role authorization; cross-domain architecture; and
high-risk review. These areas combine irreversible state, security properties, concurrency,
or interfaces spanning multiple adapters, so file count alone is not a safe routing signal.
