# Personal brush options and copywork presentation

- Baseline: df72da4; unrelated modal, search and WeChat relay edits are preserved. No repository graph tool is available.
- Goal: account-scoped brush controls for all users, fixed 45-degree 石径斜 alongside 峰随路转, content-sized folios and accessible mobile close controls.
- Owner: one executor; shared contract and consumers are updated sequentially.
- Allowed: handwriting and copywork client modules, minimal App composition wiring, additive brush validation, focused tests and module documentation.
- Forbidden: schema, service worker, deployment, retained data and unrelated local edits.
- Invariants: legacy brush payloads retain canonical serialization and rendering; parameters freeze per stroke; account preferences never change another account or global settings; ink placements remain unchanged.
- Failure cases: invalid algorithm, failed preference save, rapid edits, account switch during save, replay mismatch, cropped ink, mobile safe-area overlap.
- Acceptance: regular users change and reload their brush parameters in both composers; fixed brush retains its angle through turns and varies width with speed; short and long pages retain all ink and captions; close works at 360/390/1280 widths and with a simulated top inset.
- Validation: targeted brush, renderer, contract, persistence and page-height tests; final verify:full; isolated tm3_e2e handwriting and copywork suites, including WebKit.
- Handoff: release preparation and push require separate explicit authorization; physical stylus feel and actual iPhone system bars require hardware verification.
