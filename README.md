# Ecommerce Enabler

Commerce platform for [Teman Makan](https://temanmakan.biz.id/). It keeps the
landing-page experience and adds a product catalogue, persistent cart, guest
checkout, Indonesian shipping quotes, QRIS payment, manual fulfillment,
transactional notifications, inventory, and an administration dashboard.

The repository uses spec-driven development. Read [specs/README.md](specs/README.md)
before changing behavior: amend and approve a specification first, then
implement and verify it.

## Stack

- React + Vite storefront and `/admin` dashboard
- Cloudflare Worker and Workers Static Assets
- D1 for commerce records and immutable audit history
- R2 for product images
- Cloudflare Queues for email and Web Push delivery
- Cloudflare Access for administrators, with Worker-side JWT verification
- Turnstile for production checkout abuse protection
- RajaOngkir/Komerce Shipping Cost API for destinations and shipping quotes
- Komerce Payment API for QRIS
- Resend for email and VAPID Web Push for opt-in browser notifications

Courier booking remains manual in the MVP. After payment, staff books the
courier outside this platform and records the courier and airway bill in the
dashboard.

## Local development

Requirements: Node.js 22.12 or newer and pnpm 11.

```bash
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm run db:migrate:local
pnpm run dev
```

Open `http://localhost:5173`; the admin dashboard is at
`http://localhost:5173/admin`. Local development uses deterministic shipping,
payment, and notification adapters when provider keys are empty. Those adapters
are rejected when `ENVIRONMENT=production`.

Set `ADMIN_EMAILS` and `DEV_ADMIN_EMAIL` to the same local email. Product data
is intentionally not seeded because the merchant's real SKUs, prices, weights,
and stock must be entered through the dashboard.

Run the complete verification suite with:

```bash
pnpm run check
```

It runs linting, TypeScript and generated binding checks, D1-backed Worker
integration tests, a production frontend build, and a Wrangler deployment dry
run.

## Cloudflare production setup

The commands below create billable/persistent Cloudflare resources. Run them
only in the intended account.

1. Authenticate and create resources:

   ```bash
   pnpm exec wrangler login
   pnpm exec wrangler d1 create ecommerce-enabler
   pnpm exec wrangler r2 bucket create ecommerce-enabler-media
   pnpm exec wrangler queues create ecommerce-enabler-notifications
   pnpm exec wrangler queues create ecommerce-enabler-notifications-dlq
   ```

2. Replace `database_id: "local"` in `wrangler.jsonc` with the D1 UUID returned
   by the first command. Configure the production variables in that file:

   - `ADMIN_EMAILS`: comma-separated administrator allowlist.
   - `ACCESS_TEAM_DOMAIN`: for example,
     `https://your-team.cloudflareaccess.com`.
   - `ACCESS_AUD`: the Access application's audience tag.
   - `STORE_ORIGIN_DESTINATION_ID`: RajaOngkir origin destination.
   - `KOMERCE_CHANNEL_CODE`: the enabled QRIS channel.
   - `EMAIL_FROM` and `VAPID_SUBJECT`: verified production identities.

3. Store credentials as Worker secrets, never as GitHub variables or committed
   files:

   ```bash
   pnpm exec wrangler secret put RAJAONGKIR_API_KEY
   pnpm exec wrangler secret put KOMERCE_PAYMENT_API_KEY
   pnpm exec wrangler secret put KOMERCE_CALLBACK_SECRET
   pnpm exec wrangler secret put ORDER_TOKEN_SECRET
   pnpm exec wrangler secret put RESEND_API_KEY
   pnpm exec wrangler secret put TURNSTILE_SECRET_KEY
   pnpm exec wrangler secret put VAPID_PUBLIC_KEY
   pnpm exec wrangler secret put VAPID_PRIVATE_KEY
   ```

4. Apply the database migration, build, and deploy:

   ```bash
   pnpm run db:migrate:remote
   pnpm run deploy
   ```

5. In Cloudflare, connect the Worker to the intended Teman Makan hostname only
   after validating its `workers.dev` deployment. Protect both `/admin*` and
   `/api/admin/*` with a hostname/path Cloudflare Access application. The Worker
   independently verifies the signed Access JWT and applies `ADMIN_EMAILS`.

6. Configure the Komerce callback URL as
   `https://temanmakan.biz.id/api/payments/komerce/callback`, then complete a
   low-value end-to-end production test before opening checkout publicly.

Do not attach the production custom domain until DNS cutover is intended; that
step can replace the current landing page.

## GitHub Actions

`ci.yml` verifies every push and pull request. `deploy.yml` is intentionally a
manual production workflow. Before using it, add these repository secrets:

- `CLOUDFLARE_API_TOKEN` with Workers, D1, R2, and Queues deployment access.
- `CLOUDFLARE_ACCOUNT_ID` for the target account.

The Cloudflare provider credentials remain Worker secrets. The deployment
workflow applies pending D1 migrations before publishing the Worker.

## Staging

Use separate resources such as `ecommerce-enabler-staging`,
`ecommerce-enabler-media-staging`, and staging notification queues. Copy the
production Wrangler binding structure into a dedicated `env.staging` only after
those resource IDs exist, use provider sandbox credentials, and set
`PUBLIC_BASE_URL` to the staging hostname. Never bind staging to the production
D1 database, R2 bucket, queues, or payment callback.

## Key routes

- `/` — storefront and landing page
- `/checkout` — guest checkout
- `/order/:orderNumber` — token-protected order status
- `/admin` — administrator dashboard
- `/api/health` — binding-backed health check
- `/api/payments/komerce/callback` — signed payment callback

## Current deployment readiness

The application and local Cloudflare runtime are verified. A real deployment
still requires an authenticated Wrangler session, provisioned resource IDs,
production provider credentials, Access configuration, and an explicit domain
cutover decision.
