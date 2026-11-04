# Polls and anonymous bottles

Task baseline: `5a7f11e`. Feature ownership: `src/shared/social.ts`, `src/server/routes/social.ts`, and `src/client/features/social/`.

## Persistence and access

Polls use text messages with a validated `kind: poll` payload. Existing message history, favorites and single-message pins retain that payload. Vote records use the existing settings store (`poll-vote:<message>:<account>`); upsert gives each account one replaceable vote. Only aggregated counts and the viewer's selection leave the server. Socket invalidations trigger fresh reads; server session readiness, reconnection and document visibility restore missed state. Bottle consumption events contain the removed UUID only: clients remove it immediately and reject in-flight list snapshots from an earlier invalidation revision.

Bottles use the existing settings store (`bottle:<channel>:<uuid>`), storing only text and appearance. No sender account or actor is recorded. Lists expose only UUID and appearance. A channel-row transaction lock serializes appearance allocation and consumption across server processes. Up to twelve bottles can accumulate per channel, each with a distinct appearance. Opening consumes the record atomically, so one reader wins; the reader keeps the text only in component memory until closing. A lost response after consumption cannot be recovered.

Every read checks channel access; creating, voting and opening also check channel write permission. Malformed values, duplicate poll options, excessive text, missing messages and already-consumed bottles fail explicitly. No schema change or new dependency is required.

## Client lifecycle

The composer menu opens dedicated poll and bottle dialogs. Poll cards are shared by the timeline, favorites and pinned viewer. BottleShore uses Matter.js with sleeping bodies, collision walls and resize handling. A reading event reuses the score-view message exit classes; closing restores the messages.

Motion and orientation permission requests start synchronously from the first bottle submit gesture or the explicit enable button; denial does not block submitting a letter. Unsupported or denied sensors leave normal gravity and collisions intact. Sensors detach and frames pause while hidden, offscreen, reading or on page exit. Unmount disconnects observers, socket listeners and physics resources. Closing the dialog or changing channels clears the letter. Deferred Teleports place social dialogs directly under the themed application shell, outside the chat pane's containing block and stacking context, so Bible split view cannot clip or cover them.

## Validation

Required: `verify:full`, focused route regressions, and isolated `social.spec.ts` browser tests against `tm3_e2e`. Browser coverage includes 1280px and 360px Chromium, 390px WebKit, history reload, realtime vote invalidation, pinned voting cards, anonymous letter closing and concurrent consumption. Physical phone motion and OS permission prompts require real-device verification.

Bottle regressions: `bottles.spec.ts` covers four-bottle reload/settling, split-window hit testing, granted/denied sensor gestures, first-session readiness and immediate removal during a deliberately stale list request from another reader.
