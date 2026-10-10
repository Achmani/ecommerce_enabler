# SPEC-001: Commerce Foundation

- Status: approved
- Depends on: SPEC-000

## Architecture

- Cloudflare Worker: HTTP API and queue consumer.
- Workers Static Assets: compiled storefront and admin single-page application.
- D1: relational commerce records.
- R2: product media.
- Queues: email and web-push notification delivery.
- Turnstile: bot protection for order/payment creation.

## Requirements

- `FOUND-001` The Worker MUST invoke API code for `/api/*` and serve all other
  matching static files directly.
- `FOUND-002` Unknown non-API browser routes MUST return the SPA shell.
- `FOUND-003` D1 schema changes MUST use ordered SQL migrations.
- `FOUND-004` D1, R2, and Queues MUST be accessed through Worker bindings.
- `FOUND-005` Production logs MUST be structured and MUST NOT include secrets,
  complete addresses, or payment payloads.
- `FOUND-006` The project MUST include local, staging, and production setup
  documentation.
- `FOUND-007` CI MUST run type checks, tests, build, generated-binding checks,
  and a Wrangler deployment dry run.
- `FOUND-008` API errors MUST use a stable JSON envelope containing an error
  code, message, and request ID.

## Acceptance criteria

- A clean checkout can install dependencies, apply local migrations, run tests,
  and build without uncommitted generated changes.
- `/api/health` reports service health without leaking configuration values.
- A deep link such as `/admin/products` serves the SPA shell.

## Rollback

Worker deployments use Cloudflare deployment versions. D1 migrations MUST be
forward-safe; destructive data changes require a separate approved migration
specification and backup procedure.

