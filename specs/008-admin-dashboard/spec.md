# SPEC-008: Admin Dashboard

- Status: approved
- Authentication: Cloudflare Access in production

## Requirements

- `ADMIN-001` The dashboard MUST show order counts, sales summary, pending
  fulfillment, and low-stock products.
- `ADMIN-002` Authorized staff MUST manage products, variants, media, and stock.
- `ADMIN-003` Authorized staff MUST view orders, payments, shipment information,
  and order events.
- `ADMIN-004` Staff MUST be able to move orders through allowed fulfillment
  states and record courier/AWB data.
- `ADMIN-005` Staff MUST be able to inspect and retry failed notifications.
- `ADMIN-006` Production identity MUST come from Cloudflare Access; a clearly
  isolated local-development identity MAY be supported outside production.
- `ADMIN-007` Authorization MUST be enforced by APIs, not only hidden UI.
- `ADMIN-008` Administrative mutations MUST create an audit log entry.
- `ADMIN-009` Destructive actions MUST require confirmation and default to
  archival where historic records may reference the entity.

## Acceptance criteria

- Public users cannot read or mutate administrative resources.
- Product changes made in the dashboard are reflected in the public catalogue.
- Recording courier and AWB changes the order to shipped and queues customer
  notifications.

