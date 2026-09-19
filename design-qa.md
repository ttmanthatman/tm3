# Design QA

## Personal stories — likes and comments

### Evidence and scope

- Source visual truth: user attachment `截屏2026-09-19 16.03.23.png`, 575 × 869 pixels. The requested target is the reaction panel beneath a story, not the source application's surrounding profile/post layout.
- Browser implementation: `output/e2e/stories-social-390.png`, 390 × 844 CSS/pixels at device scale factor 1, plus `stories-social-1280.png` at 1280 × 900.
- Combined evidence: `output/e2e/stories-social-full-comparison.png`; focused equal-width reaction-panel comparison: `output/e2e/stories-social-focus-comparison.png`. Both combined images were opened and inspected after the implementation capture.
- State: two likes and two comments, including the current user's filled-heart state, persisted reader comment, owner reply, delete affordances and active comment composer.

### Findings and comparison history

- First comparison found no actionable P0/P1/P2 mismatch in the scoped reaction panel. The implementation preserves the source's left icon rail, member-avatar like row, avatar/name/time comment hierarchy, soft card background, separators and compact vertical rhythm.
- Typography: the implementation uses the product's system/PingFang stack and current story scale; names are semibold, timestamps muted and comment text readable at 13–14 pixels. Long names wrap metadata safely on mobile.
- Spacing/layout: the panel aligns to the story-content column, uses a 58-pixel desktop / 48-pixel mobile icon rail, and does not overflow at 390 or 1280 pixels. The always-visible rounded composer is an intentional product improvement over the reference's hidden posting flow.
- Colors/tokens: the reference's blue accents were intentionally mapped to the established story sage palette; the active heart uses a restrained warm red. Contrast and focus outlines remain visible.
- Images/icons: real account avatars use the existing avatar component, with account initials only where the test account has no avatar. Heart, comment, send and delete controls use the project's existing icon library rather than drawn substitutes.
- Copy/content: “成为第一个点赞的人” and “写下祝福…” cover empty and input states; counts, names, dates and comments are real persisted data. P3: the compact timestamp format omits the year, appropriate inside a dated timeline.

### Interaction and verification

- Browser flow verified like, unlike contract, posting a comment, persisted reload, owner deletion of another member's comment, two populated responsive captures, and no page runtime errors.
- API coverage verifies idempotent likes, trimmed comments, 500-character limit, guest denial, revoked-visibility denial, non-owner deletion denial and owner moderation. Focused route/shared coverage passes 9/9 tests.
- Primary actions remain keyboard reachable with accessible labels and pressed state. The input is a native form, and failure text uses an alert region.

final result: passed

## Personal stories — social panel annotation follow-up

- Acceptance source: the user's five annotated browser captures at 521 × 1102, checked alongside the original 575 × 869 reaction-panel reference. The scope is limited to interaction typography, dividers, icon spacing and send-button alignment.
- Visual evidence: final populated captures are `output/e2e/stories-social-390.png` and `output/e2e/stories-social-1280.png`; the equal-width source/implementation crop is `output/e2e/stories-social-focus-comparison-refined.png`. The combined comparison was opened and inspected after the final capture.
- Typography: the empty-like prompt, comment author and comment body now resolve from `--message-content-font-size`. The timestamp scales proportionally with the same setting while remaining subordinate.
- Structure: removed the icon-rail vertical rules and the like/comment row rule. A divider appears only between adjacent comments, beginning after the avatar at the text column rather than spanning the panel.
- Spacing and alignment: icon buttons no longer stretch to the full comment-row height; rails are 50 × 52 pixels on desktop and 44 × 46 pixels on mobile, with a slightly larger glyph and less surrounding space. The send icon uses a measured 1-pixel right/up optical correction inside the circular button.
- Verification: the isolated story browser test passed 1/1 and asserts inherited font sizes, absent row/rail borders, shortened inter-comment divider geometry, and submit-icon center offset. The final screenshots show no horizontal overflow at 390 or 1280 pixels. `verify:full` also passed across 152 test files, type checks and production builds; lint retains 19 pre-existing warnings and no errors.

final result: passed

## Personal stories — browser comments follow-up

