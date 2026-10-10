# SPEC-002: Product Administration

- Status: approved
- Depends on: SPEC-001, SPEC-008

## Product model

A product has a stable ID, slug, name, description, status, image collection,
and one or more variants. A variant has a SKU, name, price, weight in grams,
optional dimensions, and inventory quantity.

## Requirements

- `PROD-001` Authorized administrators MUST be able to create, read, update,
  archive, and restore products.
- `PROD-002` Slugs and SKUs MUST be unique.
- `PROD-003` Price, weight, and stock MUST be non-negative integers.
- `PROD-004` A product MUST have at least one variant before publication.
- `PROD-005` Public catalogue responses MUST exclude archived and draft items.
- `PROD-006` Product deletion after an order exists MUST be logical archival,
  not physical deletion.
- `PROD-007` Administrators MUST be able to upload JPEG, PNG, or WebP images of
  at most 5 MiB to R2.
- `PROD-008` Product images MUST have alt text and deterministic display order.
- `PROD-009` Every inventory adjustment MUST create an immutable movement entry.

## Acceptance criteria

- Given valid product data, when an administrator publishes it, then it appears
  in the public catalogue.
- Given duplicate SKU or slug data, when saved, then the API returns a conflict
  without changing the existing product.
- Given an archived ordered product, then historic order items retain their
  name, SKU, and price snapshots.

