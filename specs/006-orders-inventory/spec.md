# SPEC-006: Orders and Inventory

- Status: approved

## State models

Order: `pending_payment -> paid -> processing -> shipped -> delivered`.
Terminal alternatives are `expired` and `cancelled`. Invalid transitions MUST
be rejected.

## Requirements

- `ORDER-001` Orders MUST snapshot customer-visible product, price, tax,
  adjustment, shipping, and address data.
- `ORDER-002` A pending payment MUST reserve inventory until payment expiry.
- `ORDER-003` Reservation, order creation, and inventory movement creation MUST
  be atomic.
- `ORDER-004` Expired or cancelled unpaid orders MUST release reservations
  exactly once.
- `ORDER-005` Successful payment MUST convert reservations to committed sales
  exactly once.
- `ORDER-006` Stock MUST never become negative.
- `ORDER-007` Every order state change MUST create an immutable event containing
  actor, timestamp, previous state, new state, and optional note.
- `ORDER-008` Administrators MUST use only allowed state transitions.
- `ORDER-009` Public order lookup MUST require both order number and opaque
  public access token.

## Acceptance criteria

- Concurrent attempts to buy the last unit result in at most one successful
  reservation.
- Expiring an order twice does not restore stock twice.
- Historic order details remain unchanged after product edits.

