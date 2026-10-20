# Repository Agent Guidance

This file is the shared, public-safe entry point for Codex, Zcode, and other agents working in this repository. Nested `AGENTS.md` rules also apply within their directories.

## Start Every Session

1. Run `git status --short` and `git log --oneline -n 5`; remember the task's starting SHA.
2. Preserve existing work. Continue when unrelated changes have a clear boundary; stop for unexplained overlap. Never overwrite, revert, stage, or remove the user's changes.
3. Read applicable nested `AGENTS.md` and ignored `AGENTS.local.md` before editing. Never commit local guidance.
4. For a fresh cross-device task, run `npm run dev:sync` before editing a clean checkout with an upstream. It fetches and fast-forwards only; on refusal, preserve local work and inspect `npm run dev:status`. Re-read changed guidance after updating. Continuing local work needs no automatic update.

Load references only when needed; use heading searches and read the relevant section:

| Need | Reference |
| --- | --- |
| Module ownership or a triggered checklist | [development-index.md](docs/development-index.md) |
| Validation selection, staging or cross-device handoff | [development-workflow.md](docs/development-workflow.md) |
| Task sizing, delegation or escalation | [model-task-routing.md](docs/model-task-routing.md) |

## Work and Token Budget

- The user describes the result; the agent owns discovery, implementation and validation. State the intended effect briefly, then act. Ask only about material product ambiguity or missing authorization.
- Keep one task within one domain; make the smallest coherent change and preserve behavior outside the request. Avoid unrelated cleanup and speculative abstraction. Change schema only when explicitly required; add no dependency when existing facilities suffice.
- Ordinary single-session work needs no task card, design proposal or separate reviewer. Use one agent by default; delegate only substantial independent work when useful and authorized. One active owner per task; independent parallel tasks use separate branches/checkouts and explicit file boundaries. Shared-file edits serialize.
- Reuse findings and successful checks for small follow-ups while code, dependencies and environment remain unchanged. Handoffs carry goal, baseline, relevant symbols/files, decisions, checks and next step; link evidence instead of copying history.
- Start code discovery with codebase-memory MCP, including known code paths. The installed `codebase-memory` skill owns lookup, freshness and coverage rules; reuse SessionStart project context without adding a second startup/indexing pass. Documentation/configuration use text search.
- Trace callers/consumers before changing shared helpers or contracts; inspect nearby tests and conventions. Do not re-read unchanged files or dump whole files, module maps, diffs or logs into context.
- Batch independent lookups and bound output. Preview checks with `npm run verify:changed -- --dry-run --quiet`; store long logs outside the tracked tree and report exit status plus relevant failures.

## Authority and Safety

- Commit only when requested or required by the workflow. Push, merge, deploy, publish, tag and release each require their respective explicit authorization; release preparation does not grant it.
- Do not change versions, `CHANGELOG.md`, release metadata or Service Worker files unless requested. Feature release notes belong only under `## Unreleased`; prepare requested releases with `npm run release:prepare -- <version>`.
- Never commit secrets, environment values, private notes, runtime data or machine-specific details. Keep private guidance in ignored `AGENTS.local.md` and module explanations in the development index.
- Treat destructive data actions, migrations, authentication, authorization and file storage as high risk. Keep authorization checks on the server even when the client hides an action.

## Implementation Boundaries

- `src/client/App.vue` composes the application; new business behavior belongs in focused components, composables or feature modules.
- `src/server/index.ts` is an entry point; add routes through focused route modules. Separate route handling, business rules and data access as touched; keep shared DTOs explicit and compatible.
- Match naming, types, validation, error handling and test conventions. Preserve HTTP status codes and response shapes unless the request changes the contract.
- Never bypass type errors with `any`, swallow exceptions, silently discard failures, weaken/delete tests to pass checks, or disable lint, type, validation or security controls.

## Database Migrations

- Every `prisma/schema.prisma` change requires a new migration created with `prisma migrate dev` against a disposable development database. Never alter committed migrations; `prisma/migrations/0_init` is immutable.
- Use `prisma migrate deploy` for retained test/production databases, never `prisma db push`. Before `prisma migrate resolve --applied 0_init`, prove equality with `prisma migrate diff` and take a verified backup.
- Restrict destructive reset/seed commands to guarded disposable databases. Run migration verification only with `MIGRATION_VERIFY_RUN=1` and a fresh local MySQL database named exactly `tm3_migration_verify`.

## Validation and Delivery

- Choose checks once by risk using the workflow's verification matrix. Run the narrow behavior regression during iteration, then required final checks; do not stack domain suites, `verify:changed` and `verify:full` on unchanged code.
- TypeScript/Vue changes require type checks; client state/layout/interaction requires `test:client`; server/auth/upload/URL changes require `test:server`; migration files/verification scripts require `test:scripts`. Run affected production builds for code changes; pure documentation and isolated static prototypes need none.
- UI changes to login, channel navigation, message persistence, Bible reading or admin accounts require isolated `test:e2e` with `tm3_e2e`. Retained-environment checks use a separate non-destructive runner with an exact approved hostname and ignored local credentials.
- High-risk changes, verification infrastructure, dependency/build/configuration changes, release preparation, push, CI and explicitly full-validation handoffs require one `verify:full` on the final tree. It includes lint, types, all source test groups and builds; E2E/migration checks remain separate. `test:all` runs complete source coverage without duplicate files.
- `verify:changed` selects conservative checks from the Git diff, not business risk. Across commits pass `-- --base <task-start-SHA>`; an empty plan or dry-run is not a pass. Reuse results only for the code, dependencies and environment actually checked.
- Run `check:public-tree` for tracked/publication-safety changes and `git diff --check` before committing. Claim success only for commands that completed successfully.
- Review the complete task diff, then stage explicit task-owned paths only; never `git add -A`. With `verify:changed -- --staged`, include all task files and no unrelated staged content; selection does not isolate execution. Follow requested branch/commit conventions.
- After two unsuccessful fixes for the same failure, stop blind iteration. Leave reviewable work and report failure, likely cause, evidence and concrete next step; do not hide failures with broad rewrites. Final reports contain changed files, test results and remaining risks only.
