# SPEC-000: Platform Overview

- Status: approved
- Approved from: product planning conversation, 2026-10-11
- Scope: MVP

## Objective

Enable full commerce capabilities on the existing Teman Makan landing page
while preserving its branding and marketing content. This is a single-merchant
commerce platform, not a marketplace or a replacement landing page.

## Goals

- Preserve the existing public landing-page experience.
- Add catalogue, cart, guest checkout, shipping quotes, QRIS payment, orders,
  inventory, notifications, and a secure administration dashboard.
- Operate on Cloudflare Workers with managed Cloudflare storage services.
- Make external payment, shipping, and email providers replaceable adapters.
- Keep customer-facing totals and stock authoritative on the server.

## Non-goals

- Multi-vendor marketplace behavior.
- Native Android or iOS applications.
- Customer accounts in the MVP.
- Automatic courier booking, pickup, or label printing in the MVP.
- Card payment in the MVP.

## Requirements

- `PLAT-001` The public store MUST be available on the same application as the
  landing page.
- `PLAT-002` The platform MUST support guest checkout.
- `PLAT-003` Administrative functions MUST be isolated under `/admin` and
  protected by Cloudflare Access in production.
- `PLAT-004` All monetary amounts MUST be represented as integer Indonesian
  rupiah values.
- `PLAT-005` External credentials MUST be stored as Worker secrets and MUST NOT
  be committed.
- `PLAT-006` State-changing requests MUST be validated server-side and logged
  with a request identifier.
- `PLAT-007` Provider-specific logic MUST be behind application adapters.
- `PLAT-008` Every later behavior change MUST update an approved specification
  before implementation.

## Acceptance criteria

- Given a visitor opens the root URL, when the application loads, then the
  Teman Makan brand and commerce entry points are visible.
- Given an unauthenticated visitor requests an administrative API, then the
  request is rejected.
- Given repository history is inspected, then no production credential is
  stored in source or configuration.

## Change history

- 2026-10-11: Initial approved MVP definition.

