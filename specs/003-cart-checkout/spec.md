# SPEC-003: Cart and Checkout

- Status: approved
- Depends on: SPEC-002, SPEC-004, SPEC-005, SPEC-006

## Requirements

- `CART-001` The guest cart MUST persist in the browser without requiring an
  account.
- `CART-002` The browser cart is advisory; the server MUST reload products,
  prices, weights, status, and stock during quote and order creation.
- `CART-003` Cart quantities MUST be positive integers and respect a configured
  per-line maximum.
- `CHECK-001` Checkout MUST collect name, email, phone, Indonesian destination,
  complete address, postal code, and optional customer note.
- `CHECK-002` Checkout MUST require an unexpired server-created shipping quote.
- `CHECK-003` The server MUST calculate subtotal, shipping, adjustments, and
  grand total using integer rupiah values.
- `CHECK-004` Order creation MUST use an idempotency key.
- `CHECK-005` Production checkout MUST validate Turnstile server-side.
- `CHECK-006` The order confirmation page MUST display an opaque public token,
  never an enumerable internal identifier.
- `CHECK-007` Sensitive customer fields MUST not be written to browser storage
  after checkout completes.

## Acceptance criteria

- A manipulated client price never changes the server order total.
- Repeating an order request with the same idempotency key returns the original
  order rather than creating a duplicate.
- An expired shipping quote or unavailable product blocks order creation with a
  recoverable error.

