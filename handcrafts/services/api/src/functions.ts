import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import { createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { calculateTotals, canTransitionOrder, type OrderStatus } from "../../shared/src/commerce.js";
import { databaseConfigured, getPool } from "./lib/db.js";
import {
  clearCookie,
  constantTimeEqual,
  corsHeaders,
  isAllowedOrigin,
  json,
  rateLimit,
  readJson,
} from "./lib/http.js";
import {
  cartId,
  createSession,
  getSession,
  guestCartCookie,
  revokeSession,
  sessionCookie,
} from "./lib/session.js";

const scrypt = promisify(scryptCallback);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sessionRoutes = new Set([
  "cart", "cart-items", "cart-item", "signup", "signin", "signout", "account",
  "account-orders", "wishlist", "checkout", "order-lookup", "admin-summary",
  "admin-product-create", "admin-product-update", "admin-variant-create",
  "admin-product-image", "admin-inventory-adjust", "admin-order-update", "admin-media",
  "admin-categories", "admin-category-update", "admin-product-categories", "admin-orders",
]);

function configuredAmount(name: string, fallback = 0): number {
  const configured = process.env[name];
  if (!configured) return fallback;
  const amount = Number(configured);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return amount;
}

function shippingRule() {
  const rawThreshold = process.env.FREE_SHIPPING_THRESHOLD_PAISE;
  const threshold = rawThreshold ? configuredAmount("FREE_SHIPPING_THRESHOLD_PAISE", -1) : -1;
  return {
    flatRatePaise: configuredAmount("SHIPPING_FLAT_RATE_PAISE"),
    ...(threshold >= 0 ? { freeShippingThresholdPaise: threshold } : {}),
  };
}

function sessionSecretReady(): boolean {
  return Buffer.byteLength(process.env.SESSION_SECRET ?? "") >= 32;
}

function razorpayTestConfigurationReady(): boolean {
  return Boolean(
    process.env.RAZORPAY_KEY_ID?.startsWith("rzp_test_") &&
    process.env.RAZORPAY_KEY_SECRET &&
    process.env.RAZORPAY_WEBHOOK_SECRET &&
    sessionSecretReady(),
  );
}

type Handler = (
  request: HttpRequest,
  context: InvocationContext,
) => Promise<HttpResponseInit>;

function route(
  name: string,
  routeName: string,
  methods: ("GET" | "POST" | "PATCH" | "DELETE" | "OPTIONS")[],
  handler: Handler,
): void {
  app.http(name, {
    route: routeName,
    methods,
    authLevel: "anonymous",
    handler: async (request, context) => {
      const headers = corsHeaders(request);
      if (request.method === "OPTIONS") {
        return { status: 204, headers };
      }
      if (!isAllowedOrigin(request)) {
        return json(403, { error: "Origin is not allowed." });
      }
      if (!databaseConfigured() && !["health"].includes(name)) {
        return json(503, { error: "Store services are not configured." }, headers);
      }
      if (sessionRoutes.has(name) && !sessionSecretReady()) {
        return json(503, { error: "Session security is not configured." }, headers);
      }
      try {
        const result = await handler(request, context);
        return result;
      } catch (error) {
        context.error("Store API request failed", {
          route: routeName,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        return json(500, { error: "The request could not be completed." }, headers);
      }
    },
  });
}

function respond(
  request: HttpRequest,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return json(status, body, { ...corsHeaders(request), ...headers });
}

function getCartIdOrCreate(request: HttpRequest): { id: string; cookie: string | null } {
  const existing = cartId(request);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return { id: existing, cookie: null };
  const id = randomUUID();
  return { id, cookie: guestCartCookie(id) };
}

async function ensureCart(cart: { id: string; cookie: string | null }, userId?: string) {
  await getPool().query(
    `INSERT INTO carts (id, user_id, expires_at)
     VALUES ($1, $2, now() + interval '30 days')
     ON CONFLICT (id) DO UPDATE SET
       user_id = COALESCE(carts.user_id, EXCLUDED.user_id),
       expires_at = EXCLUDED.expires_at`,
    [cart.id, userId ?? null],
  );
}

async function getCartLines(id: string) {
  const result = await getPool().query(
    `SELECT p.id AS product_id, p.slug, p.name, p.price_paise, p.sale_price_paise,
            p.currency, p.status, v.id AS variant_id, v.label AS variant_label,
            i.available_quantity, ci.quantity, pi.url AS image_url
       FROM cart_items ci
       JOIN product_variants v ON v.id = ci.variant_id AND v.product_id = ci.product_id
       JOIN products p ON p.id = ci.product_id
       JOIN inventory i ON i.variant_id = v.id
       LEFT JOIN LATERAL (
         SELECT url FROM product_images WHERE product_id = p.id ORDER BY position LIMIT 1
       ) pi ON true
      WHERE ci.cart_id = $1 AND p.status = 'published' AND v.active = true
      ORDER BY ci.created_at`,
    [id],
  );
  return result.rows.map((row) => ({
    ...row,
    quantity: Number(row.quantity),
    available_quantity: Number(row.available_quantity),
    unit_price_paise: Number(row.sale_price_paise ?? row.price_paise),
  }));
}

route("health", "api/health", ["GET"], async (request) =>
  respond(request, 200, {
    status: "ok",
    databaseConfigured: databaseConfigured(),
    paymentsEnabled: databaseConfigured() && razorpayTestConfigurationReady(),
  }),
);

route("catalog", "api/products", ["GET"], async (request) => {
  const url = new URL(request.url);
  const search = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const category = (url.searchParams.get("category") ?? "").slice(0, 80);
  const sort = url.searchParams.get("sort") ?? "newest";
  const page = Math.min(1000, Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1));
  const limit = Math.min(48, Math.max(1, Number(url.searchParams.get("limit") ?? 24) || 24));
  const offset = (page - 1) * limit;
  const sortSql: Record<string, string> = {
    newest: "p.created_at DESC",
    "price-asc": "COALESCE(p.sale_price_paise, p.price_paise) ASC, p.name ASC",
    "price-desc": "COALESCE(p.sale_price_paise, p.price_paise) DESC, p.name ASC",
    bestsellers: `(SELECT COALESCE(sum(oi.quantity), 0)
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = p.id AND o.payment_status = 'paid') DESC, p.name ASC`,
  };
  const values: unknown[] = [];
  const conditions = ["p.status = 'published'"];
  if (search) {
    values.push(`%${search}%`);
    conditions.push(
      `(p.name ILIKE $${values.length} OR p.description ILIKE $${values.length}
        OR p.sku ILIKE $${values.length} OR p.metadata::text ILIKE $${values.length}
        OR EXISTS (
          SELECT 1 FROM product_categories pc JOIN categories c ON c.id = pc.category_id
          WHERE pc.product_id = p.id AND (c.name ILIKE $${values.length} OR c.slug ILIKE $${values.length})
        ))`,
    );
  }
  if (category) {
    values.push(category);
    conditions.push(`EXISTS (
      SELECT 1 FROM product_categories pc JOIN categories c ON c.id = pc.category_id
      WHERE pc.product_id = p.id AND c.slug = $${values.length} AND c.active = true
    )`);
  }
  const minPrice = url.searchParams.get("minPrice");
  const maxPrice = url.searchParams.get("maxPrice");
  for (const [label, value, operator] of [
    ["minPrice", minPrice, ">="],
    ["maxPrice", maxPrice, "<="],
  ] as const) {
    if (value !== null) {
      const rupees = Number(value);
      if (!Number.isFinite(rupees) || rupees < 0 || rupees > 10_000_000) {
        return respond(request, 400, { error: `Invalid ${label} filter.` });
      }
      values.push(Math.round(rupees * 100));
      conditions.push(`COALESCE(p.sale_price_paise, p.price_paise) ${operator} $${values.length}`);
    }
  }
  if (minPrice !== null && maxPrice !== null && Number(minPrice) > Number(maxPrice)) {
    return respond(request, 400, { error: "Minimum price cannot be greater than maximum price." });
  }
  if (url.searchParams.get("available") === "true") {
    conditions.push(`EXISTS (
      SELECT 1 FROM product_variants v JOIN inventory i ON i.variant_id = v.id
      WHERE v.product_id = p.id AND v.active = true AND i.available_quantity > 0
    )`);
  }
  const where = conditions.join(" AND ");
  const count = await getPool().query(
    `SELECT count(*)::int AS count FROM products p WHERE ${where}`,
    values,
  );
  values.push(limit, offset);
  const products = await getPool().query(
    `SELECT p.id, p.slug, p.name, p.short_description, p.price_paise,
            p.sale_price_paise, p.currency, p.sku,
            COALESCE((SELECT sum(i.available_quantity) FROM inventory i
              JOIN product_variants v ON v.id = i.variant_id
              WHERE v.product_id = p.id AND v.active = true), 0)::int AS available_quantity,
            (SELECT pi.url FROM product_images pi WHERE pi.product_id = p.id
              ORDER BY pi.position LIMIT 1) AS image_url
       FROM products p WHERE ${where}
      ORDER BY ${sortSql[sort] ?? sortSql.newest}
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return respond(request, 200, {
    items: products.rows,
    page,
    pageSize: limit,
    total: count.rows[0]?.count ?? 0,
  });
});

route("product", "api/products/{slug}", ["GET"], async (request) => {
  const slug = request.params.slug;
  const result = await getPool().query(
    `SELECT p.id, p.slug, p.name, p.description, p.short_description, p.price_paise,
            p.sale_price_paise, p.currency, p.sku, p.materials, p.dimensions,
            p.shipping_weight_grams, p.metadata,
            COALESCE((SELECT sum(i.available_quantity) FROM inventory i
              JOIN product_variants v ON v.id = i.variant_id
              WHERE v.product_id = p.id AND v.active = true), 0)::int AS available_quantity,
            COALESCE((SELECT json_agg(json_build_object(
              'id', v.id, 'label', v.label, 'sku', v.sku, 'availableQuantity', i.available_quantity
            ) ORDER BY v.created_at) FROM product_variants v
              JOIN inventory i ON i.variant_id = v.id
             WHERE v.product_id = p.id AND v.active = true), '[]'::json) AS variants,
            COALESCE((SELECT json_agg(json_build_object(
              'url', pi.url, 'altText', pi.alt_text, 'position', pi.position
            ) ORDER BY pi.position) FROM product_images pi WHERE pi.product_id = p.id), '[]'::json) AS images
       FROM products p WHERE p.slug = $1 AND p.status = 'published' LIMIT 1`,
    [slug],
  );
  if (!result.rows[0]) return respond(request, 404, { error: "Product not found." });
  return respond(request, 200, result.rows[0]);
});

route("categories", "api/categories", ["GET"], async (request) => {
  const result = await getPool().query(
    `SELECT c.id, c.slug, c.name, c.description,
            count(DISTINCT p.id)::int AS product_count
       FROM categories c
       JOIN product_categories pc ON pc.category_id = c.id
       JOIN products p ON p.id = pc.product_id AND p.status = 'published'
      WHERE c.active = true
      GROUP BY c.id
      HAVING count(DISTINCT p.id) > 0
      ORDER BY c.position, c.name`,
  );
  return respond(request, 200, result.rows);
});

route("cart", "api/cart", ["GET", "OPTIONS"], async (request) => {
  const cart = getCartIdOrCreate(request);
  await ensureCart(cart);
  const lines = (await getCartLines(cart.id)).map((line) => ({
    ...line,
    stock_warning: line.quantity > line.available_quantity,
  }));
  const billableLines = lines
    .filter((line) => line.available_quantity > 0)
    .map((line) => ({ ...line, quantity: Math.min(line.quantity, line.available_quantity) }));
  const totals = calculateTotals(
    billableLines.map((row) => ({
      productId: row.product_id,
      variantId: row.variant_id,
      title: row.name,
      variantLabel: row.variant_label ?? undefined,
      unitPricePaise: row.unit_price_paise,
      quantity: row.quantity,
      availableQuantity: row.available_quantity,
    })),
    shippingRule(),
    0,
    configuredAmount("TAX_RATE_BASIS_POINTS"),
  );
  return respond(request, 200, { items: lines, totals }, cart.cookie ? { "Set-Cookie": cart.cookie } : {});
});

route("cart-items", "api/cart/items", ["POST", "OPTIONS"], async (request, context) => {
  if (!rateLimit(request, context, "cart-write", 30)) {
    return respond(request, 429, { error: "Please wait before changing your cart." });
  }
  const body = await readJson<{ variantId?: string; quantity?: number }>(request);
  if (!body?.variantId || !Number.isInteger(body.quantity) || (body.quantity ?? 0) < 1 || (body.quantity ?? 0) > 20) {
    return respond(request, 400, { error: "Provide a variant and quantity from 1 to 20." });
  }
  const cart = getCartIdOrCreate(request);
  await ensureCart(cart);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const variant = await client.query(
      `SELECT v.id, v.product_id, i.available_quantity
         FROM product_variants v JOIN inventory i ON i.variant_id = v.id
         JOIN products p ON p.id = v.product_id
        WHERE v.id = $1 AND v.active = true AND p.status = 'published' FOR UPDATE OF i`,
      [body.variantId],
    );
    const priorQuantity = await client.query(
      "SELECT quantity FROM cart_items WHERE cart_id = $1 AND variant_id = $2 FOR UPDATE",
      [cart.id, body.variantId],
    );
    const requestedQuantity = Number(priorQuantity.rows[0]?.quantity ?? 0) + body.quantity!;
    if (
      !variant.rows[0] ||
      Number(variant.rows[0].available_quantity) < requestedQuantity ||
      requestedQuantity > 20
    ) {
      await client.query("ROLLBACK");
      return respond(request, 409, { error: "This option is unavailable in the requested quantity." });
    }
    await client.query(
      `INSERT INTO cart_items (cart_id, product_id, variant_id, quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cart_id, variant_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity`,
      [cart.id, variant.rows[0].product_id, body.variantId, body.quantity],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return respond(request, 200, { message: "Cart updated." }, cart.cookie ? { "Set-Cookie": cart.cookie } : {});
});

route("cart-item", "api/cart/items/{variantId}", ["PATCH", "DELETE", "OPTIONS"], async (request) => {
  const id = cartId(request);
  if (!id) return respond(request, 401, { error: "Cart session is missing." });
  if (request.method === "DELETE") {
    await getPool().query("DELETE FROM cart_items WHERE cart_id = $1 AND variant_id = $2", [id, request.params.variantId]);
    return respond(request, 204, null);
  }
  const body = await readJson<{ quantity?: number }>(request);
  if (!body || !Number.isInteger(body.quantity) || (body.quantity ?? 0) < 1 || (body.quantity ?? 0) > 20) {
    return respond(request, 400, { error: "Quantity must be between 1 and 20." });
  }
  const result = await getPool().query(
    `UPDATE cart_items ci SET quantity = $3
      FROM inventory i
      JOIN product_variants v ON v.id = i.variant_id AND v.active = true
      JOIN products p ON p.id = v.product_id AND p.status = 'published'
     WHERE ci.cart_id = $1 AND ci.variant_id = $2 AND i.variant_id = ci.variant_id
       AND i.available_quantity >= $3
     RETURNING ci.variant_id`,
    [id, request.params.variantId, body.quantity],
  );
  if (!result.rowCount) return respond(request, 409, { error: "Requested quantity is unavailable." });
  return respond(request, 200, { message: "Cart updated." });
});

route("signup", "api/account/signup", ["POST", "OPTIONS"], async (request, context) => {
  if (!rateLimit(request, context, "signup", 5)) return respond(request, 429, { error: "Try again later." });
  const body = await readJson<{ email?: string; password?: string; displayName?: string }>(request);
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;
  const displayName = body?.displayName?.trim();
  if (!email || !emailPattern.test(email) || email.length > 254 ||
      !password || password.length < 12 || password.length > 128 ||
      !displayName || displayName.length > 100) {
    return respond(request, 400, { error: "Enter a valid email, name, and a password of at least 12 characters." });
  }
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  try {
    const created = await getPool().query(
      `INSERT INTO users (email, display_name, password_hash, role)
       VALUES ($1, $2, $3, 'customer') RETURNING id`,
      [email, displayName, `${salt.toString("hex")}:${derived.toString("hex")}`],
    );
    const token = await createSession(created.rows[0].id);
    return respond(request, 201, { id: created.rows[0].id, email }, {
      "Set-Cookie": sessionCookie(token),
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return respond(request, 409, { error: "Unable to create this account." });
    throw error;
  }
});

route("signin", "api/account/signin", ["POST", "OPTIONS"], async (request, context) => {
  if (!rateLimit(request, context, "signin", 8)) return respond(request, 429, { error: "Try again later." });
  const body = await readJson<{ email?: string; password?: string }>(request);
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password;
  if (!email || !password || password.length > 128) return respond(request, 400, { error: "Email or password is invalid." });
  const result = await getPool().query(
    `SELECT id, email, password_hash FROM users WHERE email = $1 AND disabled_at IS NULL LIMIT 1`,
    [email],
  );
  const record = result.rows[0];
  const [saltHex, hashHex] = record
    ? String(record.password_hash).split(":")
    : ["00000000000000000000000000000000", "00".repeat(64)];
  const expected = Buffer.from(hashHex, "hex");
  const candidate = (await scrypt(password, Buffer.from(saltHex, "hex"), 64)) as Buffer;
  if (!record || expected.length !== candidate.length || !timingSafeEqual(expected, candidate)) {
    return respond(request, 401, { error: "Email or password is invalid." });
  }
  const token = await createSession(record.id);
  return respond(request, 200, { id: record.id, email: record.email }, { "Set-Cookie": sessionCookie(token) });
});

route("signout", "api/account/signout", ["POST", "OPTIONS"], async (request) => {
  await revokeSession(request);
  return respond(request, 204, null, { "Set-Cookie": clearCookie("store_session") });
});

route("account", "api/account", ["GET", "OPTIONS"], async (request) => {
  const user = await getSession(request);
  if (!user) return respond(request, 401, { error: "Sign in required." });
  return respond(request, 200, user);
});

route("account-orders", "api/account/orders", ["GET", "OPTIONS"], async (request) => {
  const user = await getSession(request);
  if (!user) return respond(request, 401, { error: "Sign in required." });
  const orders = await getPool().query(
    `SELECT order_number, status, payment_status, total_paise, currency, created_at
       FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [user.id],
  );
  return respond(request, 200, orders.rows);
});

route("wishlist", "api/account/wishlist", ["GET", "POST", "DELETE", "OPTIONS"], async (request) => {
  const user = await getSession(request);
  if (!user) return respond(request, 401, { error: "Sign in required." });
  if (request.method === "GET") {
    const items = await getPool().query(
      `SELECT p.id, p.slug, p.name, p.price_paise, p.sale_price_paise
         FROM wishlists w JOIN products p ON p.id = w.product_id
        WHERE w.user_id = $1 AND p.status = 'published' ORDER BY w.created_at DESC`,
      [user.id],
    );
    return respond(request, 200, items.rows);
  }
  const body = await readJson<{ productId?: string }>(request);
  if (!body?.productId) return respond(request, 400, { error: "Product identifier is required." });
  if (request.method === "DELETE") {
    await getPool().query("DELETE FROM wishlists WHERE user_id = $1 AND product_id = $2", [user.id, body.productId]);
  } else {
    const saved = await getPool().query(
      `INSERT INTO wishlists (user_id, product_id)
       SELECT $1, id FROM products WHERE id = $2 AND status = 'published'
       ON CONFLICT DO NOTHING RETURNING product_id`,
      [user.id, body.productId],
    );
    if (!saved.rowCount) {
      const exists = await getPool().query("SELECT 1 FROM products WHERE id = $1 AND status = 'published'", [body.productId]);
      if (!exists.rowCount) return respond(request, 404, { error: "Product not found." });
    }
  }
  return respond(request, 200, { saved: request.method !== "DELETE" });
});

route("checkout", "api/checkout", ["POST", "OPTIONS"], async (request, context) => {
  if (!rateLimit(request, context, "checkout", 5)) return respond(request, 429, { error: "Please wait before retrying checkout." });
  const razorpayConfigured = razorpayTestConfigurationReady();
  if (!razorpayConfigured) {
    return respond(request, 503, {
      code: "PAYMENTS_NOT_CONFIGURED",
      error: "Test checkout is unavailable until a Razorpay test key, secret, webhook secret and session secret are configured.",
    });
  }
  const body = await readJson<{
    email?: string;
    recipientName?: string;
    phone?: string;
    address?: { line1?: string; line2?: string; locality?: string; city?: string; state?: string; postalCode?: string };
    termsAccepted?: boolean;
  }>(request);
  const email = body?.email?.trim().toLowerCase();
  const address = body?.address;
  if (
    !email || !emailPattern.test(email) || email.length > 254 ||
    !body?.recipientName?.trim() || body.recipientName.length > 100 ||
    !body.phone || !/^(?:\+91[- ]?)?[6-9]\d{9}$/.test(body.phone.trim()) ||
    !address?.line1?.trim() || !address.city?.trim() || !address.state?.trim() ||
    !/^\d{6}$/.test(address.postalCode ?? "") || !body.termsAccepted
  ) {
    return respond(request, 400, { error: "Review the required contact, address, and policy acknowledgement fields." });
  }
  const currentCart = cartId(request);
  if (!currentCart) return respond(request, 400, { error: "Your cart is empty." });
  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!/^[a-zA-Z0-9_-]{16,120}$/.test(idempotencyKey)) {
    return respond(request, 400, { error: "A valid checkout request identifier is required." });
  }
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ email, recipientName: body.recipientName.trim(), phone: body.phone.replace(/\D/g, "").slice(-10), address }))
    .digest("hex");
  const sessionUser = await getSession(request);

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const previous = await client.query(
      `SELECT o.id, o.order_number, o.checkout_fingerprint, p.provider_order_id,
              p.amount_paise, p.currency, p.status AS payment_status
         FROM orders o LEFT JOIN payments p ON p.order_id = o.id
        WHERE o.idempotency_key = $1 LIMIT 1`,
      [idempotencyKey],
    );
    if (previous.rows[0]) {
      if (previous.rows[0].checkout_fingerprint !== fingerprint) {
        await client.query("ROLLBACK");
        return respond(request, 409, { error: "This checkout request identifier was already used." });
      }
      await client.query("COMMIT");
      const accessToken = createHmac("sha256", process.env.SESSION_SECRET!)
        .update(`${previous.rows[0].id}:${idempotencyKey}`)
        .digest("base64url");
      return respond(request, 200, {
        orderNumber: previous.rows[0].order_number,
        providerOrderId: previous.rows[0].provider_order_id,
        amountPaise: Number(previous.rows[0].amount_paise),
        currency: previous.rows[0].currency,
        keyId: process.env.RAZORPAY_KEY_ID,
        accessToken,
        paymentStatus: previous.rows[0].payment_status ?? "pending",
        message: "Existing checkout request returned; payment is not confirmed.",
      });
    }
    const lines = await client.query(
      `SELECT p.id AS product_id, v.id AS variant_id, p.name, v.label,
              COALESCE(p.sale_price_paise, p.price_paise) AS unit_price_paise,
              ci.quantity, i.available_quantity
         FROM cart_items ci
         JOIN products p ON p.id = ci.product_id AND p.status = 'published'
         JOIN product_variants v ON v.id = ci.variant_id AND v.product_id = p.id AND v.active = true
         JOIN inventory i ON i.variant_id = v.id
        WHERE ci.cart_id = $1
        ORDER BY v.id
        FOR UPDATE OF i`,
      [currentCart],
    );
    if (!lines.rowCount) {
      await client.query("ROLLBACK");
      return respond(request, 400, { error: "Your cart is empty or contains unavailable products." });
    }
    const totals = calculateTotals(
      lines.rows.map((row) => ({
        productId: row.product_id,
        variantId: row.variant_id,
        title: row.name,
        variantLabel: row.label ?? undefined,
        unitPricePaise: Number(row.unit_price_paise),
        quantity: Number(row.quantity),
        availableQuantity: Number(row.available_quantity),
      })),
      shippingRule(),
      0,
      configuredAmount("TAX_RATE_BASIS_POINTS"),
    );
    if (totals.totalPaise < 1 || totals.totalPaise > 10_000_000) {
      await client.query("ROLLBACK");
      return respond(request, 400, { error: "Order amount is outside the supported range." });
    }
    for (const line of lines.rows) {
      const reserved = await client.query(
        `UPDATE inventory SET available_quantity = available_quantity - $2,
              reserved_quantity = reserved_quantity + $2, updated_at = now()
          WHERE variant_id = $1 AND available_quantity >= $2 RETURNING variant_id`,
        [line.variant_id, line.quantity],
      );
      if (!reserved.rowCount) throw new Error("Inventory changed during checkout.");
    }
    const orderResult = await client.query(
      `INSERT INTO orders
         (order_number, user_id, email, recipient_name, phone, address_json, status,
          payment_status, subtotal_paise, shipping_paise, discount_paise, tax_paise,
          total_paise, currency, idempotency_key, checkout_fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6, 'placed', 'pending',
          $7, $8, $9, $10, $11, 'INR', $12, $13) RETURNING id, order_number`,
      [
        `KC-${randomBytes(6).toString("hex").toUpperCase()}`,
        sessionUser?.id ?? null,
        email,
        body.recipientName.trim(),
        body.phone.replace(/\D/g, "").slice(-10),
        JSON.stringify(address),
        totals.subtotalPaise,
        totals.shippingPaise,
        totals.discountPaise,
        totals.taxPaise,
        totals.totalPaise,
        idempotencyKey,
        fingerprint,
      ],
    );
    const order = orderResult.rows[0];
    for (const line of lines.rows) {
      await client.query(
        `INSERT INTO order_items
           (order_id, product_id, variant_id, product_name, variant_label, sku,
            quantity, unit_price_paise, line_total_paise)
         SELECT $1, p.id, v.id, p.name, v.label, v.sku, $4, $5, $4 * $5
           FROM products p JOIN product_variants v ON v.product_id = p.id
          WHERE p.id = $2 AND v.id = $3`,
        [order.id, line.product_id, line.variant_id, line.quantity, line.unit_price_paise],
      );
    }

    const keyId = process.env.RAZORPAY_KEY_ID!;
    const keySecret = process.env.RAZORPAY_KEY_SECRET!;
    const authorization = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const providerResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: totals.totalPaise,
        currency: "INR",
        receipt: order.order_number,
        notes: { internal_order_id: order.id },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!providerResponse.ok) throw new Error("Razorpay order creation failed.");
    const providerOrder = (await providerResponse.json()) as { id: string };
    await client.query(
      `INSERT INTO payments (order_id, provider, provider_order_id, amount_paise, currency, status)
       VALUES ($1, 'razorpay', $2, $3, 'INR', 'pending')`,
      [order.id, providerOrder.id, totals.totalPaise],
    );
    const accessToken = createHmac("sha256", process.env.SESSION_SECRET!)
      .update(`${order.id}:${idempotencyKey}`)
      .digest("base64url");
    await client.query(
      `INSERT INTO order_access_tokens (token_hash, order_id, expires_at)
       VALUES ($1, $2, now() + interval '30 days')`,
      [createHash("sha256").update(accessToken).digest("hex"), order.id],
    );
    await client.query(
      `INSERT INTO inventory_movements (variant_id, quantity_delta, movement_type, reference_id, reason)
       SELECT variant_id, -quantity, 'reservation', $1, 'Checkout reservation'
       FROM order_items WHERE order_id = $1`,
      [order.id],
    );
    await client.query("DELETE FROM cart_items WHERE cart_id = $1", [currentCart]);
    await client.query("COMMIT");
    return respond(request, 201, {
      orderNumber: order.order_number,
      providerOrderId: providerOrder.id,
      amountPaise: totals.totalPaise,
      currency: "INR",
      keyId,
      accessToken,
      paymentStatus: "pending",
      message: "Order reserved; payment remains pending until server verification.",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      const previous = await getPool().query(
        `SELECT o.id, o.order_number, o.checkout_fingerprint, p.provider_order_id, p.amount_paise, p.status AS payment_status
           FROM orders o LEFT JOIN payments p ON p.order_id = o.id
          WHERE o.idempotency_key = $1 LIMIT 1`,
        [idempotencyKey],
      );
      if (previous.rows[0]?.checkout_fingerprint === fingerprint) {
        const accessToken = createHmac("sha256", process.env.SESSION_SECRET!)
          .update(`${previous.rows[0].id}:${idempotencyKey}`)
          .digest("base64url");
        return respond(request, 200, {
          orderNumber: previous.rows[0].order_number,
          providerOrderId: previous.rows[0].provider_order_id,
          amountPaise: Number(previous.rows[0].amount_paise),
          currency: "INR",
          keyId: process.env.RAZORPAY_KEY_ID,
          accessToken,
          paymentStatus: previous.rows[0].payment_status ?? "pending",
        });
      }
    }
    context.warn("Checkout transaction rolled back", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return respond(request, 502, { error: "Checkout could not be completed. Your cart has not been charged." });
  } finally {
    client.release();
  }
});