- Acceptance source: the user's eight annotated screenshots. They supersede the original concept for header layout and copy; the ivory/sage palette is retained.
- HEIC: reproduced the broken draft preview with a real HEIC fixture, then verified normalized preview and direct upload. Unsupported images now report an error before entering the draft; conversion is cancellable and resource-bounded. Sharp was patched to 0.35.4; portable HEIC decoding remains necessary on the tested native build.
- Layout and copy: removed both banner captions; extended the botanical background through the header/profile area; made the signature editable with default “小小的故事，大大的恩典”; changed the footer to “我们的故事，都在祂的故事里。”; story text follows the chat font-size setting. Single images preserve their aspect ratio with no padded side bands, including detail view.
- Browser evidence: `output/e2e/stories-{width}.png` and `output/e2e/stories-single-{width}.png` cover mobile and desktop widths (360, 390, 552, 959, 1303; mixed-media also 1280). Assertions check image decode success, signature persistence, inherited font size, and single-image/button geometry. The retained local preview preserves the user's existing post and messages.
- Verification: full checks passed across 152 test files, type checks and production build; 19 existing lint warnings and no errors. Focused story regression covers 10 tests. The isolated story browser flow passed, and all 13 migrations replayed with no schema drift on a fresh disposable database. Prior full 32-test browser-suite results below belong to the original implementation, not this follow-up.
- Remaining limits: the user's original failing HEIC file was not attached, so the decoder regression uses an actual generated HEIC sample. Physical-device recording checks remain outstanding. Dependency audit has two pre-existing moderate advisories outside this change; no broad dependency fix was applied. No commit, push, release or deployment is included.

## Personal stories — selected concept 1

### Evidence and scope

- Source visual truth: selected Image Gen result `exec-8d54bfd2-7ba1-4bc9-b4b4-f48245cd3a1b.png`; normalized local evidence at `output/e2e/story-source-normalized.png`.
- Source pixels: 853 × 1844, normalized to 390 × 844. Browser implementation: 390 × 844 CSS pixels, device scale factor 1, at `output/e2e/stories-390.png`; additional 360 × 844 and 1280 × 900 captures are `stories-360.png` and `stories-1280.png` in the same ignored directory.
- Full-view side-by-side input: `output/e2e/stories-comparison.png`. Focused profile/banner/first-story comparison: `output/e2e/stories-focus-comparison.png`. Both combined images were opened and inspected.
- Both show a populated story timeline. The reference contains four fictional stories and a portrait; the test account contains one newly recorded mixed-media story and has no avatar. Test photos deliberately reuse the generated banner, not fake production posts. Content, recording duration, ownership title, and story count therefore differ; this is a palette/layout comparison, not a claim of pixel-identical content.

### Findings, fixes and post-fix comparison

- P2, mobile vertical rhythm: the initial profile padding and 100-pixel photo row pushed the banner bottom to approximately y=240, versus y=184 in the normalized concept. Reduced profile padding, banner height, timeline top padding, and photo height to 76 pixels. Recaptured all three widths after the fix; the final mobile banner ends around y=207, retaining readable 12-pixel profile copy and the existing modal header. No horizontal overflow or clipped controls.
- Typography: native system/PingFang fallbacks for UI, KaiTi family for editable banner copy; dark titles and quieter metadata match the hierarchy. Longer real text wraps and details expose untruncated text. Native font rendering is intentionally not an exact Image Gen glyph replica.
- Colors: ivory `#faf9f6`, sage `#678662`, charcoal `#242c36`, and pale botanical/gold accents preserve the selected direction. Error and disabled states remain distinct.
- Images: the banner is a generated raster, not CSS/SVG illustration; photos are actual protected uploads with aspect-preserving thumbnails and full-size gallery access. The default account initial uses the product's established no-avatar fallback. Additional decorative photo generation was unavailable; user content is not bundled into the application.
- Copy/content: gender labels are derived only from explicit user settings. Own view uses “我的故事”. Optional text, required media, visibility, duration limits and destructive confirmation are explicit. No reactions/comments/location controls are suggested by the UI because they are outside version-one scope.
- Intentional functional differences: a keyboard-operable seek slider replaces the concept's decorative waveform; details and author-delete controls are added. A single remaining entry has no trailing timeline rail. Desktop uses the existing accessible modal shell; mobile fills the viewport.

### Verification and remaining gaps

