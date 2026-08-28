# Development Index

This index is the first file to read before changing Team Chat. It is intentionally short and public-safe: do not add deployment hosts, private domains, `.env` values, database snapshots, or local machine notes here.

## Codex Guidance

- The root `AGENTS.md` is the Codex entry point and contains repository-wide behavior rules.
- `AGENTS.local.md` is only for private, machine-local instructions and must never be committed.
- A nested `AGENTS.md` applies to work inside its directory and supplements the root rules.
- Keep detailed module knowledge in this development index instead of expanding agent guidance into a second handbook.

## Start Every Work Session

1. Run `git status --short`, `git branch --show-current`, and `git log --oneline -n 20`.
2. Identify existing worktree changes before editing. Do not overwrite changes you did not make.
3. For UI or workflow changes, inspect the relevant changelog entries first; repeated regressions usually show up there.
4. Before release or push, run `npm run verify:full`.
5. Review `git diff` locally before deployment or publishing.

## Continuous Integration

The `.github/workflows/ci.yml` workflow runs for pull requests, pushes to `main`, and manual dispatches. Its `verify` job uses Node.js 22, installs the lockfile with `npm ci` and the setup-node npm cache, generates the Prisma client, then runs `npm run verify:full`.

Full verification checks the public repository tree, type-checks the Vue client and TypeScript server, runs every classified test file once, and builds the client and server. These checks do not require a database service or repository secrets, and the workflow does not deploy, migrate data, publish releases, or push changes.

After `verify` succeeds, the independent migration job starts a disposable MySQL service with only the `tm3_migration_verify` database. It applies the committed migration history, checks `prisma migrate status`, confirms that the migrated database has no schema diff, and requires a fully applied migration history starting with the `0_init` baseline. It uses fixed CI-only credentials and never reads deployment secrets or connects to a retained database.

After `verify` succeeds, the independent `e2e` job starts a disposable MySQL service, installs Chromium, resets and seeds the dedicated `tm3_e2e` database, and runs the seven critical Playwright browser flows. The Playwright web servers are process-managed and shut down with the test runner. Screenshots, traces, videos, and the HTML report are retained only when the job fails; local artifacts live under ignored `output/e2e/`.

During local iteration, `npm run verify:changed` inspects the working tree against `HEAD`, reports changed files, mapped domains, and selected commands, then runs only the conservative checks required by those domains. Use `npm run verify:changed -- --base origin/main` to include all branch changes against another baseline. Client, server, shared, Prisma, Service Worker, scripts, documentation/release, and GitHub workflow changes have explicit mappings; dependency, lockfile, TypeScript, build, workflow, and unknown critical changes fall back to `verify:full`. Untracked files are included. CI and final pre-commit validation must continue to use `verify:full`.

## Database Migrations

- `prisma/migrations/0_init/migration.sql` is the immutable initial migration for the complete current MySQL schema.
- Change `prisma/schema.prisma` and create the matching migration together with `npx prisma migrate dev --name <change-name>` against a disposable development database.
- Do not modify or delete a committed `migration.sql`. Follow-up corrections require a new migration.
- Long-lived test and production environments use `npm run prisma:migrate` (`prisma migrate deploy`). `prisma db push` is not an update mechanism for retained data.
- A pre-existing database may join the migration history with `npx prisma migrate resolve --applied 0_init` only after a verified backup and a no-difference `prisma migrate diff` against the baseline schema.
- `scripts/verify-prisma-migrations.sh` refuses non-local hosts and any database name other than `tm3_migration_verify`. Set `MIGRATION_VERIFY_RUN=1` and point `DATABASE_URL` at a fresh local database before running `npm run test:migrations`.
- The destructive `db push --force-reset` path in `e2e/prepare.ts` remains limited to the guarded, disposable local `tm3_e2e` database and must never be reused for retained environments.

## Frequent Regression Areas

- Mobile layout and safe areas: headers, composers, side panels, long admin/settings modals, iOS viewport height, and outside-click closing.
- Gesture state: horizontal panel swipes must not trigger from short flicks, diagonal scrolls, pointer cancel events, or edge resistance.
- Channel navigation: normal channels, AI lounge, direct chats, prayer subviews, Why returns, mention jumps, and saved read positions must stay in sync.
- Admin data tools: long attachment lists and destructive actions need constrained scrolling, visible close controls, and clear disabled states.
- AI and virtual roles: admin settings, role enablement, duplicated role lists, and prompt/API-key state are easy to desynchronize.
- Message rendering: Markdown, sanitized HTML, Bible references, link previews, quoted previews, and notification text all need separate checks.
- Attachments and media: upload, preview, download fallback, admin preview URLs, compression, deletion, and pinned references share file assumptions.
- Version/update flow: `package.json`, `package-lock.json`, `src/shared/release.ts`, `CHANGELOG.md`, service worker cache, and self-update scripts must agree.

