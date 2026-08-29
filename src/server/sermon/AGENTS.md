# Sermon Server Guidance

Applies to `src/server/sermon/` and `src/server/routes/sermon.ts`. Read the root
`AGENTS.md`, `src/server/AGENTS.md`, and the sermon entries in `docs/development-index.md`
first. This file is the symbol map: jump to the owning symbol; do not read whole files.

## Reading Discipline

- Locate code by the map below, then `Grep` the symbol name and `Read` only that line region.
- Do not read `state.ts`, `socket.ts`, or `presentations.ts` end to end.
- Prefer symbol-level lookup (`search_graph` / `get_code_snippet`) over broad file scans.

## Symbol Map

- `state.ts` — pure state transitions: `applyAdd`, `applyUpdate`, `applyScroll`,
  `applyAddTexts`, `applyReorder`, `applyRemove`, `applyPresent`, `applyDisplay`,
  `applyAnnotate`, `applyAnnotateClear`, `applyClear`, `applyLoadPlan`, `applySetScope`;
  slide resolution `resolveSermonSlide` / `resolveSermonSlides`; limits and zod schemas
  (`SERMON_QUEUE_LIMIT = 50`, display/font/background constants); persistence
  `serializeSermonState` / `deserializeSermonState` / `createSermonStateStore`.
- `presentations.ts` — business service `createSermonPresentationService`: one concurrent
  presentation per presenter; per-presenter `Setting` key `sermon.presentation.{accountId}`;
  plan keys `sermon.plan.{accountId}.{planId}` (`SERMON_PLAN_LIMIT = 30`,
  `SERMON_PLAN_MAX_BYTES = 60000`); `SermonPresentationError` /
  `SermonSeatConflictError` (public-safe Chinese messages).
- `socket.ts` — socket transport: zod event validation, room `sermon:{presenterAccountId}`,
  full `sermon:state` broadcasts only to the presenter's room, global `sermon:directory`,
  targeted `sermon:preview` / `sermon:invited` / `sermon:removed` / `sermon:ended`.
- `permissions.ts` — presenter-grant check. `routes/sermon.ts` — HTTP directory route;
  group previews are included only for presenter or invitees.

## Invariants

- Server-side join and scope checks are authoritative (`group` invitees only,
  `assembly` requires a fresh presenter grant).
- A presenter has at most one live presentation; audience seat conflicts surface as
  `SermonSeatConflictError` so the client can offer "leave and join".
- Presenter mutations broadcast full state only to the presenter's own room; audience
  sees directory/assembly preview or targeted group preview.
- Plans and queue persist in the generic `Setting` table — no Prisma schema change.

## Targeted Checks

- Server sermon tests: `node --import tsx --test src/server/sermon/*.test.ts`
- Full server group when contracts change: `npm run test:server`
- Types: `npm run check`; iteration planner: `npm run verify:changed`
- Socket authorization or concurrency changes are Sol-routing per `docs/model-task-routing.md`.
- Final handoff/CI stays `npm run verify:full`.
