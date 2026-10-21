import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateTotals,
  canTransitionOrder,
  canTransitionPayment,
  type CartLine,
} from "./commerce.js";

const line: CartLine = {
  productId: "product-1",
  variantId: "variant-1",
  title: "Unpublished product is never seeded",
  unitPricePaise: 125_000,
  quantity: 2,
  availableQuantity: 3,
};

test("calculates server-authoritative cart totals in paise", () => {
  assert.deepEqual(
    calculateTotals([line], { flatRatePaise: 5_000 }, 10_000, 500),
    {
      subtotalPaise: 250_000,
      shippingPaise: 5_000,
      discountPaise: 10_000,
      taxPaise: 12_000,
      totalPaise: 257_000,
    },
  );
});

test("applies configured free shipping threshold", () => {
  assert.equal(
    calculateTotals(
      [line],
      { flatRatePaise: 5_000, freeShippingThresholdPaise: 200_000 },
    ).shippingPaise,
    0,
  );
});

test("rejects quantity above current availability", () => {
  assert.throws(() =>
    calculateTotals([{ ...line, quantity: 4 }], { flatRatePaise: 0 }),
  );
});

test("rejects invalid server-side shipping and tax configuration", () => {
  assert.throws(() =>
    calculateTotals([line], { flatRatePaise: Number.NaN }, 0, 0),
  );
  assert.throws(() =>
    calculateTotals([line], { flatRatePaise: 0 }, 0, -10),
  );
  assert.throws(() =>
    calculateTotals([line], { flatRatePaise: 0 }, 0, 10_001),
  );
});

test("enforces terminal order and payment transitions", () => {
  assert.equal(canTransitionOrder("placed", "processing"), true);
  assert.equal(canTransitionOrder("delivered", "shipped"), false);
  assert.equal(canTransitionPayment("pending", "paid"), true);
  assert.equal(canTransitionPayment("refunded", "paid"), false);
});
