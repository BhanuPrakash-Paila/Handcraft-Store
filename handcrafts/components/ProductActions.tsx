"use client";

import { useState } from "react";
import { apiUrl } from "@/lib/store-api";

export function ProductActions({
  productId,
  variants,
  available,
}: {
  productId: string;
  variants: Array<{ id: string; label: string; availableQuantity: number }>;
  available: number;
}) {
  const [variantId, setVariantId] = useState(
    variants.find((variant) => variant.availableQuantity > 0)?.id ?? variants[0]?.id ?? "",
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedVariant = variants.find((variant) => variant.id === variantId);
  const selectedAvailable = selectedVariant?.availableQuantity ?? available;

  async function addToCart() {
    const endpoint = apiUrl("api/cart/items");
    if (!endpoint) {
      setMessage("The store API is not configured yet.");
      return;
    }
    if (!variantId || selectedAvailable < 1) {
      setMessage("This item is currently unavailable.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId, quantity: 1 }),
      });
      const body = await response.json();
      setMessage(response.ok ? "Added to your bag." : body.error ?? "Could not update your bag.");
    } catch {
      setMessage("The store service could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  async function saveToWishlist() {
    const endpoint = apiUrl("api/account/wishlist");
    if (!endpoint) return setMessage("Wishlist service is not configured.");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const body = await response.json();
      setMessage(response.ok ? "Saved to your wishlist." : body.error ?? "Sign in to save this piece.");
    } catch {
      setMessage("Wishlist service could not be reached.");
    }
  }

  return (
    <div className="product-actions">
      {variants.length > 1 && (
        <label className="field-label">
          Option
          <select value={variantId} onChange={(event) => setVariantId(event.target.value)}>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id} disabled={variant.availableQuantity < 1}>
                {variant.label}{variant.availableQuantity < 1 ? " — unavailable" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <button className="button button-primary button-wide" onClick={addToCart} disabled={busy || selectedAvailable < 1}>
        {busy ? "Adding…" : selectedAvailable > 0 ? "Add to bag" : "Currently unavailable"}
      </button>
      <button className="wishlist-button" onClick={() => void saveToWishlist()}>♡ <span>Save to wishlist</span></button>
      <p className="status-message" aria-live="polite">{message}</p>
    </div>
  );
}
