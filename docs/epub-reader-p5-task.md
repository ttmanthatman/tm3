# EPUB P5 implementation record

- Baseline: `78e2c27`. Owner: current single agent/session. Graph discovery unavailable; focused source inspection used.
- Goal: verified EPUB identity, versioned private progress/notes, explicit offline conflict resolution, legacy read/write compatibility.
- Authority: user approved local P5 implementation and disposable migration verification, then explicitly authorized local commit and push. Retained databases and deployment excluded.
- Dependencies: client source locators and stable reflow from P1–P4; existing authenticated book access and private Setting notes.
- Allowed: book client/server/shared modules, Prisma additive migration, focused tests and reader documentation, local commit and push. Forbidden: releases, service worker, authentication changes, production/retained migrations, deployment.
- Invariants: account-scoped state; no precise address without a SHA-256 publication identity; v1 strict projections unchanged; v1 fraction write invalidates locator atomically; CAS revisions decide conflicts; late async results cannot move an active/new reader; aborted writes remain retryable and idempotent.
- Failure scenarios: concurrent initial save, stale device write, lost response, offline retry, account switch, close/switch book, old file revision, malformed locator, old note backup/share.
- Acceptance: exact reopen and note/share navigation; one winner for same revision; explicit local/remote conflict choice; no note leakage; old progress and strict messages remain readable.
- Checks: targeted contract/service/route tests, existing isolated book Playwright tests plus persistence scenarios, fresh guarded migration verification, final `verify:full`, public-tree scan and diff review.
- Unverified: physical iOS/Android touch/inertia, embedded-browser lifecycle, same-condition ≥20-run p95 comparison. Browser engines/emulated viewports do not substitute for physical devices.
