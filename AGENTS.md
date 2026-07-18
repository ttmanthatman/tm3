# Repository Agent Guidance

This file is the public-safe entry point for agents working in this repository.
It defines behavior and routing rules, not detailed module documentation.
Instructions in a nested `AGENTS.md` also apply within that directory.

## Start Every Session

1. Run `git status --short`.
2. Run `git branch --show-current`.
3. Run `git log --oneline -n 20`.
4. Stop if the worktree contains changes that are not understood.
5. Read `docs/development-index.md` before locating implementation code.
6. Read `docs/model-task-routing.md` and apply its model and escalation rules.
7. Check for a more specific `AGENTS.md` in the target directory.

## Scope Discipline

- Keep one task focused on one domain: client, server, shared contract, tooling, or documentation.
- Do not bundle unrelated cleanup, formatting, or refactors with the requested change.
- Do not overwrite, revert, stage, or remove changes made by the user.
- Preserve existing behavior unless the task explicitly requests a behavior change.
- Do not modify database schema unless the task explicitly requires it.
- Do not add a dependency when an existing project facility is sufficient.
- Keep detailed module explanations in `docs/development-index.md`.
- Keep these instruction files short, actionable, and public-safe.

## Change Authority

- Do not change version numbers, `CHANGELOG.md`, or release metadata unless explicitly requested.
- Feature work adds user-visible release notes only under `## Unreleased`; do not bump versions in feature pull requests.
- Prepare an explicitly requested release with `npm run release:prepare -- <version>` instead of manually editing synchronized version files.
- Release preparation does not authorize commits, tags, pushes, deployments, publishing, or GitHub Releases.
- Do not modify release or service-worker files unless explicitly requested.
- Do not deploy, push, merge, publish, or create a release unless explicitly requested.
- Treat destructive data actions, migrations, authentication, and file storage as high risk.
- Never commit secrets, environment values, private notes, runtime data, or machine-specific details.
- Put private local guidance in ignored `AGENTS.local.md`, never in tracked guidance.

## Discovery Before Editing

- Locate the relevant symbol, route, test, or style rule before opening broad files.
- Prefer repository graph search for symbols, callers, routes, and dependencies.
- Use text search for literals, configuration, documentation, and error messages.
- Read the smallest useful code region around the target symbol.
- Do not read a giant file from beginning to end when symbol-level inspection is possible.
- Trace callers and consumers before changing a shared contract or helper.
- Check nearby tests and established patterns before inventing a new structure.

## Architecture Boundaries

- `src/client/App.vue` is for application composition and top-level coordination.
- Do not add new business logic directly to `src/client/App.vue`.
- Put client behavior in focused components, composables, or feature modules.
- `src/server/index.ts` is an existing entry point, not a destination for new route bodies.
- Do not add new routes directly to `src/server/index.ts` or a future giant app file.
- Register new server routes through focused route modules.
- Separate route handling, business rules, and data access as code is touched.
- Keep shared DTOs and contracts explicit and compatible across client and server.

## Implementation Guardrails

- Make the smallest coherent change that satisfies the task.
- Match existing naming, types, validation, error handling, and test conventions.
- Do not use `any` to bypass type errors.
- Do not swallow exceptions or silently discard failure states.
- Do not delete tests or weaken assertions to make checks pass.
- Do not disable linting, type checking, validation, or security controls.
- Preserve HTTP status codes and response shapes unless the task requires a contract change.
- Keep authorization checks on the server even when the client also hides an action.
- Avoid speculative abstraction; extract only around a demonstrated responsibility.

## Database Migration Discipline

- Every `prisma/schema.prisma` change must include a new migration created with `prisma migrate dev` against a disposable development database.
- Never modify or delete a committed migration. `prisma/migrations/0_init` is the immutable baseline for the current schema.
- Use `prisma migrate deploy` for long-lived test and production databases; never update those databases with `prisma db push`.
- Before baselining an existing database with `prisma migrate resolve --applied 0_init`, prove with `prisma migrate diff` that its structure exactly matches the baseline and take a verified backup.
- Keep destructive reset and seed commands restricted to explicitly guarded disposable test databases.

## Validation

- Run targeted tests for every changed behavior before broad checks.
- Use `npm run verify:changed` during development to select conservative checks from the current Git diff; pass `-- --base <ref>` when comparing with another baseline.
- Prefer the narrowest relevant test command during iteration.
- Run type checks when TypeScript or Vue code changes.
- Run `npm run test:client` when client state, layout logic, or interaction behavior changes.
- Run `npm run test:server` when server, authentication, authorization, upload, or URL handling changes.
- Run `npm run test:scripts` when migration files or migration verification scripts change.
- Run `npm run test:migrations` only with `MIGRATION_VERIFY_RUN=1` and a fresh local MySQL database named exactly `tm3_migration_verify`.
- Run `npm run test:e2e` with the isolated `tm3_e2e` database when UI changes affect login, channel navigation, message persistence, Bible reading, or administrator account workflows.
- Run `npm run test:all` for complete test coverage without duplicate file execution.
- Run `npm run verify:full` before a commit or handoff that requires complete verification.
- Keep CI and final pre-commit verification on `npm run verify:full`; `verify:changed` is only a local iteration shortcut.
- Run a production build when code paths or build configuration change.
- For UI behavior, use the existing isolated local Playwright suite; any retained-environment browser check must be a separate, non-destructive runner with an exact approved hostname and ignored local credentials.
- Run `npm run check:public-tree` for tracked-file or publication-safety changes.
- Run `git diff --check` before committing.
- Do not claim a check passed unless its command completed successfully.

## Review and Git

- Review the complete `git diff` before the final commit.
- Confirm the diff contains only files needed for the current domain.
- Confirm tracked guidance and docs contain no private or machine-specific information.
- Follow the requested branch and commit conventions.
- Create local commits only when the task requests or repository workflow requires them.
- Never push a local commit without explicit permission.

## Failure and Handoff

- After two unsuccessful fix attempts for the same failure, stop iterating.
- Report the observed failure, likely root cause, and evidence gathered.
- Recommend an upgraded model suited to the unresolved work.
- Do not conceal failures with broad rewrites or unrelated changes.
- Leave the worktree in a reviewable state.
- The final report must include only changed files, test results, and remaining risks.
