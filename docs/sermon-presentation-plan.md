# Sermon Presentation Plan

Design decisions for the 讲道台 (sermon pulpit) feature, split into two independent phases.
Decided 2026-08-28 through a grill-me session. Phase 2 is not implemented yet; this document is the contract for both.

## Phase 1 — Typography upgrade (presenter-controlled display settings)

All display settings are **presenter-controlled and broadcast to every viewer** (no per-viewer override). This extends the existing `fontScale` mechanism.

### Server state

`SermonStateDTO` gains a `display` object alongside (and replacing the transport role of) the flat `fontScale`:

- `display.fontScale`: existing 0.7–1.6 semantics, unchanged.
- `display.fontFamily`: one of `puhuiti` (default), `songti` (current serif stack), `system` (system sans).
- `display.marginPct`: horizontal padding as a percentage of viewport width (2–20, slider-mapped). Relative units keep the same setting usable across phones and projectors; the existing `min(880px, 100%)` width cap stays and margins apply on top of it.
- `display.background`: background preset key or custom hex color. The current dark gradient remains the default preset so existing presentations look unchanged.

### Font hosting

- Alibaba PuHuiTi 2.0 is **self-hosted**: subsetted woff2 files under `public/fonts/` (Regular + Medium, ~3.5 MB each), served same-origin with long cache headers. The subset covers the full GBK repertoire plus the Bible corpus (`src/server/bible/cmn-cu89s*.json`) plus sermon UI labels — GBK coverage is required because the queue accepts free-text items, not just Bible passages. Caveats: characters outside GBK (emoji, rare extensions) fall back to the system font per-glyph; U+2D8D (`ⶍ`, used in two CUV verses) has no glyph in PuHuiTi at all and always falls back. Regeneration: pyftsubset with charset = GBK + Bible corpus + UI labels.
- `@font-face` uses `font-display: swap`; while the webfont loads, text falls back to the system sans stack (not Songti) to avoid a jarring serif→sans swap.
- The font CSS is only needed when the sermon overlay/workspace is open; loading must not block first paint of the chat UI.

### Client

- `SermonWorkspace.vue` gains controls for the four settings (font picker, existing fontScale stepper, margin slider, background presets + custom color).
- `SermonStage.vue` applies the settings via CSS variables so the presenter stage and audience overlay stay byte-identical.
- A single `sermon:display` socket event carries the whole `display` object (replacing `sermon:font-scale`); server clamps/validates each field.

### Phase 1 field-test amendments (2026-08-28, implemented)

- **Sync indicator**: the "正在同步…"/error line in the present view floats above the stage (absolute, pointer-events: none) instead of taking layout space and pushing the passage up.
- **Free-text queue items**: `SermonQueueItem` gains `kind: "bible" | "text"`; text items carry optional `title` (≤100) and `content` (≤4000, control characters stripped, blank lines split paragraphs) via a separate `sermon:add-text` event that bypasses Bible lookup. Persisted items without `kind` migrate to `"bible"` on load. Text items render as titled paragraphs; per-verse annotations don't apply (client hides the interaction, server-side validation no-ops). Fonts were regenerated to full GBK to cover arbitrary text.
- **Margin mechanism**: `marginPct` is applied as percentage `padding-inline` on the card's body container (percentages resolve against the card width), not vw padding on the overlay — the slider visibly changes text width on desktop too, past the 880px card cap.
- **Desktop workspace layout (≥1024px)**: two columns — left holds queue + display controls (`SermonDisplayControls.vue`, shared with the mobile present footer), right holds read-only scaled live previews (投影预览 16:9 at 1280×720 base, 手机预览 390×845 base) rendered from the same `SermonStage`. Mobile keeps the queue/present two-screen flow. Note: verse-annotation interaction currently lives in the mobile present view only; the desktop previews are read-only by design.

## Phase 2 — Multiple concurrent presentations with audience mutual exclusion (not implemented)

### Scope and permission

- **Group mode**: any registered user can start a presentation and invite specific accounts. No approval needed. The pulpit entry tile becomes visible to everyone.
- **Assembly mode** (whole 综合频道 / site-wide): requires the existing approval flow (`/申请演讲` → admin approval → `sermonPresenterUntil`). The request card is unchanged; qualified presenters pick the scope when starting a presentation, and the server re-checks the grant when "assembly" is chosen.

### State model

- Presentations are keyed by `presenterId`: one active presentation per presenter, holding their own queue, current item, annotations, and display settings.
- Queue/content/display persist across disconnects and restarts (per-presenter persistence, replacing the single global `Setting` row; existing data migrates to its `presenterId` key).
- Audience membership is **volatile**: disconnect, refresh, or logout means leaving the presentation and releasing the seat. Presenter disconnect does not end the presentation; viewers may keep reading and may leave normally. Admins can force-end any presentation.

### Mutual exclusion

- A single server-side mapping `accountId → presentationId` records which presentation a viewer is currently in. A user occupies a seat only when they actually **join**, not when invited.
- Presenter audience picker lists all registered accounts (online status shown); accounts already watching another presentation are grayed out and unselectable (no stealing).
- Assembly mode's audience is "everyone minus users currently in a group presentation"; those users can join the assembly after leaving their group.
- A viewer joining presentation B while watching A is offered "leave current and join" as one action (self-release, then join).
- The presenter is a member of their own presentation and never occupies an audience seat.

### Viewer flow

- Invitees get a **prominent** notification banner ("X 邀请你观看讲道演示") with Join / Later. "Later" only dismisses the banner; the invitation stays valid while the presentation lives.
- A persistent entry (header icon with badge) lists all watchable ongoing presentations (invited group ones + running assemblies).
- One notification per presentation per user; invitees can mute a specific presentation. No global rate limiting or blocklists for now.
- Presenters can remove viewers; removed viewers get a light toast. Presentation end closes all overlays with a notice.

### Tests to rewrite in phase 2

`src/server/sermon/state.test.ts`, `src/server/sermon/socket.test.ts`, and `e2e/tests/sermon.spec.ts` currently pin the single-global-store semantics; they need new cases for per-presenter keying, mutual exclusion, concurrent presentations, and disconnect seat release.
