# Integration hand-off

## Essential services
- Storefront: current workspace root (`.`), Next.js App Router TypeScript.
- Store API: `services/api/`, Azure Functions v4 TypeScript; local run `func start --script-root services/api`; port `7071`; compile `npm run build:api`; health `GET /api/health`.
- PostgreSQL: required for catalog/cart/accounts/orders/inventory; `DATABASE_URL`, `SESSION_SECRET`, `STORE_ORIGIN`.
- Product media: Azure Blob Storage integration in `services/api/src/functions.ts`; upload route `POST /api/admin/media`; container `AZURE_STORAGE_CONTAINER`.

## Frontend wiring seam
- Frontend folder: `.`.
- Dev: `npm run dev`; build: `npm run build`.
- API base: `NEXT_PUBLIC_STORE_API_URL` (Function App origin, no trailing `/api`).
- Current API client/data seam: `lib/store-api.ts` (`apiUrl`, `getCatalog`, `getProduct`); client workflows call the same API base directly.
- Mock files/datasets to delete: none. The catalogue is empty by design; no mock client, sample product data, or fake payment state exists.
- Shared business types/calculations: `services/shared/src/commerce.ts`.

## API inventory
- `GET /api/health`
- `GET /api/products` — query `q`, `category`, `minPrice`, `maxPrice`, `available`, `sort`, `page`, `limit`
- `GET /api/products/{slug}`
- `GET /api/categories` — only active categories with published products
- `GET /api/cart`
- `POST /api/cart/items`
- `PATCH /api/cart/items/{variantId}`
- `DELETE /api/cart/items/{variantId}`
- `POST /api/account/signup`
- `POST /api/account/signin`
- `POST /api/account/signout`
- `GET /api/account`
- `GET /api/account/orders`
- `GET|POST|DELETE /api/account/wishlist`
- `POST /api/checkout` — requires `Idempotency-Key`, verified Razorpay test configuration and signed guest cart.
- `POST /api/payments/razorpay/verify`
- `POST /api/payments/razorpay/webhook` — raw-body HMAC signature and event-id idempotency.
- `GET /api/orders/{orderNumber}` — signed-in owner or private expiring `access` token.
- `GET /api/admin/summary`
- `GET /api/admin/orders` — query `q`, `status`, `paymentStatus`, `limit`
- `GET|POST /api/admin/categories`
- `PATCH /api/admin/categories/{categoryId}`
- `POST /api/admin/products`
- `PATCH /api/admin/products/{productId}`
- `PATCH /api/admin/products/{productId}/categories`
- `POST /api/admin/products/{productId}/variants`
- `POST /api/admin/products/{productId}/images`
- `PATCH /api/admin/inventory/{variantId}`
- `PATCH /api/admin/orders/{orderNumber}`
- `POST /api/admin/media` — authenticated image bytes.

## Database and verification
- Database: PostgreSQL; migration: `services/api/migrations/001_initial.sql`.
- Apply manually with `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/001_initial.sql`; create a numbered migration/version process before ongoing deployments.
- **NO seed data.** Never add sample products/orders/users to production.
- Connection variables: `DATABASE_URL`, optional `PGSSLMODE`, `PG_POOL_MAX`; session `SESSION_SECRET`.
- Shipping/tax settings: `SHIPPING_FLAT_RATE_PAISE`, `FREE_SHIPPING_THRESHOLD_PAISE`, `TAX_RATE_BASIS_POINTS`; confirm policy before setting nonzero values.
- Payments: test key ID `RAZORPAY_KEY_ID` (`rzp_test_` only), `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; no real credentials supplied.
- Blob: `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER`; public-read container is for approved product images only.

## Essential vs enhancement scope
- Essential: storefront, Azure Functions API, PostgreSQL persistence, Blob image integration, server-side cart/checkout/order foundation.
- Enhancements / owner configuration: Razorpay test credentials/webhook, customer/admin account promotion, support/policy content, real product data/images, business shipping/tax rules.
- Deferred implementation: email, shipping carrier API, returns/refunds, coupon operations, category administration UI, password reset, automated pending-reservation expiry/reconciliation and distributed rate limiting.
