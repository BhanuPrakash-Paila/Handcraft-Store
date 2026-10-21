"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiUrl, formatRupees } from "@/lib/store-api";

interface AccountOrder {
  order_number: string;
  status: string;
  payment_status: string;
  total_paise: number | string;
  created_at: string;
}

export function AccountOrders() {
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [message, setMessage] = useState("Loading your orders…");
  const endpoint = apiUrl("api/account/orders");

  useEffect(() => {
    if (!endpoint) return;
    fetch(endpoint, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) throw new Error("Sign in to view your order history.");
        if (!response.ok) throw new Error("Order history is not available.");
        const result = (await response.json()) as AccountOrder[];
        setOrders(result);
        setMessage(result.length ? "" : "No account orders yet.");
      })
      .catch((error: Error) => setMessage(error.message));
  }, [endpoint]);

  return (
    <section className="account-card account-orders">
      <span className="eyebrow">Your orders</span>
      <h2>Order history.</h2>
      {message && <p>{endpoint ? message : "Account services are not configured."}</p>}
      {orders.map((order) => (
        <Link className="account-order-row" href={`/orders/${encodeURIComponent(order.order_number)}`} key={order.order_number}>
          <span><strong>{order.order_number}</strong><small>{new Date(order.created_at).toLocaleDateString("en-IN")}</small></span>
          <span>{order.status} · payment {order.payment_status}</span>
          <strong>{formatRupees(order.total_paise)}</strong>
        </Link>
      ))}
    </section>
  );
}