- Actual browser flow covers text-only publish disabled, photo order, microphone recording, audio preview, transport failure with retained draft, retry, persisted mixed-media post, gallery navigation, Escape, details, reload, author deletion, gender settings, and all three pronoun labels from the actual avatar menu.
- API checks against the isolated MySQL database cover cross-account media access, non-owner delete denial, shared-membership removal/regrant and immediate authorization recheck. The story flow reports no page runtime errors; its deliberately failed request is expected.
- Implementation checklist: responsive recapture complete; full and focused visual comparisons complete; primary interactions exercised. Remaining P3: validate long recordings and microphone interruptions on physical iOS/Android hardware; Chromium fake microphone tests are not evidence of physical-device behavior.
- Final checks: `verify:full` and `verify:changed` passed (151 test files; 19 existing lint warnings, no lint errors), six focused story assertions/tests passed, fresh disposable-database migration replay and schema comparison passed, and the complete isolated browser suite passed 32/32 tests. The modal suite now uses relative API URLs so an alternate test port cannot send requests to an unrelated local server. `git diff --check` and the tracked public-tree safety check passed. Independent loopback preview also opened successfully with no warning/error console entries; no commit, push or deployment was performed.

final result: passed

## Evidence

- Source visual: Browser Comments 1-5 attached to the implementation request, captured at 1863 x 1234.
- Implementation view: local in-app browser preview at `http://127.0.0.1:4174/`.
- States checked: populated grace card, gratitude recorded, grace update published, prayer card labels, related-verses panel expanded.
- Viewports checked: 1280 x 720, 390 x 844, and 360 x 800.

## Findings and fixes

- P1: the message bubble background leaked green through the grace card corners. Moved the grace gradient and border to the outer bubble and reused the prayer-card interior layout.
- P1: the grace card lacked the prayer card's action and update structure. Added gratitude, update, withdraw, history, member summary, and related-verses controls using shared prayer presentation components.
- P2: the grace subchannel icon was smaller than the prayer subchannel icon. Both now measure 30 x 30 pixels.
- P2: the obsolete grace footer copy and timestamp were visible. Removed both.
- P2: prayer action copy did not match the requested labels. Updated it to `更新动态` and `无需继续代祷`.

## Verification

- Card geometry and wrapping remained within the viewport at all three sizes; no horizontal body overflow was observed.
- At 1280 x 720, the grace bubble measured 430 pixels wide and its gradient covered the rounded outer boundary without a green underlay.
- At 390 x 844 and 360 x 800, the grace bubble measured 296 and 266 pixels wide respectively; action buttons wrapped without clipping.
- The browser console contained no warnings or errors during the checked interactions.

final result: passed

## Voice transcription follow-up

### Evidence

- Source visual: Browser Comments 1-2 attached to the follow-up request, captured at 1863 x 1233.
- Implementation view: isolated local in-app browser preview at `http://localhost:4174/` with a cached 37-second voice transcript.
- Viewports checked: 1280 x 720, 390 x 844, and 360 x 800.

### Findings and fixes

- P1: the duration and file-size column touched the voice-card edge. Added card-level box sizing and right padding; the desktop metadata inset is 9 pixels.
- P1: the mobile grid reserved only 34 pixels for metadata while the metadata block required 42 pixels, consuming the new inset. Changed the final mobile grid track to `auto`; the measured inset is now 9 pixels at both 390 and 360 pixels.
- P1: transcript copy was fixed at 13 pixels and ignored the adjustable message-font setting. It now uses `--message-content-font-size`; browser interaction verified a 15-to-16-pixel change and restoration to 15 pixels.
- P2: the transcript line height was tuned from 1.7 to 1.55 so the larger, shared message size remains compact without looking crowded.

### Verification

- No horizontal document overflow was observed at 390 or 360 pixels (`scrollWidth` matched the viewport width).
- At 390 pixels, the voice card measured 156 pixels wide, retained a 9-pixel metadata inset, and the transcript measured 290 pixels wide at 15 pixels.
- At 360 pixels, the voice card measured 144 pixels wide, retained a 9-pixel metadata inset, and the transcript measured 260 pixels wide at 15 pixels.
- The only console entries during QA were Vite websocket reconnect errors caused by intentionally restarting the local preview; no application runtime warning or error was observed.

final result: passed
