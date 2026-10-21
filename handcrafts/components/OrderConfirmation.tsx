"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiUrl, formatRupees } from "@/lib/store-api";

export function OrderConfirmation({
  orderNumber,
  accessToken,
}: {
  orderNumber: string;
  accessToken?: string;
}) {
  const [order, setOrder] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const endpoint = apiUrl(`api/orders/${encodeURIComponent(orderNumber)}`);

  useEffect(() => {
    if (!endpoint) return;
    const url = new URL(endpoint);
    if (accessToken) url.searchParams.set("access", accessToken);
    fetch(url, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Order details could not be found.");
        setOrder(await response.json());
      })
      .catch((reason: Error) => setError(reason.message));
  }, [endpoint, accessToken]);

  if (!order) {
    return <div className="empty-state"><span className="eyebrow">Order {orderNumber}</span><h2>{error || (endpoint ? "Retrieving your order…" : "Order services are not configured.")}</h2></div>;
  }
  const items = order.items as Array<{ product_name: string; quantity: number; line_total_paise: string | number }>;
  return (
    <section className="order-confirmation">
      <div className="confirmation-seal" aria-hidden="true">✓</div>
      <span className="eyebrow">Order received</span>
      <h1>Thank you for your <em>order.</em></h1>
      <p className="order-number">Reference <strong>{String(order.order_number)}</strong></p>
      <div className="notice notice-warning">
        <strong>Payment status: {String(order.payment_status)}</strong>
        <p>An order being created is not the same as a completed payment. This status changes only after payment verification.</p>
      </div>
      <div className="confirmation-items">
        {items?.map((item, index) => <div key={`${item.product_name}-${index}`}><span>{item.quantity} × {item.product_name}</span><strong>{formatRupees(item.line_total_paise)}</strong></div>)}
      </div>
      <Link className="button button-primary" href="/shop">Continue browsing</Link>
    </section>
  );
}
