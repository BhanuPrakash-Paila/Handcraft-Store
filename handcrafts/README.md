# Kondapalli Crafts — storefront foundation

A premium, responsive Next.js storefront foundation for the provisional **Kondapalli Crafts** brand. The frontend, Azure Functions API, PostgreSQL schema and Blob Storage upload path are separated. The catalogue intentionally starts empty: there are no generated products, prices, images, reviews, artisan claims, orders or credentials.

> This code is not production-ready and is not live. Azure, PostgreSQL, Blob Storage, Razorpay, business policies and real catalogue data require owner configuration and verification. Human review and operational/security testing are required before launch.

## Project structure

- `app/`, `components/`, `lib/store-api.ts` — Next.js 16.4.2 App Router storefront. Public product reads use the configured Store API URL; cart, account, wishlist, checkout, order and admin actions call the Functions API directly.
- `services/api/` — Azure Functions v4, Node.js/TypeScript APIs, Razorpay verification and Azure Blob Storage integration.
- `services/api/migrations/001_initial.sql` — PostgreSQL schema. **No seed data.**
- `services/shared/src/commerce.ts` — shared commerce types and price/shipping/tax/state-transition helpers.
- `.azure/project-plan.md`, `.azure/requirements.json` — approved plan and requirements.
- `.azure/integration-plan.md` — hand-off checklist for migrations and end-to-end integration verification.

## Local development

### Requirements

- Node.js **20.19+** (or a currently supported Next.js runtime); this workspace’s Node 20.17 runtime emits an engine warning for a lint dependency.
- PostgreSQL 15+.
- Azure Functions Core Tools v4 and Azurite for local Functions storage, if running the API.

### Install and check

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Set `NEXT_PUBLIC_STORE_API_URL` in `.env.local` to the Functions origin (for example `http://localhost:7071`, without `/api`). The UI does not substitute sample products when the API is missing or unreachable; catalogue pages show an explicit service-unavailable state.

Create `services/api/local.settings.json` from `services/api/local.settings.example.json` (do not commit it), set a generated random `SESSION_SECRET` of at least 32 bytes, and configure local PostgreSQL. Apply the schema with the numbered migration runner:

```powershell
npm run migrate:db
npm run build:api
func start --script-root services/api
```

The migration runner acquires a PostgreSQL advisory lock, applies numbered `NNN_name.sql` files in order within transactions, records SHA-256 checksums in `schema_migrations`, and refuses modified migrations. Add a new numbered migration rather than editing one that has been applied. Do not use the runner against a database whose schema was previously applied manually unless its baseline is reconciled by an authorized database operator. **Migrations contain schema only; no products, users, orders, sample data or seed scripts are included.**

The Functions API uses port `7071` by default. `STORE_ORIGIN` must exactly match the storefront origin, such as `http://localhost:3000`. Set `DATABASE_URL` and the session secret in both the Next.js environment and the Functions settings; the storefront does not use database credentials.

## Environment and external setup

`.env.example` lists the settings used by this implementation. Never commit real `.env*`, `local.settings.json`, or credential values.

1. **PostgreSQL:** provision a managed PostgreSQL database, configure TLS and network access, apply numbered migrations, and confirm backups/restore procedures.
2. **Azure Functions:** create a Node.js 20 Linux Function App with its own Storage Account. Deploy the compiled Functions application from `services/api` after running `npm run build:api`. Configure Function App settings for `DATABASE_URL`, `SESSION_SECRET`, `STORE_ORIGIN`, storage settings and the optional commerce rules.
3. **Blob Storage:** configure `AZURE_STORAGE_CONNECTION_STRING` and `AZURE_STORAGE_CONTAINER`. Product images uploaded by authorized administrators are served publicly from a dedicated product-media container; store only approved, non-sensitive product imagery there. Restrict upload access, set lifecycle/cost controls and consider a CDN/controlled image delivery layer before launch.
4. **Razorpay:** payments remain disabled unless the API receives an `rzp_test_` key ID, key secret, webhook secret and a valid session secret. Configure the `payment.captured` and `payment.failed` events to `https://<function-app>/api/payments/razorpay/webhook`; validate the signature and run test-mode end-to-end tests. **Live Razorpay keys are deliberately rejected by the checkout readiness check.** Never report an order paid based only on browser UI.
5. **Hosting:** deploy the Next.js app to a Node.js server-capable Azure hosting target and set `NEXT_PUBLIC_STORE_API_URL`, `NEXT_PUBLIC_SITE_URL`, and the exact `STORE_ORIGIN`. Store all secrets as server-side app settings/Key Vault references. Ensure the storefront and Function App are same-site for secure cookie behavior, or add a same-origin backend-for-frontend proxy before using unrelated domains.
6. **Business launch:** supply and approve actual products, variants, SKUs, prices, stock, images, shipping/tax settings, support contacts and legally reviewed policies. No sample content is seeded.

