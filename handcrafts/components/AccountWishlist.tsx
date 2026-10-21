"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiUrl, formatRupees } from "@/lib/store-api";

interface WishlistItem {
  id: string;
  slug: string;
  name: string;
  price_paise: string | number;
  sale_price_paise?: string | number | null;
}

export function AccountWishlist() {
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [message, setMessage] = useState("Loading your wishlist…");
  const endpoint = apiUrl("api/account/wishlist");

  useEffect(() => {
    if (!endpoint) return;
    fetch(endpoint, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) throw new Error("Sign in to view your wishlist.");
        if (!response.ok) throw new Error("Wishlist could not be loaded.");
        return (await response.json()) as WishlistItem[];
      })
      .then((data) => {
        setItems(data);
        setMessage(data.length ? "" : "Your wishlist is empty.");
      })
      .catch((error: Error) => setMessage(error.message));
  }, [endpoint]);

  async function remove(productId: string) {
    if (!endpoint) return;
    const response = await fetch(endpoint, {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    });
    if (response.ok) {
      const refreshed = await fetch(endpoint, { credentials: "include", cache: "no-store" });
      if (refreshed.ok) {
        const data = (await refreshed.json()) as WishlistItem[];
        setItems(data);
        setMessage(data.length ? "" : "Your wishlist is empty.");
      }
    }
  }

  return (
    <section className="account-card account-orders">
      <span className="eyebrow">Saved pieces</span>
      <h2>Your wishlist.</h2>
      {message && <p>{endpoint ? message : "Wishlist service is not configured."}</p>}
      {items.map((item) => (
        <div className="account-order-row" key={item.id}>
          <Link href={`/products/${item.slug}`}><strong>{item.name}</strong></Link>
          <strong>{formatRupees(item.sale_price_paise ?? item.price_paise)}</strong>
          <button className="text-button" onClick={() => void remove(item.id)}>Remove</button>
        </div>
      ))}
    </section>
  );
}
