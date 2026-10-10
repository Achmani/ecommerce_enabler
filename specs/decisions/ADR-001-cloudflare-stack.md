# ADR-001: Cloudflare-native application stack

- Status: accepted
- Date: 2026-10-11

## Decision

Use Workers and Workers Static Assets for compute/frontend, D1 for relational
data, R2 for product media, Queues for asynchronous notifications, Turnstile
for checkout bot protection, and Cloudflare Access for production admin access.

## Consequences

The application stays operationally small and uses binding-based access. The
code must respect Workers runtime APIs, D1 transaction semantics, queue
at-least-once delivery, and Access setup outside repository deployment.

