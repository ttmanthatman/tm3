# Polls and anonymous bottles

Task baseline: `5a7f11e`. Feature ownership: `src/shared/social.ts`, `src/server/routes/social.ts`, and `src/client/features/social/`.

## Persistence and access

Polls use text messages with a validated `kind: poll` payload. Existing message history, favorites and single-message pins retain that payload. Vote records use the existing settings store (`poll-vote:<message>:<account>`); upsert gives each account one replaceable vote. Only aggregated counts and the viewer's selection leave the server. Socket invalidations trigger fresh reads; server session readiness, reconnection and document visibility restore missed state. Bottle consumption events contain the removed UUID only: clients remove it immediately and reject in-flight list snapshots from an earlier invalidation revision.

Bottles use the existing settings store (`bottle:<channel>:<uuid>`), storing only text and appearance for ordinary channel reads. Separate `bottle-log:<uuid>` settings retain the sender account, text, channel and send time; opening atomically adds the winning reader and pickup time. The administrator-only `/api/admin/bottle-logs` endpoint returns up to 300 records by default (500 maximum), ordered by latest send/pickup time, for the `/log` bottle tab. Historical bottles have unknown senders; opening one begins its audit record. Existing consumed bottles cannot be recovered. Lists expose only UUID and appearance. A channel-row transaction lock serializes appearance allocation and consumption across server processes. Up to twelve bottles can accumulate per channel, each with a distinct appearance. Opening consumes the active bottle record atomically, so one reader wins; the reader keeps the text only in component memory until closing. A lost response after consumption cannot be recovered.

Every read checks channel access; creating, voting and opening also check channel write permission. Malformed values, duplicate poll options, excessive text, missing messages and already-consumed bottles fail explicitly. No schema change or new dependency is required.

## Client lifecycle

The composer menu opens dedicated poll and bottle dialogs. Poll cards are shared by the timeline, favorites and pinned viewer. BottleShore uses Matter.js with sleeping bodies, collision walls and resize handling. A reading event reuses the score-view message exit classes; closing restores the messages.

Motion and orientation automatically enable when bottles are present. Browsers requiring permission defer that request until the next trusted click or keyboard gesture; throwing a bottle also starts both requests synchronously within the submit gesture. Denial or an explicit disable suppresses further automatic attempts for the page session. Every user can retry authorization or disable sensing under Settings → Sensors; no floating permission controls appear over the chat. Unsupported or denied sensors leave normal gravity and collisions intact. Sensors detach and frames pause while hidden, offscreen, reading or on page exit. Unmount disconnects observers, socket listeners and physics resources.

Letters use the scripture card's paper texture with a rolled edge and the corresponding bottle and detached cork at the top left. A deferred Teleport places this nonmodal reading region inside the chat viewport, beside the Bible split view. Long text scrolls within the paper while close controls remain visible. Closing, Escape or changing channels clears the letter and restores messages. Poll/bottle creation dialogs remain directly under the themed application shell.

## Validation

Required: `verify:full`, focused route regressions, and isolated `social.spec.ts` browser tests against `tm3_e2e`. Browser coverage includes 1280px and 360px Chromium, 390px WebKit, history reload, realtime vote invalidation, pinned voting cards, anonymous letter closing and concurrent consumption. Physical phone motion and OS permission prompts require real-device verification.

Bottle regressions: `bottles.spec.ts` covers four-bottle reload/settling, split-window hit testing, mobile long-letter scrolling, ordinary-user sensor settings, granted/denied sensor gestures, first-session readiness and immediate removal during a deliberately stale list request from another reader. The sensor unit regression covers deferred gesture requests, rejection, manual retries and explicit disable.

Administrator log regressions: `bottle-logs.spec.ts` covers sender/reader linkage, ordinary-member and unauthenticated denial, consumed-bottle retention, literal text rendering, refresh and 1280/360/390px layouts.