route("razorpay-verify", "api/payments/razorpay/verify", ["POST", "OPTIONS"], async (request, context) => {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret || !razorpayTestConfigurationReady()) {
    return respond(request, 503, { error: "Razorpay test payment verification is not configured." });
  }
  if (!rateLimit(request, context, "payment-verify", 20)) return respond(request, 429, { error: "Please wait before retrying verification." });
  const body = await readJson<{ razorpayOrderId?: string; razorpayPaymentId?: string; razorpaySignature?: string }>(request);
  if (!body?.razorpayOrderId || !body.razorpayPaymentId || !body.razorpaySignature) {
    return respond(request, 400, { error: "Payment verification details are incomplete." });
  }
  const expected = createHmac("sha256", keySecret)
    .update(`${body.razorpayOrderId}|${body.razorpayPaymentId}`)
    .digest("hex");
  if (!constantTimeEqual(body.razorpaySignature, expected)) {
    return respond(request, 401, { error: "Payment signature could not be verified." });
  }
  if (!/^order_[a-zA-Z0-9]+$/.test(body.razorpayOrderId) ||
      !/^pay_[a-zA-Z0-9]+$/.test(body.razorpayPaymentId) ||
      !/^[a-f0-9]{64}$/i.test(body.razorpaySignature)) {
    return respond(request, 400, { error: "Payment verification identifiers are invalid." });
  }
  const storedPayment = await getPool().query(
    `SELECT amount_paise, currency, status FROM payments WHERE provider_order_id = $1 LIMIT 1`,
    [body.razorpayOrderId],
  );
  if (!storedPayment.rows[0]) return respond(request, 404, { error: "Payment order not found." });
  const authorization = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${keySecret}`).toString("base64");
  let providerPayment: { id?: string; order_id?: string; status?: string; amount?: number; currency?: string };
  try {
    const providerResponse = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(body.razorpayPaymentId)}`,
      {
        headers: { Authorization: `Basic ${authorization}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!providerResponse.ok) return respond(request, 502, { error: "Payment status is temporarily unavailable; no payment state was changed." });
    providerPayment = await providerResponse.json() as typeof providerPayment;
  } catch {
    return respond(request, 502, { error: "Payment status is temporarily unavailable; no payment state was changed." });
  }
  if (
    providerPayment.id !== body.razorpayPaymentId ||
    providerPayment.order_id !== body.razorpayOrderId ||
    providerPayment.amount !== Number(storedPayment.rows[0].amount_paise) ||
    providerPayment.currency !== storedPayment.rows[0].currency
  ) {
    return respond(request, 409, { error: "Payment details do not match this order." });
  }
  if (providerPayment.status !== "captured") {
    return respond(request, 202, {
      verified: false,
      paymentStatus: providerPayment.status ?? "pending",
      message: "Payment has not been captured. The order remains pending.",
    });
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const payment = await client.query(
      `SELECT id, order_id, status FROM payments WHERE provider_order_id = $1 FOR UPDATE`,
      [body.razorpayOrderId],
    );
    if (!payment.rows[0]) {
      await client.query("ROLLBACK");
      return respond(request, 404, { error: "Payment order not found." });
    }
    if (payment.rows[0].status === "failed" || payment.rows[0].status === "refunded") {
      await client.query("ROLLBACK");
      return respond(request, 409, { error: "Payment is not in a verifiable state." });
    }
    if (payment.rows[0].status !== "paid") {
      const updated = await client.query(
        `UPDATE payments SET status = 'paid', provider_payment_id = $2, updated_at = now()
          WHERE id = $1 AND status = 'pending' RETURNING order_id`,
        [payment.rows[0].id, body.razorpayPaymentId],
      );
      if (updated.rowCount) {
        await client.query(
          `UPDATE orders SET payment_status = 'paid', updated_at = now() WHERE id = $1`,
          [payment.rows[0].order_id],
        );
        await client.query(
          `UPDATE inventory i SET reserved_quantity = GREATEST(0, reserved_quantity - oi.quantity),
                sold_quantity = sold_quantity + oi.quantity, updated_at = now()
             FROM order_items oi WHERE oi.order_id = $1 AND oi.variant_id = i.variant_id`,
          [payment.rows[0].order_id],
        );
        await client.query(
          `INSERT INTO inventory_movements (variant_id, quantity_delta, movement_type, reference_id, reason)
           SELECT variant_id, quantity, 'sale', $1, 'Verified Razorpay payment'
             FROM order_items WHERE order_id = $1`,
          [payment.rows[0].order_id],
        );
      }
    }
    await client.query("COMMIT");
    return respond(request, 200, { verified: true, paymentStatus: "paid" });
  } catch {
    await client.query("ROLLBACK");
    return respond(request, 500, { error: "Payment status could not be updated." });
  } finally {
    client.release();
  }
});

route("razorpay-webhook", "api/payments/razorpay/webhook", ["POST", "OPTIONS"], async (request) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !razorpayTestConfigurationReady()) {
    return respond(request, 503, { error: "Razorpay test payment webhooks are not configured." });
  }
  const rawBody = await request.text();
  if (rawBody.length > 256_000) return respond(request, 413, { error: "Webhook is too large." });
  const provided = request.headers.get("x-razorpay-signature") ?? "";
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!constantTimeEqual(provided, expected)) return respond(request, 401, { error: "Invalid webhook signature." });
  const eventId = request.headers.get("x-razorpay-event-id");
  if (!eventId || eventId.length > 200) return respond(request, 400, { error: "Missing event identifier." });
  const event = JSON.parse(rawBody) as {
    event?: string;
    payload?: { payment?: { entity?: { order_id?: string; id?: string; amount?: number; currency?: string } } };
  };
  const providerOrderId = event.payload?.payment?.entity?.order_id;
  if (!providerOrderId || !["payment.captured", "payment.failed"].includes(event.event ?? "")) {
    return respond(request, 200, { received: true });
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO payment_webhook_events (provider_event_id, event_type, received_at)
       VALUES ($1, $2, now()) ON CONFLICT DO NOTHING RETURNING provider_event_id`,
      [eventId, event.event],
    );
    if (!inserted.rowCount) {
      await client.query("COMMIT");
      return respond(request, 200, { received: true, duplicate: true });
    }
    const payment = await client.query(
      `SELECT id, order_id, status, amount_paise, currency
         FROM payments WHERE provider_order_id = $1 FOR UPDATE`,
      [providerOrderId],
    );
    if (!payment.rows[0]) {
      await client.query("ROLLBACK");
      return respond(request, 404, { error: "Payment order not found." });
    }
    const providerEvent = event.payload?.payment?.entity;
    if (
      (providerEvent?.amount !== undefined &&
        Number(providerEvent.amount) !== Number(payment.rows[0].amount_paise)) ||
      (providerEvent?.currency !== undefined &&
        providerEvent.currency !== payment.rows[0].currency)
    ) {
      await client.query("ROLLBACK");
      return respond(request, 409, { error: "Webhook payment amount or currency does not match the order." });
    }
    const success = event.event === "payment.captured";
    const nextStatus = success ? "paid" : "failed";
    const updated = await client.query(
      `UPDATE payments SET status = $2, provider_payment_id = $3, updated_at = now()
        WHERE id = $1 AND status = 'pending' RETURNING order_id`,
      [payment.rows[0].id, nextStatus, event.payload?.payment?.entity?.id ?? null],
    );
    if (updated.rowCount) {
      if (success) {
        await client.query(
          `UPDATE orders SET payment_status = 'paid', updated_at = now() WHERE id = $1`,
          [payment.rows[0].order_id],
        );
        await client.query(
          `UPDATE inventory i SET reserved_quantity = GREATEST(0, reserved_quantity - oi.quantity),
                sold_quantity = sold_quantity + oi.quantity, updated_at = now()
             FROM order_items oi WHERE oi.order_id = $1 AND oi.variant_id = i.variant_id`,
          [payment.rows[0].order_id],
        );
        await client.query(
          `INSERT INTO inventory_movements (variant_id, quantity_delta, movement_type, reference_id, reason)
           SELECT variant_id, quantity, 'sale', $1, 'Verified Razorpay webhook'
             FROM order_items WHERE order_id = $1`,
          [payment.rows[0].order_id],
        );
      } else {
        await client.query(
          `UPDATE orders SET payment_status = 'failed', updated_at = now() WHERE id = $1`,
          [payment.rows[0].order_id],
        );
        await client.query(
          `UPDATE inventory i SET reserved_quantity = GREATEST(0, reserved_quantity - oi.quantity),
                available_quantity = available_quantity + oi.quantity, updated_at = now()
             FROM order_items oi WHERE oi.order_id = $1 AND oi.variant_id = i.variant_id`,
          [payment.rows[0].order_id],
        );
        await client.query(
          `INSERT INTO inventory_movements (variant_id, quantity_delta, movement_type, reference_id, reason)
           SELECT variant_id, quantity, 'release', $1, 'Razorpay payment failed'
             FROM order_items WHERE order_id = $1`,
          [payment.rows[0].order_id],
        );
      }
    }
    await client.query("COMMIT");
    return respond(request, 200, { received: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

route("order-lookup", "api/orders/{orderNumber}", ["GET", "OPTIONS"], async (request) => {
  const user = await getSession(request);
  const accessToken = new URL(request.url).searchParams.get("access");
  if (!user && !accessToken) return respond(request, 401, { error: "Sign in or use your private order access link." });
  const order = await getPool().query(
    `SELECT id, order_number, email, status, payment_status, total_paise, currency,
            address_json, created_at
       FROM orders WHERE order_number = $1 LIMIT 1`,
    [request.params.orderNumber],
  );
  if (!order.rows[0]) return respond(request, 404, { error: "Order not found." });
  if (user && order.rows[0].email !== user.email) return respond(request, 404, { error: "Order not found." });
  if (!user) {
    const tokenHash = createHash("sha256").update(accessToken!).digest("hex");
    const access = await getPool().query(
      "SELECT order_id FROM order_access_tokens WHERE token_hash = $1 AND expires_at > now()",
      [tokenHash],
    );
    if (access.rows[0]?.order_id !== order.rows[0].id) return respond(request, 404, { error: "Order not found." });
  }
  const items = await getPool().query(
    `SELECT product_name, variant_label, quantity, unit_price_paise, line_total_paise
       FROM order_items WHERE order_id = $1 ORDER BY created_at`,
    [order.rows[0].id],
  );
  return respond(request, 200, { ...order.rows[0], items: items.rows });
});

route("admin-summary", "api/admin/summary", ["GET", "OPTIONS"], async (request) => {
  const user = await getSession(request);
  if (!user || user.role !== "admin") return respond(request, 403, { error: "Administrator access required." });
  const result = await getPool().query(
    `SELECT
       (SELECT count(*)::int FROM orders) AS orders,
       (SELECT count(*)::int FROM orders
         WHERE status IN ('placed', 'processing') AND payment_status = 'paid') AS awaiting_fulfillment,
       (SELECT COALESCE(sum(total_paise), 0)::bigint FROM orders WHERE payment_status = 'paid') AS confirmed_revenue_paise,
       (SELECT count(*)::int FROM inventory WHERE available_quantity <= 5) AS low_stock_variants`,
  );
  return respond(request, 200, result.rows[0]);
});

route("admin-orders", "api/admin/orders", ["GET", "OPTIONS"], async (request) => {
  const user = await getSession(request);
  if (!user || user.role !== "admin") return respond(request, 403, { error: "Administrator access required." });
  const url = new URL(request.url);
  const search = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const status = url.searchParams.get("status");
  const paymentStatus = url.searchParams.get("paymentStatus");
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (search) {
    values.push(`%${search}%`);
    conditions.push(`(o.order_number ILIKE $${values.length} OR o.email ILIKE $${values.length})`);
  }
  if (status && ["placed", "processing", "packed", "shipped", "delivered", "cancelled"].includes(status)) {
    values.push(status);
    conditions.push(`o.status = $${values.length}`);
  }
  if (paymentStatus && ["pending", "paid", "failed", "refund_pending", "refunded"].includes(paymentStatus)) {
    values.push(paymentStatus);
    conditions.push(`o.payment_status = $${values.length}`);
  }
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
  values.push(limit);
  const orders = await getPool().query(
    `SELECT o.order_number, o.email, o.status, o.payment_status, o.total_paise,
            o.currency, o.created_at, sr.carrier, sr.tracking_number, sr.tracking_url
       FROM orders o LEFT JOIN shipping_records sr ON sr.order_id = o.id
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY o.created_at DESC LIMIT $${values.length}`,
    values,
  );
  return respond(request, 200, orders.rows);
});

route("admin-categories", "api/admin/categories", ["GET", "POST", "OPTIONS"], async (request) => {
  const user = await getSession(request);
  if (!user || user.role !== "admin") return respond(request, 403, { error: "Administrator access required." });
  if (request.method === "GET") {
    const categories = await getPool().query(
      `SELECT id, slug, name, description, image_url, position, active
         FROM categories ORDER BY position, name`,
    );
    return respond(request, 200, categories.rows);
  }
  const body = await readJson<{ name?: string; slug?: string; description?: string; position?: number }>(request);
  if (!body?.name?.trim() || body.name.length > 120 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug ?? "") ||
      !Number.isInteger(body.position ?? 0) || Math.abs(body.position ?? 0) > 100_000) {
    return respond(request, 400, { error: "A category name, URL slug and valid display position are required." });
  }
  try {
    const created = await getPool().query(
      `INSERT INTO categories (name, slug, description, position)
       VALUES ($1, $2, $3, $4) RETURNING id, slug, name, active`,
      [body.name.trim(), body.slug, body.description ?? "", body.position ?? 0],
    );
    await getPool().query(
      `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id)
       VALUES ($1, 'category.created', 'category', $2)`,
      [user.id, created.rows[0].id],
    );
    return respond(request, 201, created.rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return respond(request, 409, { error: "A category with this slug already exists." });
    throw error;
  }
});

route("admin-category-update", "api/admin/categories/{categoryId}", ["PATCH", "OPTIONS"], async (request) => {
  const user = await getSession(request);
  if (!user || user.role !== "admin") return respond(request, 403, { error: "Administrator access required." });
  const body = await readJson<{
    name?: string; slug?: string; description?: string; position?: number; active?: boolean;
  }>(request);
  if (!body || (body.name !== undefined && (!body.name.trim() || body.name.length > 120)) ||
      (body.slug !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug)) ||
      (body.position !== undefined && (!Number.isInteger(body.position) || Math.abs(body.position) > 100_000)) ||
      (body.active !== undefined && typeof body.active !== "boolean")) {
    return respond(request, 400, { error: "Category update is invalid." });
  }
  const updated = await getPool().query(
    `UPDATE categories SET name = COALESCE($2, name), slug = COALESCE($3, slug),
       description = COALESCE($4, description), position = COALESCE($5, position),
       active = COALESCE($6, active), updated_at = now()
     WHERE id = $1 RETURNING id, slug, name, active`,
    [request.params.categoryId, body.name?.trim() ?? null, body.slug ?? null,
      body.description ?? null, body.position ?? null, body.active ?? null],
  );
  if (!updated.rowCount) return respond(request, 404, { error: "Category not found." });
  await getPool().query(
    `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id)
     VALUES ($1, 'category.updated', 'category', $2)`,
    [user.id, request.params.categoryId],
  );
  return respond(request, 200, updated.rows[0]);
});

route("admin-product-categories", "api/admin/products/{productId}/categories", ["PATCH", "OPTIONS"], async (request) => {
  const user = await getSession(request);
  if (!user || user.role !== "admin") return respond(request, 403, { error: "Administrator access required." });
  const body = await readJson<{ categoryIds?: string[] }>(request);
  if (!body || !Array.isArray(body.categoryIds) || body.categoryIds.length > 50 ||
      body.categoryIds.some((id) => typeof id !== "string")) {
    return respond(request, 400, { error: "Provide a valid category list." });
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const product = await client.query("SELECT id FROM products WHERE id = $1 FOR UPDATE", [request.params.productId]);
    if (!product.rowCount) {
      await client.query("ROLLBACK");
      return respond(request, 404, { error: "Product not found." });
    }
    const valid = await client.query(
      "SELECT id FROM categories WHERE id = ANY($1::uuid[]) AND active = true",
      [body.categoryIds],
    );
    if (valid.rowCount !== new Set(body.categoryIds).size) {
      await client.query("ROLLBACK");
      return respond(request, 400, { error: "One or more categories are missing or inactive." });
    }
    await client.query("DELETE FROM product_categories WHERE product_id = $1", [request.params.productId]);
    for (const categoryId of body.categoryIds) {
      await client.query(
        "INSERT INTO product_categories (product_id, category_id) VALUES ($1, $2)",
        [request.params.productId, categoryId],
      );
    }
    await client.query(
      `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id)
       VALUES ($1, 'product.categories_updated', 'product', $2)`,
      [user.id, request.params.productId],
    );
    await client.query("COMMIT");
    return respond(request, 200, { updated: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

route("admin-product-create", "api/admin/products", ["POST", "OPTIONS"], async (request) => {
  const user = await getSession(request);
  if (!user || user.role !== "admin") return respond(request, 403, { error: "Administrator access required." });
  const body = await readJson<{
    name?: string; slug?: string; description?: string; sku?: string;
    pricePaise?: number;
  }>(request);
  if (!body?.name?.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug ?? "") ||
      !Number.isSafeInteger(body.pricePaise) || (body.pricePaise ?? 0) < 0 || (body.pricePaise ?? 0) > 10_000_000) {
    return respond(request, 400, { error: "Name, URL slug, and valid price are required." });
  }
  const created = await getPool().query(
    `INSERT INTO products (name, slug, description, sku, price_paise, status)
     VALUES ($1, $2, $3, $4, $5, 'draft') RETURNING id, slug, status`,
    [body.name.trim(), body.slug, body.description ?? "", body.sku ?? null, body.pricePaise],
  );
  await getPool().query(
    `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id)
     VALUES ($1, 'product.created', 'product', $2)`,
    [user.id, created.rows[0].id],
  );
  return respond(request, 201, created.rows[0]);
});

route("admin-product-update", "api/admin/products/{productId}", ["PATCH", "OPTIONS"], async (request) => {
  const user = await getSession(request);
  if (!user || user.role !== "admin") return respond(request, 403, { error: "Administrator access required." });
  const body = await readJson<{
    name?: string; description?: string; pricePaise?: number; salePricePaise?: number | null;
    status?: "draft" | "published" | "archived"; featured?: boolean;
  }>(request);
  if (!body || (body.name !== undefined && !body.name.trim()) ||
      (body.pricePaise !== undefined && (!Number.isSafeInteger(body.pricePaise) || body.pricePaise < 0)) ||
      (body.salePricePaise !== undefined && body.salePricePaise !== null &&
        (!Number.isSafeInteger(body.salePricePaise) || body.salePricePaise < 0 ||
          (body.pricePaise !== undefined && body.salePricePaise > body.pricePaise)))) {
    return respond(request, 400, { error: "Product fields are invalid." });
  }
  if (body.status === "published") {
    const ready = await getPool().query(
      `SELECT 1 FROM products p WHERE p.id = $1
        AND EXISTS (SELECT 1 FROM product_variants v JOIN inventory i ON i.variant_id = v.id
                     WHERE v.product_id = p.id AND v.active = true)
        AND EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id)`,
      [request.params.productId],
    );
    if (!ready.rowCount) return respond(request, 409, { error: "Add at least one active variant and product image before publishing." });
  }
  const result = await getPool().query(
    `UPDATE products SET
       name = COALESCE($2, name),
       description = COALESCE($3, description),
       price_paise = COALESCE($4, price_paise),
       sale_price_paise = CASE WHEN $5::boolean THEN $6 ELSE sale_price_paise END,
       status = COALESCE($7::product_status, status),
       featured = COALESCE($8, featured),
       published_at = CASE WHEN $7 = 'published' THEN COALESCE(published_at, now()) ELSE published_at END,
       updated_at = now()
     WHERE id = $1 RETURNING id, slug, status`,
    [
      request.params.productId,
      body.name?.trim() ?? null,
      body.description ?? null,
      body.pricePaise ?? null,
      body.salePricePaise !== undefined,
      body.salePricePaise ?? null,
      body.status ?? null,
      body.featured ?? null,
    ],
  );
  if (!result.rowCount) return respond(request, 404, { error: "Product not found." });
  await getPool().query(
    `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id)
     VALUES ($1, 'product.updated', 'product', $2)`,
    [user.id, request.params.productId],
  );
  return respond(request, 200, result.rows[0]);
});

route("admin-variant-create", "api/admin/products/{productId}/variants", ["POST", "OPTIONS"], async (request) => {
  const user = await getSession(request);
  if (!user || user.role !== "admin") return respond(request, 403, { error: "Administrator access required." });
  const body = await readJson<{ label?: string; sku?: string; quantity?: number }>(request);
  if (!body?.label?.trim() || body.label.length > 120 || !Number.isInteger(body.quantity) ||
      (body.quantity ?? -1) < 0 || (body.quantity ?? 0) > 1_000_000) {
    return respond(request, 400, { error: "Variant label and a valid non-negative stock quantity are required." });
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const variant = await client.query(
      `INSERT INTO product_variants (product_id, label, sku)
       SELECT id, $2, $3 FROM products WHERE id = $1
       RETURNING id`,
      [request.params.productId, body.label.trim(), body.sku?.trim() || null],
    );
    if (!variant.rowCount) {
      await client.query("ROLLBACK");
      return respond(request, 404, { error: "Product not found." });
    }
    await client.query(
      `INSERT INTO inventory (variant_id, available_quantity) VALUES ($1, $2)`,
      [variant.rows[0].id, body.quantity],
    );
    await client.query(
      `INSERT INTO inventory_movements (variant_id, quantity_delta, movement_type, reason, actor_user_id)
       VALUES ($1, $2, 'opening', 'Admin stock entry', $3)`,
      [variant.rows[0].id, body.quantity, user.id],
    );
    await client.query(
      `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id)
       VALUES ($1, 'variant.created', 'variant', $2)`,
      [user.id, variant.rows[0].id],
    );
    await client.query("COMMIT");
    return respond(request, 201, { id: variant.rows[0].id });
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") return respond(request, 409, { error: "This SKU or variant already exists." });
    throw error;
  } finally {
    client.release();
  }
});

route("admin-product-image", "api/admin/products/{productId}/images", ["POST", "OPTIONS"], async (request) => {
  const user = await getSession(request);
  if (!user || user.role !== "admin") return respond(request, 403, { error: "Administrator access required." });
  const body = await readJson<{ blobName?: string; altText?: string; position?: number }>(request);
  if (!body?.blobName || !/^[a-f0-9]{36}\.(jpg|png|webp)$/.test(body.blobName) ||
      !body.altText?.trim() || body.altText.length > 240 ||
      !Number.isInteger(body.position ?? 0) || (body.position ?? 0) < 0) {
    return respond(request, 400, { error: "A valid uploaded image name, descriptive alt text and position are required." });
  }
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) return respond(request, 503, { error: "Azure Blob Storage is not configured." });
  const containerName = process.env.AZURE_STORAGE_CONTAINER ?? "product-media";
  const service = BlobServiceClient.fromConnectionString(connectionString);
  const container = service.getContainerClient(containerName);
  const blob = container.getBlockBlobClient(body.blobName);
  if (!(await blob.exists())) return respond(request, 404, { error: "Uploaded image was not found." });
  const result = await getPool().query(
    `INSERT INTO product_images (product_id, url, blob_name, alt_text, position)
     SELECT id, $2, $3, $4, $5 FROM products WHERE id = $1 RETURNING id`,
    [request.params.productId, blob.url, body.blobName, body.altText.trim(), body.position ?? 0],
  );
  if (!result.rowCount) return respond(request, 404, { error: "Product not found." });
  await getPool().query(
    `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id)
     VALUES ($1, 'product.image_added', 'product', $2)`,
    [user.id, request.params.productId],
  );
  return respond(request, 201, { id: result.rows[0].id });
});

route("admin-inventory-adjust", "api/admin/inventory/{variantId}", ["PATCH", "OPTIONS"], async (request) => {
  const user = await getSession(request);
  if (!user || user.role !== "admin") return respond(request, 403, { error: "Administrator access required." });
  const body = await readJson<{ adjustment?: number; reason?: string }>(request);
  if (!body || !Number.isInteger(body.adjustment) || body.adjustment === 0 ||
      Math.abs(body.adjustment ?? 0) > 1_000_000 || !body.reason?.trim() || body.reason.length > 300) {
    return respond(request, 400, { error: "A non-zero stock adjustment and reason are required." });
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const adjusted = await client.query(
      `UPDATE inventory SET available_quantity = available_quantity + $2, updated_at = now()
        WHERE variant_id = $1 AND available_quantity + $2 >= 0
        RETURNING available_quantity`,
      [request.params.variantId, body.adjustment],
    );
    if (!adjusted.rowCount) {
      await client.query("ROLLBACK");
      return respond(request, 409, { error: "Inventory adjustment would make stock negative or the variant does not exist." });
    }
    await client.query(
      `INSERT INTO inventory_movements (variant_id, quantity_delta, movement_type, reason, actor_user_id)
       VALUES ($1, $2, 'adjustment', $3, $4)`,
      [request.params.variantId, body.adjustment, body.reason.trim(), user.id],
    );
    await client.query(
      `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id)
       VALUES ($1, 'inventory.adjusted', 'variant', $2)`,
      [user.id, request.params.variantId],
    );
    await client.query("COMMIT");
    return respond(request, 200, { availableQuantity: adjusted.rows[0].available_quantity });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

route("admin-order-update", "api/admin/orders/{orderNumber}", ["PATCH", "OPTIONS"], async (request) => {
  const user = await getSession(request);
  if (!user || user.role !== "admin") return respond(request, 403, { error: "Administrator access required." });
  const body = await readJson<{
    status?: OrderStatus; carrier?: string; trackingNumber?: string; trackingUrl?: string;
  }>(request);
  if (!body || (body.status && !["placed", "processing", "packed", "shipped", "delivered", "cancelled"].includes(body.status)) ||
      (body.trackingUrl && !/^https:\/\/\S+$/i.test(body.trackingUrl))) {
    return respond(request, 400, { error: "Order update details are invalid." });
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT id, status, payment_status FROM orders WHERE order_number = $1 FOR UPDATE",
      [request.params.orderNumber],
    );
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return respond(request, 404, { error: "Order not found." });
    }
    const currentStatus = current.rows[0].status as OrderStatus;
    if (body.status && body.status !== currentStatus && !canTransitionOrder(currentStatus, body.status)) {
      await client.query("ROLLBACK");
      return respond(request, 409, { error: "This order status transition is not allowed." });
    }
    if (body.status === "cancelled" && current.rows[0].payment_status === "paid") {
      await client.query("ROLLBACK");
      return respond(request, 409, { error: "Paid orders require provider-confirmed refund handling before cancellation." });
    }
    if (body.status === "cancelled" && current.rows[0].payment_status === "pending") {
      await client.query("ROLLBACK");
      return respond(request, 409, { error: "Wait for verified payment failure before cancelling a pending-payment order." });
    }
    await client.query(
      `UPDATE orders SET status = COALESCE($2::order_status, status), updated_at = now() WHERE id = $1`,
      [current.rows[0].id, body.status ?? null],
    );
    if (body.carrier || body.trackingNumber || body.trackingUrl) {
      await client.query(
        `INSERT INTO shipping_records (order_id, carrier, tracking_number, tracking_url, shipped_at, updated_by)
         VALUES ($1, $2, $3, $4, CASE WHEN $5 = 'shipped' THEN now() ELSE NULL END, $6)
         ON CONFLICT (order_id) DO UPDATE SET carrier = EXCLUDED.carrier,
           tracking_number = EXCLUDED.tracking_number, tracking_url = EXCLUDED.tracking_url,
           shipped_at = CASE WHEN $5 = 'shipped' THEN COALESCE(shipping_records.shipped_at, now()) ELSE shipping_records.shipped_at END,
           delivered_at = CASE WHEN $5 = 'delivered' THEN COALESCE(shipping_records.delivered_at, now()) ELSE shipping_records.delivered_at END,
           updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [current.rows[0].id, body.carrier ?? null, body.trackingNumber ?? null, body.trackingUrl ?? null, body.status ?? currentStatus, user.id],
      );
    }
    await client.query(
      `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'order.updated', 'order', $2, $3)`,
      [user.id, current.rows[0].id, JSON.stringify({ status: body.status ?? currentStatus })],
    );
    await client.query("COMMIT");
    return respond(request, 200, { orderNumber: request.params.orderNumber, status: body.status ?? currentStatus });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

route("admin-media", "api/admin/media", ["POST", "OPTIONS"], async (request) => {
  const user = await getSession(request);
  if (!user || user.role !== "admin") return respond(request, 403, { error: "Administrator access required." });
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const containerName = process.env.AZURE_STORAGE_CONTAINER ?? "product-media";
  if (!connectionString) return respond(request, 503, { error: "Azure Blob Storage is not configured." });
  const mime = request.headers.get("content-type") ?? "";
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
    return respond(request, 415, { error: "Use JPEG, PNG, or WebP images." });
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 5 * 1024 * 1024) return respond(request, 413, { error: "Image must be 5 MB or smaller." });
  const bytes = Buffer.from(await request.arrayBuffer());
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) return respond(request, 413, { error: "Image must be 5 MB or smaller." });
  const validImage =
    (mime === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (mime === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mime === "image/webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
  if (!validImage) return respond(request, 415, { error: "Image content did not match the declared file type." });
  const blobName = `${randomBytes(18).toString("hex")}.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`;
  const service = BlobServiceClient.fromConnectionString(connectionString);
  const container = service.getContainerClient(containerName);
  await container.createIfNotExists({ access: "blob" });
  const blob = container.getBlockBlobClient(blobName);
  await blob.uploadData(bytes, {
    blobHTTPHeaders: { blobContentType: mime, blobCacheControl: "public, max-age=31536000, immutable" },
  });
  return respond(request, 201, { url: blob.url, blobName });
});
