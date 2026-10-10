# SPEC-004: Shipping

- Status: approved
- Provider: RajaOngkir/Komerce Shipping Cost API
- Fulfillment: manual booking

## Requirements

- `SHIP-001` The shop origin destination ID MUST be server configuration.
- `SHIP-002` Customers MUST be able to search Indonesian delivery destinations.
- `SHIP-003` Quotes MUST be calculated from authoritative variant weights and
  quantities, with a minimum package weight configurable by the merchant.
- `SHIP-004` The platform MUST store a quote snapshot containing provider,
  courier, service, description, cost, ETA, destination, weight, and expiry.
- `SHIP-005` A quote MUST expire after a configurable period no longer than 30
  minutes.
- `SHIP-006` Provider timeouts and unavailable routes MUST return a retryable
  error and MUST NOT invent a shipping price.
- `SHIP-007` After payment, staff MUST book the courier outside the platform and
  enter the courier name and airway bill number manually.
- `SHIP-008` Changing a paid order's shipping service or price requires an
  explicit future specification; the MVP MUST not silently substitute it.
- `SHIP-009` Local development MAY use deterministic mock destinations and
  quotes. Mock shipping MUST be disabled when `ENVIRONMENT=production`.

## Acceptance criteria

- Given a destination and cart, a successful provider response produces only
  server-saved selectable quotes.
- Given a customer selects a quote, the created order stores the same shipping
  snapshot even if later provider rates change.
- Given a paid order, staff can record its courier and airway bill number.