## Module Map

- `src/client/App.vue`: current UI shell. It still owns many interfaces: auth, chat, Why, admin, settings, modals, composer, effects, and release UI.
- `src/client/features/music/useMusicPlayer.ts`: music playback queue, current track, playback mode, audio element, progress restoration/reporting, Media Session, account-scoped playback persistence, and playback timer lifecycle.
- `src/client/features/music/MusicManager.vue` and `useMusicLibrary.ts`: the unified music manager (tracks, lyrics/score binding, resource pool, playlists). Rendered as an overlay from the player bar and embedded full-page in the music channel; `App.vue` only mounts it and owns the underlying track/playlist collections.
- `src/client/features/audio/exclusiveAudio.ts`: global exclusive-audio coordinator. Participants (music, friend programs, voice messages) register suspend/resume hooks; the user's latest playback choice ducks the others, and a naturally-ended player fades the most recently ducked participant back in.
- `src/client/features/friend/useFriendPlayer.ts`, `FriendPrograms.vue`, and `FriendProgramList.vue`: the “友” (Liangyou) program modal (today/more/history tabs, category series, episode lists) and its playback composable (own audio element, fade in/out, proxied stream URLs, random autoplay on open that is never written to history, per-account progress resume, periodic progress reporting for user-initiated plays, listening-presence callbacks).
- `src/client/messageSending.ts`: connection-aware text-message delivery, single in-flight send locking, Socket ACK timeout handling, and draft-preservation outcomes.
- `src/client/store.ts`: Pinia store for account, channels, message windows, sockets, members, pinned state, and message cache. `bootstrap()` waits only for the identity phase (appearance ∥ `auth/me`) so the start shell hides after one round trip and cached messages render immediately; channel data (like-notifications/channels, then messages/members) revalidates in the background and is awaited through `whenChannelsReady()` only by flows that need the channel list (deep links). Unread seeding runs in the background.
- `src/client/messageWindowCache.ts`: per-account localStorage persistence of newest-anchored message windows (latest 80 messages per channel view, LRU 8 keys, ~2MB budget, throttled writes flushed on `pagehide`). The store hydrates the current channel's window synchronously at creation so cold starts render cached latest messages before network revalidation; logout clears it.
- `src/client/unread.ts`: per-account unread badge transitions and local offline fallback (`team-chat-unread-{accountId}`). The store merges local positions into the server-backed account state, persists reads through `/api/channels/:id/read`, and receives sibling-device updates over `channel:read`.
- `src/client/styles.css`: global layout and responsive CSS. Check mobile media rules when changing modals, panels, composer, or admin rows.
- `src/client/api.ts`: auth token storage and fetch wrapper.
- `src/shared/release.ts`: in-app version number, current notes, and release history.
- `src/shared/types.ts`: DTO interfaces shared by client and server.
- `src/server/main.ts`: server process entry point for runtime configuration, listening, signals, and graceful shutdown.
- `src/server/index.ts`: Fastify application construction, auth, channels, messages, admin endpoints, update endpoints, and attachment endpoints. `/api/channels` uses a batched list path (one channel query with includes plus grouped lastMessage/prayer counts and a single membership lookup; per-channel `channelDto` remains for single-channel mutations). `/api/messages` prefetches per-type relations into a `MessageSerializeBatch` (voice listens, audio scores/lyrics attached onto rows, prayer sources/actions/AI suggestions, shared playlists) so page serialization is constant-query; `serializeMessage` without a batch keeps the per-message lookups used by socket emits and single-message routes.
- `src/server/routes/adminAccounts.ts`: authenticated administrator account listing, creation, update, deletion, and avatar route registration.
- `src/server/routes/music.ts`: authenticated music library, personal playlist, playback state, lyrics, score, stream, and asset-management HTTP route registration.
- `src/server/routes/unreadCounts.ts`: account-level read-position persistence plus batched unread counts. `/api/messages/unread-counts` merges validated local migration hints with monotonic server positions across visible channels; `/api/channels/:id/read` advances one position and broadcasts it to the account's connected devices.
- `src/server/routes/wechatRelay.ts`, `src/shared/wechatRelayNotifications.ts`, and `src/client/features/admin/WeChatRelayPanel.vue`: administrator-managed NAS WeChat relay control plane. The server persists the selected source channel, target label, safe start cursor, one pending bind/test action, one-way device credential, one-to-one chat-account/WeChat-member mappings, a system prefix, and independently configurable templates for messages, mentions, attachments, chains, pins, releases, and other system events in the generic settings table. Template variables may opt into bounded message summaries, attachment metadata, channel/group names, mapped members, IDs, and timestamps; defaults remain short reminders. The device uses a dedicated bearer token for outbound polling, inserts mapped mentions through the visible official-client member picker with fail-closed screenshot checks, and reports only heartbeat, queue, binding, action, and error status. Version and pin changes are observed as managed snapshots and enter the local durable queue only after the initial baseline. An optional credential-free `WECHAT_RELAY_NAS_ACCESS_URL` is exposed only in the administrator response so the panel can open the existing VM console and remind the operator to keep the responsible official-WeChat account logged in.
- `src/server/routes/reception.ts` and `src/server/receptionInvites.ts`: temporary reception-room creation, owner controls, guest entry, and opaque encrypted invitation links. Invitation tokens are bound to the room's current code hash and expiry; changing the code, shortening the deadline, collecting the room, or reaching the encoded deadline invalidates them. `RECEPTION_INVITE_ORIGIN` may point generated links at an HTTPS short domain that preserves `/visit/:token` while forwarding to this app.
- `src/server/friendFeed.ts` and `src/server/routes/friend.ts`: the “友” program feed. The service fetches the upstream Liangyou JSON API (`FRIEND_API_BASE`, default `https://x.lydt.work/api`) for today's programs, series categories, and per-series episode lists. Lists stay cached until the next local 7:00/19:00 boundary, and a self-rescheduling server timer force-refreshes them at those times; there is intentionally no manual refresh. Upstream media hosts are allowlisted and streamed through `/api/friend/media`; fully played media files are cached on disk under `storage/friend-cache/` with a size-capped oldest-first eviction. `/api/friend/history` and `PUT /api/friend/playback/:programId` persist per-account listening history and progress in the `FriendPlayback` table, and the `friend:listening`/`friend:listeners` socket pair mirrors the music-listener presence so friend listening appears in the chat activity ticker.
- `src/server/services/accountDeletion.ts`: transactional account deletion rules that preserve historic Actors and return post-commit session/channel effects.
- `src/server/services/musicService.ts`: shared music-track serialization, playlist aggregation and access, music-role lookup, and playback-state response mapping used by HTTP routes and message serialization.
- `src/server/linkPreview.ts`: safe link preview fetcher. Keep URL normalization, DNS/private-address blocking, redirect limits, response byte limits, and HTML metadata extraction behind this interface.
- `src/server/zipArchive.ts`: dependency-free ZIP writer (stored entries) and reader (stored + deflate) with entry-count and total-size caps. The admin chat/user exports are ZIP packages (`chat.json` + `uploads/`, `users.json` + `avatars/`); imports accept either those ZIPs or the legacy plain JSON exports and restore bundled files into the storage directories.
- `src/server/multichar/`: autonomous virtual-role engine modules.
- `src/server/demo/` and `src/server/routes/demoMode.ts`: opt-in demo manifest validation, download/cache, destructive reset service, and admin-only routes. See [demo mode maintenance](demo-mode.md) before changing bundle compatibility or reset behavior.
- `src/client/features/admin/DemoModePanel.vue`: asynchronously loaded administrator surface for checking and resetting demo data; it must remain absent from ordinary startup requests.
- `src/scripts/export-demo-snapshot.ts` and `configure-demo-mode.ts`: demo bundle export plus the server-side enable/disable commands.
- `src/server/bible/` and `src/client/bibleReferences.ts`: Bible lookup and reference parsing.
- `src/server/sermon/` and `src/server/routes/sermon.ts`: sermon verse presentation. The server holds one authoritative in-memory `SermonStateDTO` (including the audience-wide `fontScale`) persisted to the `sermon.presentation` setting row; presenter-gated `sermon:*` socket events (queue mutations, annotations, `sermon:font-scale`) mutate it and broadcast `sermon:state`. A snapshot is sent to a new connection while active, and also to a reconnecting presenter (permission-checked) when an inactive queue exists so the presenter workspace keeps its queue. `/api/sermon/presenter-status` reports the per-account presenter grant (`Account.sermonPresenterUntil`, admins always allowed), and `/api/messages/:id/sermon-request/decide` lets administrators approve or reject `sermon_request` message cards.
- `src/client/features/sermon/`: client side of sermon verse presentation. `useSermon.ts` owns the shared sermon state (fed by `sermon:state`/`sermon:request:decided` subscriptions in `store.ts`'s `connectSocket()`; the full state is kept so the presenter workspace can show an inactive queue, while `SermonOverlay` mounts only when `state.active`) and the connection-aware ACK-timeout emit wrapper; `sermonText.ts` splits verse text into annotation segments by plain-text offsets. `SermonStage.vue` is the shared scripture stage (reference badge, presenter credit, annotation segments, `fontScale`) used by both the audience overlay and the presenter presentation view so both ends stay identical. `SermonOverlay.vue` (audience, mounted only while active, minimizable to a corner bar), `SermonWorkspace.vue` (presenter minus-one screen with queue view and WYSIWYG presentation view, opened from the composer “more” drawer when `canPresent`), and `SermonRequestCard.vue` (rendered for `sermon_request` messages, admin approve/reject) are all `defineAsyncComponent` chunks so inactive users never download sermon code.
- `src/scripts/check-public-tree.ts`: public-tree safety check used before push/publish. Add project-specific forbidden content through `PUBLIC_SAFETY_FORBIDDEN_PATTERNS`, not by committing private names.
- `src/scripts/verify-changed.ts`: local changed-file verification planner. It maps Git changes to focused checks and conservatively falls back to full verification when scope is uncertain.
- `src/scripts/wechat-relay/` and `scripts/wechat-relay/`: optional NAS relay core, SQLite outbox, Team Chat source adapter, fail-closed X11 official-WeChat driver, tests, Linux deployment templates, and a localhost-only desktop setup page. The setup flow validates an administrator-generated device token before a narrowly scoped privileged helper atomically updates `/etc/wechat-relay.env`, assigns a site-specific queue path, and restarts the service; the token travels over standard input rather than process arguments. The X11 driver separately calibrates the fixed target-group anchor and the member-picker region used for mapped `@` mentions; any ambiguous visual state stops delivery. Runtime credentials, target-group anchors, queue data, and machine-specific calibration values must remain outside the repository.
- `e2e/` and `playwright.config.ts`: isolated MySQL reset/seed, local Docker service, and the small critical browser smoke suite. Run with `npm run test:e2e:local`, or provide a local `E2E_DATABASE_URL` for a database named exactly `tm3_e2e`.
- `e2e-remote/`, `playwright.remote.config.ts`, and `scripts/run-e2e-remote.sh`: a separate, non-destructive test-station smoke runner. It requires ignored local credentials, accepts only the dedicated test hostname/account/channel, blocks every other browser origin, and never invokes reset, seed, Prisma cleanup, or direct database writes.
- `prisma/schema.prisma` and `prisma/migrations/`: the current database model and its immutable, ordered migration history.
- `scripts/verify-prisma-migrations.sh`: guarded empty-database apply, status, schema-diff, and migration-history verification for local work and CI.
- `public/sw.js`: service worker cache versioning.

## Music Player State Ownership

- Track and playlist data: `App.vue` still loads and mutates the library and playlists; the composable consumes those collections as its playback queue inputs.
- Current playback source, track, progress, mode, random history, Media Session, server playback/progress synchronization, playback timers, page-exit persistence, and the audio element lifecycle belong to `useMusicPlayer`.
- Favorite filtering is split deliberately: the composable owns the account-scoped “only favorites” playback constraint, while `App.vue` keeps favorite mutation and its UI.
- Lyrics and score viewing (lyrics header, score stage/preview, per-track score selection via `currentMusicScoreId`) with their UI timers stay in `App.vue`; track/playlist/resource management UI lives in `features/music/MusicManager.vue`.
- Music listener presence remains with the shared music/Bible socket heartbeat in `App.vue`; separating that combined activity lifecycle is also second-phase work.

## UI Change Checklist

- Mobile widths: check 360px and 390px. Desktop: check at least 1280px.
- Every full-screen modal uses `.modal-shell` and closes on outside click with `@click.self`.
- Long modal content scrolls inside `.admin-body`, `.modal-form`, or an equivalent inner body, not behind the header.
- Header, composer, and side drawers keep stable dimensions; text must not overlap or overflow buttons.
- Gestures should require a clear horizontal axis and sufficient distance. Do not add speed-only panel switching.
- Avoid animating the same element with both inline `transform` and CSS keyframes.

## Design QA Checklist

- Compare the source reference and browser-rendered result at the same viewport. Review both the full view and dense regions where controls can overflow or primary actions can be clipped.
- Check typography, spacing, colors, asset fidelity, copy, and responsive behavior separately instead of relying on a general visual impression.
- Exercise changed interactions end to end, including state synchronization after programmatic navigation and server-side protection for destructive actions.
- Check browser warnings and errors, then re-run the affected flow after each fix and record the original finding plus the post-fix evidence.
- Keep reusable conclusions in tracked documentation. Keep temporary reports, screenshots, browser traces, and machine-specific paths in ignored local artifact directories.

## Effect Rendering Economy Checklist

Complete this checklist whenever a message effect, ambient animation, lyric display, canvas, or physics interaction is added or changed.

- Define the effect lifecycle explicitly: active, paused, and torn down. Pause it when the document is hidden or the stable message row leaves the viewport; stop it on `pagehide` and component unmount.
- Observe a stable wrapper such as `.message-row`, never the animated or transformed child whose own movement can cross an intersection threshold.
- Virtualized or offscreen messages must not retain active DOM animation, `requestAnimationFrame`, timers, observers, or physics bodies. Effects in other channels and direct chats must remain inactive until that view is current.
- Start global one-shot effects only for the current visible chat view. Start canvas or physics loops only while visible participants exist, then cancel the frame and release transient state when none remain.
- A cyclic movement must travel fully outside the visual region before it resets. Test both directions at 360px and 390px mobile widths and at least 1280px desktop width.
- Prefer compositor-friendly `transform` and `opacity`; avoid layout-changing animation. Pausing or resuming pseudo-elements must not change message height, scroll height, or reading position.
- Add a regression test for lifecycle and loop boundaries. For higher-risk effects, sample DOM count, `scrollHeight`, `scrollTop`, animation frames, and CPU activity in a real browser while visible, offscreen, hidden, and paused.

## Release Checklist

- Feature pull requests add user-visible notes only to `CHANGELOG.md` under `## Unreleased`; they do not change release versions or dates.
- Refresh demo data only when a release changes a showcase feature or bundle compatibility; follow the short trigger table in [demo mode maintenance](demo-mode.md). Ordinary fixes and refactors require no demo work.
- Run `npm run check:release` to verify package metadata, shared release metadata, the latest formal changelog entry, the README badge, the license, and the shared Service Worker cache-version source.
- Preview a release with `npm run release:prepare -- <version> --dry-run`.
- From a clean worktree, run `npm run release:prepare -- <version>` to update the package files through npm, archive `Unreleased` under the new version and date, update `APP_VERSION`, `RELEASE_DATE`, `RELEASE_NOTES`, and `RELEASE_HISTORY`, and run the consistency check.
- The preparation command does not commit, tag, push, deploy, publish, or create a GitHub Release.
- Confirm settings/admin release pages still display the current version and notes.
- Keep `license` as `GPL-3.0-only`.

## Publish Safety

Before pushing a public branch, verify the tree does not include `AGENTS.local.md`, `.env`, runtime data, private deployment notes, server addresses, private domains, or private organization names. Public-safe `AGENTS.md` files are allowed. Runtime data belongs outside the repo or in ignored folders.

Useful checks:

```bash
git ls-files AGENTS.local.md .env storage node_modules
npm run verify:full
```

The canonical test entry point is `npm run test:all`. It classifies every `src/**/*.test.ts` and `src/**/*.spec.ts` file into client, server, shared, scripts, or service-worker coverage, rejects overlaps and omissions, and executes each file once. Use `npm run check:test-files` to print and validate that mapping without running tests. Focused commands are `test:client`, `test:server`, `test:shared`, `test:scripts`, and `test:service-worker`; `test:ui-logic` and `test:security` remain compatibility aliases.

Also run a local grep for any project-specific private hostnames, addresses, organization names, or deployment paths. Keep those patterns in your local shell history or notes, not in this public file.

## Next Deepening Opportunities

- Extract a modal shell module so outside-click closing, safe-area sizing, and scroll containment have one interface.
- Extract channel navigation into a client module so panel state, channel switching, prayer subviews, Why returns, and read-position persistence share one seam.
- Split admin data tools out of `App.vue` after the modal shell exists; attachment management and data import/export are currently too far from their checks.
