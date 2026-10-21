"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { apiUrl, formatRupees } from "@/lib/store-api";

interface CartItem {
  variant_id: string;
  name: string;
  slug: string;
  quantity: number;
  available_quantity: number;
  unit_price_paise: number;
  image_url?: string | null;
  variant_label?: string | null;
  stock_warning?: boolean;
}

interface CartPayload {
  items: CartItem[];
  totals: {
    subtotalPaise: number;
    shippingPaise: number;
    discountPaise: number;
    taxPaise: number;
    totalPaise: number;
  };
}

export function CartClient() {
  const [cart, setCart] = useState<CartPayload | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const cartEndpoint = apiUrl("api/cart");
  useEffect(() => {
    if (!cartEndpoint) return;
    fetch(cartEndpoint, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Cart service is not available.");
        return (await response.json()) as CartPayload;
      })
      .then(setCart)
      .catch(() => setMessage("Cart service is not available."));
  }, [cartEndpoint]);

  async function change(variantId: string, quantity: number) {
    const endpoint = apiUrl(`api/cart/items/${encodeURIComponent(variantId)}`);
    if (!endpoint) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: quantity === 0 ? "DELETE" : "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: quantity === 0 ? undefined : JSON.stringify({ quantity }),
      });
      if (!response.ok) {
        const body = await response.json();
        setMessage(body.error ?? "Your cart could not be updated.");
      }
      if (cartEndpoint) {
        const refreshed = await fetch(cartEndpoint, { credentials: "include", cache: "no-store" });
        if (refreshed.ok) setCart(await refreshed.json());
      }
    } catch {
      setMessage("Your cart could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!cartEndpoint ? (
        <div className="notice notice-muted">Cart services are not configured. Connect the Store API to enable persistent carts.</div>
      ) : !cart ? (
        <div className="empty-state"><span className="eyebrow">Your bag</span><h2>{message || "Loading your bag…"}</h2></div>
      ) : cart.items.length === 0 ? (
        <div className="empty-state">
          <span className="eyebrow">A little room for something lovely</span>
          <h2>Your bag is empty</h2>
          <p>Items will appear here once they are published in the store catalogue.</p>
          <Link className="button button-primary" href="/shop">Explore the collection</Link>
        </div>
      ) : (
        <div className="cart-layout">
          <div className="cart-lines">
            {cart.items.map((item) => (
              <article className="cart-line" key={item.variant_id}>
                <div className="cart-art">
                  {item.image_url
                    ? <Image src={item.image_url} alt="" fill sizes="(max-width: 760px) 75px, 104px" unoptimized />
                    : <span aria-hidden="true">✳</span>}
                </div>
                <div className="cart-item-copy">
                  <Link href={`/products/${item.slug}`}>{item.name}</Link>
                  {item.variant_label && <span>{item.variant_label}</span>}
                  <span>{formatRupees(item.unit_price_paise)}</span>
                  {item.stock_warning && <span className="stock-warning">Quantity exceeds current availability. Update this item before checkout.</span>}
                  <div className="quantity-stepper" aria-label={`Quantity for ${item.name}`}>
                    <button aria-label="Decrease quantity" disabled={busy} onClick={() => void change(item.variant_id, Math.max(0, item.quantity - 1))}>−</button>
                    <span>{item.quantity}</span>
                    <button aria-label="Increase quantity" disabled={busy || item.quantity >= item.available_quantity} onClick={() => void change(item.variant_id, item.quantity + 1)}>+</button>
                  </div>
                  <button className="text-button" disabled={busy} onClick={() => void change(item.variant_id, 0)}>Remove</button>
                </div>
                <strong>{formatRupees(item.unit_price_paise * item.quantity)}</strong>
              </article>
            ))}
            <p className="status-message" aria-live="polite">{message}</p>
          </div>
          <aside className="order-summary">
            <span className="eyebrow">Order summary</span>
            <div><span>Subtotal</span><strong>{formatRupees(cart.totals.subtotalPaise)}</strong></div>
            <div><span>Shipping</span><strong>{formatRupees(cart.totals.shippingPaise)}</strong></div>
            {cart.totals.discountPaise > 0 && <div><span>Discount</span><strong>−{formatRupees(cart.totals.discountPaise)}</strong></div>}
            <div><span>Tax</span><strong>{formatRupees(cart.totals.taxPaise)}</strong></div>
            <div className="summary-total"><span>Total</span><strong>{formatRupees(cart.totals.totalPaise)}</strong></div>
            <p>Charges use configured store rules. Delivery promises are not shown until a service is configured.</p>
            <Link className="button button-primary button-wide" href="/checkout">Continue to checkout</Link>
          </aside>
        </div>
      )}
    </>
  );
}
