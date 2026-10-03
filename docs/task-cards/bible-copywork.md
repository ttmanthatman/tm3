# Bible copywork implementation

- Baseline: b473726; existing unrelated working changes are preserved.
- Goal: guided Bible copying, natural ink spacing, private account storage, explicit publication and channel sharing.
- Owner: one executor; shared contract, server and client changes are sequential.
- Allowed: copywork feature modules, integration boundaries, additive Prisma migration, focused tests and module documentation.
- Forbidden: release metadata, service worker, deployment, production data, unrelated local edits.
- Invariants: immutable completed ink; private by default; every page read authorized; retry-safe save and share; deletion removes ink; recall removes channel grant; ordinary handwriting remains 30 characters.
- Failure cases: unfinished upload, lost response, offline draft, corrupt ink, unauthorized lookup, revoked membership, translation mismatch, deletion and backup restore.
- Acceptance: select continuous verses, write/rewrite/resume, mount pages, save, publish/unpublish, share, recall and delete. Reader markers are per-verse and per-translation.
- Validation: focused layout/service tests; final verify:full; isolated tm3_e2e browser tests; fresh tm3_migration_verify migration checks.
- Handoff: no push or deployment authorized; actual stylus hardware feel must be verified on a physical device.
