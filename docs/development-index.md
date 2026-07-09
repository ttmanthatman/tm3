# Development Index

This index is the first file to read before changing Team Chat. It is intentionally short and public-safe: do not add deployment hosts, private domains, `.env` values, database snapshots, or local machine notes here.

## Start Every Work Session

1. Run `git status --short`, `git branch --show-current`, and `git log --oneline -n 20`.
2. Identify existing worktree changes before editing. Do not overwrite changes you did not make.
3. For UI or workflow changes, inspect the relevant changelog entries first; repeated regressions usually show up there.
4. Before release or push, run at least `npm run check:quick`, `npm run test:ui-logic`, and `npm run build`.
5. Review `git diff` locally before deployment or publishing.

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
- `src/client/store.ts`: Pinia store for account, channels, message windows, sockets, members, pinned state, and message cache.
- `src/client/styles.css`: global layout and responsive CSS. Check mobile media rules when changing modals, panels, composer, or admin rows.
- `src/client/api.ts`: auth token storage and fetch wrapper.
- `src/shared/release.ts`: in-app version number, current notes, and release history.
- `src/shared/types.ts`: DTO interfaces shared by client and server.
- `src/server/index.ts`: main Fastify app, auth, channels, messages, admin endpoints, update endpoints, and attachment endpoints.
- `src/server/linkPreview.ts`: safe link preview fetcher. Keep URL normalization, DNS/private-address blocking, redirect limits, response byte limits, and HTML metadata extraction behind this interface.
- `src/server/multichar/`: autonomous virtual-role engine modules.
- `src/server/bible/` and `src/client/bibleReferences.ts`: Bible lookup and reference parsing.
- `src/scripts/check-public-tree.ts`: public-tree safety check used before push/publish. Add project-specific forbidden content through `PUBLIC_SAFETY_FORBIDDEN_PATTERNS`, not by committing private names.
- `prisma/schema.prisma`: database schema and channel/message/pinned/AI data model.
- `public/sw.js`: service worker cache versioning.

## UI Change Checklist

- Mobile widths: check 360px and 390px. Desktop: check at least 1280px.
- Every full-screen modal uses `.modal-shell` and closes on outside click with `@click.self`.
- Long modal content scrolls inside `.admin-body`, `.modal-form`, or an equivalent inner body, not behind the header.
- Header, composer, and side drawers keep stable dimensions; text must not overlap or overflow buttons.
- Gestures should require a clear horizontal axis and sufficient distance. Do not add speed-only panel switching.
- Avoid animating the same element with both inline `transform` and CSS keyframes.

## Release Checklist

- Bump `package.json` and `package-lock.json` together.
- Update `APP_VERSION`, `RELEASE_NOTES`, and `RELEASE_HISTORY` in `src/shared/release.ts`.
- Add the same user-facing notes to the top of `CHANGELOG.md`.
- Confirm settings/admin release pages still display the current version and notes.
- Keep `license` as `GPL-3.0-only`.

## Publish Safety

Before pushing a public branch, verify the tree does not include `AGENTS.md`, `.env`, runtime data, private deployment notes, server addresses, private domains, or private organization names. Runtime data belongs outside the repo or in ignored folders.

Useful checks:

```bash
git ls-files AGENTS.md .env storage node_modules
npm run check:public-tree
npm run test:ui-logic
npm run check
npm run build
```

Also run a local grep for any project-specific private hostnames, addresses, organization names, or deployment paths. Keep those patterns in your local shell history or notes, not in this public file.

## Next Deepening Opportunities

- Extract a modal shell module so outside-click closing, safe-area sizing, and scroll containment have one interface.
- Extract channel navigation into a client module so panel state, channel switching, prayer subviews, Why returns, and read-position persistence share one seam.
- Split admin data tools out of `App.vue` after the modal shell exists; attachment management and data import/export are currently too far from their checks.
