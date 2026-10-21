# Kondapalli Crafts Store — Project Plan

## Goal

Build a responsive, premium e-commerce application for Kondapalli wooden toys and traditional Indian crafts. Retain the existing Next.js App Router and TypeScript project. Implement real server-side commerce workflows and keep external services disabled until valid business configuration is supplied.

## Approved direction

- **Storefront:** Next.js App Router, React, TypeScript, and the existing Tailwind CSS setup.
- **API:** TypeScript Azure Functions, separated from the storefront presentation layer.
- **Data:** PostgreSQL for catalog, customer, inventory, order, payment, coupon, and audit records.
- **Product media:** Azure Blob Storage; no fabricated product photography or authenticity claims.
- **Hosting:** Azure-hosted Next.js server application and Azure Functions API.
- **Payments:** Razorpay integration in sandbox mode only when merchant credentials and webhook configuration are supplied. No simulated payment success.
- **Accounts:** Customer and administrator sign-in with server-side authorization; no public/default administrator account.

## Storefront experience

- Configure the provisional brand name, tagline, support details, shipping offer, and policy content centrally.
- Create a premium responsive home page with navigation, search, product/category discovery, story content, service details, and footer.
- Provide database-backed shop and category browsing with search, filters, sorting, and pagination.
- Provide product detail pages, accessible image galleries, stock/variant details where real data exists, and SEO metadata.
- Implement a persistent cart with server-authoritative prices, stock checks, and recalculated totals.
- Provide guest checkout and customer accounts, order confirmation, secure order history/tracking, and wishlist support.
- Show reviews only when genuine review records exist.
- Add editable policy/support pages; use clearly marked placeholders where business-approved policy language is missing.

## Administration and commerce services

- Protect every administrator route and mutation on the server.
- Support product, image, category, variant, and inventory management.
- Support order search, fulfillment updates, and manual tracking details.
- Record inventory movements and use transactional stock checks to prevent overselling.
- Implement coupon/shipping/tax calculations as server-side business logic and expose only configured rules.
- Implement Razorpay server order creation, signature verification, raw-body webhook verification, idempotency, and accurate payment states.
- Do not count unpaid orders as revenue or mark refunds complete before provider confirmation.

## Data and security

- Model users/roles, addresses, catalog/categories/images/variants, inventory and movements, carts, wishlists, orders and immutable order-item snapshots, payments/refunds, coupons/redemptions, shipping, reviews, and audit events as required by the implemented workflows.
- Keep credentials in environment configuration and validate production-critical settings.
- Validate all external input server-side; protect sessions, administrative access, payment endpoints, and customer order access.
- Use database transactions for checkout, stock changes, and payment fulfillment.
- Do not store card details, expose secrets, seed production with sample records, or trust client-supplied prices, roles, inventory, or payment outcomes.

## Delivery and verification

- Provide migrations and a development-only seed path that explicitly labels sample catalog data.
- Document Azure PostgreSQL, Blob Storage, Functions, Razorpay sandbox/webhook, and hosting setup in project documentation and `.env.example`.
- Add tests for price/shipping/coupon calculations, inventory validation, order/payment state transitions, payment verification/idempotency, and admin authorization.
- Run the available lint, type-check, tests, and production build; report any external configuration that prevents an integration from being verified.

## Launch prerequisites and non-goals

- Real product information, images, prices, stock, dimensions, artisan claims, and business policies must be supplied and approved by the store owner.
- Azure service resources, payment credentials, webhook secret, domain, and any email/shipping integrations require owner-provided configuration.
- The implementation must not claim that production payments, delivery dates, email, live inventory, certifications, or deployments are operational until configured and verified.
