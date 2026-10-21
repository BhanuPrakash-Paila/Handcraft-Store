export type PaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "refund_pending"
  | "refunded";

export type OrderStatus =
  | "placed"
  | "processing"
  | "packed"
  | "shipped"
  | "delivered"
  | "cancelled";

export interface CartLine {
  productId: string;
  variantId: string;
  title: string;
  variantLabel?: string;
  unitPricePaise: number;
  quantity: number;
  availableQuantity: number;
}

export interface Totals {
  subtotalPaise: number;
  shippingPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
}

export interface ShippingRule {
  flatRatePaise: number;
  freeShippingThresholdPaise?: number;
}

export function calculateTotals(
  lines: CartLine[],
  shipping: ShippingRule,
  discountPaise = 0,
  taxBasisPoints = 0,
): Totals {
  if (
    !Number.isSafeInteger(shipping.flatRatePaise) ||
    shipping.flatRatePaise < 0 ||
    (shipping.freeShippingThresholdPaise !== undefined &&
      (!Number.isSafeInteger(shipping.freeShippingThresholdPaise) ||
        shipping.freeShippingThresholdPaise < 0)) ||
    !Number.isSafeInteger(discountPaise) ||
    !Number.isSafeInteger(taxBasisPoints) ||
    taxBasisPoints < 0 ||
    taxBasisPoints > 10_000
  ) {
    throw new Error("Shipping, discount, or tax configuration is invalid.");
  }
  if (
    lines.some(
      (line) =>
        !Number.isSafeInteger(line.unitPricePaise) ||
        line.unitPricePaise < 0 ||
        !Number.isSafeInteger(line.quantity) ||
        line.quantity < 1 ||
        line.quantity > line.availableQuantity,
    )
  ) {
    throw new Error("Cart contains an invalid price or unavailable quantity.");
  }

  const subtotalPaise = lines.reduce(
    (sum, line) => sum + line.unitPricePaise * line.quantity,
    0,
  );
  if (!Number.isSafeInteger(subtotalPaise)) {
    throw new Error("Cart total exceeds the supported amount.");
  }

  const shippingPaise =
    shipping.freeShippingThresholdPaise !== undefined &&
    subtotalPaise >= shipping.freeShippingThresholdPaise
      ? 0
      : shipping.flatRatePaise;
  const appliedDiscount = Math.min(
    subtotalPaise,
    Math.max(0, Math.floor(discountPaise)),
  );
  const taxablePaise = subtotalPaise - appliedDiscount;
  const taxPaise = Math.round((taxablePaise * taxBasisPoints) / 10_000);

  return {
    subtotalPaise,
    shippingPaise,
    discountPaise: appliedDiscount,
    taxPaise,
    totalPaise: taxablePaise + shippingPaise + taxPaise,
  };
}

const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  placed: ["processing", "cancelled"],
  processing: ["packed", "cancelled"],
  packed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function canTransitionOrder(
  current: OrderStatus,
  next: OrderStatus,
): boolean {
  return ORDER_TRANSITIONS[current].includes(next);
}

export function canTransitionPayment(
  current: PaymentStatus,
  next: PaymentStatus,
): boolean {
  const transitions: Record<PaymentStatus, PaymentStatus[]> = {
    pending: ["paid", "failed"],
    paid: ["refund_pending"],
    failed: ["pending"],
    refund_pending: ["refunded", "paid"],
    refunded: [],
  };
  return transitions[current].includes(next);
}
