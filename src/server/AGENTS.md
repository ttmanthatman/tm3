# Server Agent Guidance

These rules apply to work under `src/server/`.
Follow the root `AGENTS.md` first and use `docs/development-index.md` for the module map.

## Structure

- Move toward separate route, business-service, and data-access layers as code is touched.
- Keep route handlers focused on transport, validation, authentication, and response mapping.
- Put reusable business rules in focused service modules.
- Keep database access explicit and narrow.
- Register every new route from an independent route module.
- Do not place new route bodies directly in `index.ts` or a future giant app file.
- Avoid broad extraction unless it is necessary for the requested behavior.
- Preserve transaction boundaries and ordering assumptions when moving code.

## Security and Contracts

- Enforce authentication and authorization on the server.
- Never rely on a hidden client control as a permission check.
- Validate input with the existing Zod schema or equally strict validation.
- Reject unknown or malformed values according to established endpoint behavior.
- Preserve existing HTTP status codes and response structures unless explicitly requested.
- Keep error details public-safe and avoid exposing internal paths or secrets.
- Preserve channel, message, attachment, and administrative access boundaries.
- Treat outbound URL handling and uploaded filenames as untrusted input.

## High-Risk Areas

- Treat file storage, upload, download, preview, and deletion changes as high risk.
- Treat authentication, sessions, tokens, password handling, and account recovery as high risk.
- Treat Socket event authorization, room membership, and payload changes as high risk.
- Treat database migrations, schema changes, and destructive queries as high risk.
- Trace all callers and consumers before changing shared server helpers.
- Require explicit task authority before changing database schema or migrations.
- Preserve cleanup, rollback, and failure behavior around external side effects.
- Create a new Prisma migration for every schema change; never edit or delete `0_init` or another committed migration.
- Use `prisma migrate dev` only for development migration creation and `prisma migrate deploy` for long-lived environments.
- Never use `prisma db push` against a long-lived test or production database.
- Resolve `0_init` as applied on an existing database only after a verified backup and an empty `prisma migrate diff`.

## Testing

- Prefer Fastify `inject` tests for HTTP behavior.
- Prefer focused service tests for business rules that do not require transport.
- Test permission denial as well as the successful path.
- Test malformed and boundary inputs when validation changes.
- Assert status code and response shape for route changes.
- Run the narrowest relevant server test during iteration.
- Run `npm run test:server` for authentication, authorization, file, or URL changes.
- Run `npm run test:scripts` for migration history or migration safety changes.
- Validate migrations by applying them to a fresh local `tm3_migration_verify` database; never substitute a retained application database.
- Run `npm run check` for server TypeScript changes.
- Run `npm run build` when server code or build behavior changes.

## Guardrails

- Do not use `any`, weaken validation, swallow errors, or remove assertions.
- Do not silently change response fields consumed by the client.
- Do not log credentials, tokens, private content, or environment values.
- Do not modify schema, release files, or deployment configuration incidentally.
- Review the server-only diff and targeted test evidence before committing.
- Follow the root guidance for complete diff review and final reporting.