### Initial administrator

There is no default admin or public admin-bootstrap endpoint. First create a customer account after the database and secret configuration are active. Verify the account through your owner-controlled process, then promote its exact email in a controlled database session:

```sql
UPDATE users
SET role = 'admin', updated_at = now()
WHERE email = lower('owner@example.invalid')
  AND role = 'customer'
  AND disabled_at IS NULL;
```

Replace the example address with the owner’s verified account. Restrict database operator access and record the change. Admin APIs check the server-side session role on every operation.

## Implemented flows

- Empty-by-default, responsive editorial storefront, live database-backed product search/filter/sort/pagination/category/product routes, and SEO metadata/sitemap/robots.
- Guest cart cookie signed server-side; server queries current product price and stock and computes totals in paise.
- Customer sign-up/sign-in with scrypt password hashes, hashed opaque session tokens and HttpOnly cookies; account order history and wishlist.
- Checkout input validation, inventory reservation under row locks, order snapshots, idempotency key/fingerprint, and server-created Razorpay test order.
- Razorpay callback signature verification plus raw-body HMAC webhook handling and event idempotency.
- Server-authorized admin summary/order search, draft product and category management, product/category assignment, variant/inventory entry, image upload, publishing preconditions, stock adjustments and fulfillment/tracking updates.
- PostgreSQL schema for catalog, accounts, sessions, guest carts, wishlist, inventory/movements, orders/snapshots, payment/refund records, coupon/review tables and audit events.

## Important limitations before production

- No real store data, approved photos, reviews, published policies, support contacts or legal business identity are included.
- No production-safe development seed script is provided by design; populate only owner-approved catalog data through authenticated administration after verifying business details.
- Email verification, password reset, newsletter signup, transactional emails and customer address-book management are not implemented.
- Coupon redemption/eligibility, category rename/reorder/image editing, product media replacement/removal, product variant editing after creation, and order detail/address inspection in administration are incomplete. Admin can create/deactivate categories, assign active categories to a new draft, create basic product drafts, manage initial stock/images and submit fulfillment updates, but is not a complete merchandise-management console.
- Buy Now, product quantity selection, interactive image-gallery/zoom, related or recently viewed products, and customer review submission/display are not implemented. Genuine review records are not fabricated or currently surfaced.
- Tax calculation is configurable arithmetic only; no tax/legal rules, exemptions, invoices or business policy have been validated. Shipping is configured flat-rate/free-threshold logic only; PIN serviceability, delivery estimates, carrier integration, returns and provider-backed refunds are not implemented.
- Customer self-service profile editing and saved addresses are not implemented. Account creation/sign-in, sign-out, order history and wishlist call the API; password reset and stronger identity verification require an owner-selected identity/email solution.
- Pending payment inventory reservations have no automated expiry/reconciliation task. Monitor and reconcile pending orders before accepting real traffic.
- The current rate limiter is process-local and is not sufficient for multi-instance production; use a distributed rate limiter/API Management. Add CSRF protection and deploy behind a hardened same-site architecture before launch.
- Razorpay checkout remains disabled unless all required test values are configured. No merchant credentials were available; no Razorpay order, payment, signature or webhook was exercised. No simulated payment success is implemented, and live-key configuration is rejected.
- Blob uploads are limited to 5 MB and JPEG/PNG/WebP with basic magic-byte checks. Validate image decompression limits, malware policy, CORS, public access, lifecycle, and owner workflows before launch.
- No PostgreSQL database, Azure Functions Core Tools runtime, Azure Blob resource/credentials, cloud resource, deployment, real image, payment, email or shipping integration was available for live testing in this workspace.

## Validation commands

```powershell
npm run lint
npm run typecheck
npm test
npm run build:api
npm run build
```

The included tests cover server-side money totals, stock bounds, shipping thresholds, and order/payment state transition helpers. They do not replace PostgreSQL, Functions-host, Razorpay, browser, accessibility or cloud end-to-end testing.
