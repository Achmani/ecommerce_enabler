# SPEC-005: Payments

- Status: approved
- Initial production adapter: Komerce Payment API QRIS
- Development adapter: deterministic mock payment provider

## Requirements

- `PAY-001` The MVP MUST support QRIS payment and MUST isolate provider code
  behind a payment adapter.
- `PAY-002` Payment creation MUST use the authoritative order amount.
- `PAY-003` Provider keys and callback secrets MUST be Worker secrets.
- `PAY-004` Payment callbacks MUST verify their documented HMAC signature using
  the exact raw request body before processing.
- `PAY-005` Callback processing MUST be idempotent and retain a deduplication
  record without persisting unnecessary sensitive payload data.
- `PAY-006` The application MUST support `pending`, `paid`, `expired`, `failed`,
  and `cancelled` payment states.
- `PAY-007` A paid order MUST never transition back to unpaid due to a delayed or
  repeated provider event.
- `PAY-008` Payment status reconciliation MUST be possible from the dashboard.
- `PAY-009` The mock provider MUST be disabled in production.

## Acceptance criteria

- A valid callback marks a matching pending payment and order paid exactly once.
- An invalid signature returns an authorization error and changes no state.
- A repeated valid callback returns success without duplicate stock or
  notification effects.

