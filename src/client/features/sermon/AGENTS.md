# Sermon Client Guidance

Applies to `src/client/features/sermon/`. Read the root `AGENTS.md`, `src/client/AGENTS.md`,
and the sermon entries in `docs/development-index.md` first. This file is the symbol map:
use it to jump straight to the owning symbol instead of reading whole files.

## Reading Discipline

- Locate code by the map below, then `Grep` the symbol name and `Read` only that line region.
- Do not read `SermonWorkspace.vue` or `useSermon.ts` end to end; they are large on purpose.
- Prefer symbol-level lookup (`search_graph` / `get_code_snippet`) over broad file scans.
- `src/client/App.vue` only mounts these components; read the specific mount/wiring region there.

## Symbol Map

- `useSermon.ts` — client sermon state core. Module-level `sharedSermonState`
  (`createSermonState`). Pure appliers called by the store on socket events:
  `applySermonState`, `applySermonDirectory`, `applySermonPreview`, `applySermonInvited`,
  `applySermonRemoved`, `applySermonEnded`, `releaseSermonAudienceSeat`, `resetSermonState`.
  Presenter muting persisted per account: `loadSermonMutedIds`, `muteSermonPresenter`.
  HTTP directory fallback: `refreshSermonDirectory`. `useSermon()` wraps socket emits
  with ACK timeouts and owns directory, invitations, audience seat, saved plans, notices.
- `SermonWorkspace.vue` (1005 lines) — presenter workspace. Script lines 1–555, template
  556–835, styles from 836. Key regions: input/parse (`refreshParse`, `addToQueue`,
  `handleInputKeydown`), scripture lookup (`lookupReference`, `refDetails`), plan
  save/load (`saveNewPlan`, `overwritePlan`, `loadSavedPlan`, `deleteSavedPlan`),
  presentation control (`enterPresent`, `presentRelative`, `updateDisplay`,
  `endPresentation`, `flushPendingScroll`, `requestScroll`), hot editing (`openEditor`,
  `saveEdit`, `rebuildSource`), annotations (`toggleVerseAnnotation`, `annotateSelection`),
  preview scaling (`updatePreviewScales`, `reconnectPreviewObserver`).
- `SermonStage.vue` — read-only stage preview shared by hub cards and workspace previews.
- `SermonHub.vue` + `sermonHub.ts` — live cards/banner logic (pure helpers in `.ts`).
- `SermonOverlay.vue` + `SermonFloatingButton.vue` + `sermonFloating.ts` — fullscreen
  viewing and the minimized floating button.
- `SermonEntryDialog.vue` — the only composer-tool entry; owns workspace/audience switching.
- `SermonDisplayControls.vue` — display settings UI. `SermonRequestCard.vue` — admin approval.
- Pure helpers, each with a same-named `.test.ts`: `sermonInput.ts` (content parsing),
  `sermonText.ts`, `sermonDisplay.ts`, `sermonThemes.ts`, `sermonScroll.ts`,
  `sermonPreview.ts`.

## Invariants

- `ownedState` and `watchedState` stay separate: opening the workspace must never expose
  another presenter's queue as editable.
- `SermonEntryDialog.vue` is the only entry; leaving an audience seat happens there.
- All previews render through `SermonStage.vue`; do not fork a second preview component.
- Server join/permission checks remain authoritative; client hiding is not a permission.

## Targeted Checks

- Client sermon tests: `node --import tsx --test src/client/features/sermon/*.test.ts`
- Full client group when behavior is shared: `npm run test:client`
- Types: `npm run check`; iteration planner: `npm run verify:changed`
- Final handoff/CI stays `npm run verify:full`.
