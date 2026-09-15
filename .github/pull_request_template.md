## Task baseline

- Task card / issue reference:
- Baseline commit:

## User-facing behavior

- Trigger scenario exercised end to end (for example: login → channel → send → confirm result):
- Failure and recovery states checked (offline, timeout, error message, retry path):

## Verification

- [ ] `npm run verify:full`
- [ ] Changed UI checked at 360px, 390px, and at least 1280px.
- [ ] Weak-network or performance evidence attached when the change affects them (same data, viewport, and throttling before and after; median over repeated runs).

## Not verified

- Items not verified and why (for example: iOS real-device soft keyboard, no retained-environment check):

## Effects and animation

Complete this section when the change adds or modifies an effect or animation. See the [Effect Rendering Economy Checklist](../docs/development-index.md#effect-rendering-economy-checklist).

- [ ] Offscreen, hidden-document, `pagehide`, and unmount behavior is defined and tested.
- [ ] Observers track stable wrappers, not animated or transformed nodes.
- [ ] Animation frames, timers, and physics stop with no visible participants; cyclic movement resets only after full exit.
- [ ] Mobile and desktop rendering was checked for stable layout, scroll position, and bounded DOM work.
- [ ] Not applicable.
