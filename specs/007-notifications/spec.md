# SPEC-007: Notifications

- Status: approved
- Channels: transactional email and opt-in browser Web Push

## Requirements

- `NOTIF-001` Email MUST be the primary transactional channel.
- `NOTIF-002` Customers MAY opt into browser push after order creation; checkout
  MUST work when permission is denied or unsupported.
- `NOTIF-003` Notifications MUST be queued after the related database change
  commits.
- `NOTIF-004` Queue consumers MUST tolerate at-least-once delivery using a
  stable deduplication key.
- `NOTIF-005` Notifications MUST cover payment received, processing, shipped,
  delivered, cancelled, and payment expired events.
- `NOTIF-006` Shipment messages MUST include courier and airway bill when known.
- `NOTIF-007` Delivery attempts and safe error summaries MUST be visible to
  administrators, with a manual retry action.
- `NOTIF-008` Email and Web Push providers MUST be adapters. The initial email
  adapter uses Resend; Web Push uses VAPID.
- `NOTIF-009` Unsubscribed or invalid push subscriptions MUST be deactivated.

## Acceptance criteria

- Changing an order to shipped queues one email and, when subscribed, one push
  notification.
- Retrying the same queue message does not send a duplicate successful message.
- Email-provider failure does not roll back the order status and is retryable.

