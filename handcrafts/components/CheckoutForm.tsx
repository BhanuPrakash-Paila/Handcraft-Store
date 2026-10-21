"use client";

import { useRef, useState, type FormEvent } from "react";
import { useEffect } from "react";
import Link from "next/link";
import { apiUrl } from "@/lib/store-api";

declare global {
  interface Window {
    Razorpay?: new (options: {
      key: string;
      amount: number;
      currency: string;
      name: string;
      order_id: string;
      prefill: { name: string; email: string; contact: string };
      handler: (result: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      }) => void;
      modal: { ondismiss: () => void };
    }) => { open: () => void; on: (event: string, callback: (detail: { error?: { description?: string } }) => void) => void };
  }
}

export function CheckoutForm() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [orderLink, setOrderLink] = useState("");
  const idempotencyKey = useRef<string | null>(null);
  const [summary, setSummary] = useState<{
    items: Array<{ quantity: number; name: string }>;
    totals: { subtotalPaise: number; shippingPaise: number; taxPaise: number; totalPaise: number };
  } | null>(null);

  useEffect(() => {
    const endpoint = apiUrl("api/cart");
    if (!endpoint) return;
    fetch(endpoint, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return await response.json() as typeof summary;
      })
      .then((cart) => setSummary(cart))
      .catch(() => undefined);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const endpoint = apiUrl("api/checkout");
    if (!endpoint) {
      setMessage("Checkout is not available until the Store API is configured.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const payload = {
      email: String(form.get("email") ?? ""),
      recipientName: String(form.get("recipientName") ?? ""),
      phone: String(form.get("phone") ?? ""),
      address: {
        line1: String(form.get("line1") ?? ""),
        line2: String(form.get("line2") ?? ""),
        locality: String(form.get("locality") ?? ""),
        city: String(form.get("city") ?? ""),
        state: String(form.get("state") ?? ""),
        postalCode: String(form.get("postalCode") ?? ""),
      },
      termsAccepted: form.get("termsAccepted") === "on",
    };
    setBusy(true);
    setMessage("");
    try {
      const healthUrl = apiUrl("api/health");
      const healthResponse = healthUrl
        ? await fetch(healthUrl, { cache: "no-store" })
        : null;
      const health = healthResponse?.ok ? await healthResponse.json() : null;
      if (!health?.paymentsEnabled) {
        setMessage("Online checkout is disabled until Razorpay keys and webhook settings are configured.");
        return;
      }
      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://checkout.razorpay.com/v1/checkout.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Payment form could not be loaded."));
          document.body.appendChild(script);
        });
      }
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current ?? (idempotencyKey.current = crypto.randomUUID()),
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error ?? "Checkout could not be started.");
      } else if (result.paymentStatus === "paid") {
        setMessage(`Payment was already verified for order ${result.orderNumber}.`);
        setOrderLink(`/orders/${encodeURIComponent(result.orderNumber)}?access=${encodeURIComponent(result.accessToken)}`);
      } else {
        if (!window.Razorpay) throw new Error("Payment form could not be initialized.");
        const payment = new window.Razorpay({
          key: result.keyId,
          amount: result.amountPaise,
          currency: result.currency,
          name: "Kondapalli Crafts",
          order_id: result.providerOrderId,
          prefill: {
            name: payload.recipientName,
            email: payload.email,
            contact: payload.phone,
          },
          handler: (paymentResult) => {
            void (async () => {
              const verifyUrl = apiUrl("api/payments/razorpay/verify");
              if (!verifyUrl) return setMessage("Payment verification is not configured.");
              const verifyResponse = await fetch(verifyUrl, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  razorpayOrderId: paymentResult.razorpay_order_id,
                  razorpayPaymentId: paymentResult.razorpay_payment_id,
                  razorpaySignature: paymentResult.razorpay_signature,
                }),
              });
              const verified = await verifyResponse.json();
              if (verifyResponse.ok && verified.verified) {
                setMessage(`Payment verified by the server for order ${result.orderNumber}.`);
                setOrderLink(`/orders/${encodeURIComponent(result.orderNumber)}?access=${encodeURIComponent(result.accessToken)}`);
              } else {
                setMessage(verified.error ?? "Payment is not verified. Please wait and check the order status.");
              }
            })().catch(() => setMessage("Payment status could not be verified. Please check the order status before retrying."));
          },
          modal: {
            ondismiss: () => setMessage(`Payment was not confirmed. Order ${result.orderNumber} remains pending.`),
          },
        });
        payment.on("payment.failed", (detail) => {
          setMessage(detail.error?.description ?? `Payment was not confirmed. Order ${result.orderNumber} remains pending.`);
        });
        payment.open();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The store service could not be reached. No payment has been confirmed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="checkout-layout">
      <form className="checkout-form" onSubmit={submit}>
      <div className="form-section-heading"><span>01</span><h2>Contact details</h2></div>
      <label className="field-label">Email address<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
      <label className="field-label">Recipient name<input name="recipientName" autoComplete="name" required maxLength={100} /></label>
      <label className="field-label">Mobile number<input name="phone" type="tel" inputMode="numeric" autoComplete="tel-national" pattern="[6-9][0-9]{9}" placeholder="10-digit Indian mobile number" required /></label>
      <div className="form-section-heading"><span>02</span><h2>Delivery address</h2></div>
      <label className="field-label">House / street address<input name="line1" autoComplete="address-line1" required maxLength={180} /></label>
      <label className="field-label">Apartment, suite or landmark <span className="optional">(optional)</span><input name="line2" autoComplete="address-line2" maxLength={180} /></label>
      <label className="field-label">Locality <span className="optional">(optional)</span><input name="locality" autoComplete="address-level3" maxLength={100} /></label>
      <div className="field-row">
        <label className="field-label">City<input name="city" autoComplete="address-level2" required maxLength={100} /></label>
        <label className="field-label">State<input name="state" autoComplete="address-level1" required maxLength={100} /></label>
      </div>
      <label className="field-label">PIN code<input name="postalCode" inputMode="numeric" autoComplete="postal-code" pattern="[0-9]{6}" required /></label>
      <div className="notice notice-muted">
        <strong>Payment setup</strong>
        <p>Razorpay checkout stays disabled until valid merchant keys and a verified webhook secret are configured. No payment will be simulated.</p>
      </div>
      <label className="checkbox-label">
        <input type="checkbox" name="termsAccepted" required />
        <span>I have reviewed the <Link href="/policies/terms">provisional terms</Link> and <Link href="/policies/privacy">privacy information</Link>.</span>
      </label>
      <button className="button button-primary button-wide" type="submit" disabled={busy}>
        {busy ? "Checking details…" : "Continue to secure payment"}
      </button>
      <p className="status-message" aria-live="polite">{message}</p>
      {orderLink && <Link className="button button-outline button-wide" href={orderLink}>View verified order</Link>}
      </form>
      <aside className="order-summary checkout-summary">
        <span className="eyebrow">Your order</span>
        {summary?.items.map((item, index) => <p key={`${item.name}-${index}`}>{item.quantity} × {item.name}</p>)}
        <div><span>Subtotal</span><strong>{summary ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(summary.totals.subtotalPaise / 100) : "—"}</strong></div>
        <div><span>Shipping</span><strong>{summary ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(summary.totals.shippingPaise / 100) : "—"}</strong></div>
        <div><span>Tax</span><strong>{summary ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(summary.totals.taxPaise / 100) : "—"}</strong></div>
        <div className="summary-total"><span>Total</span><strong>{summary ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(summary.totals.totalPaise / 100) : "—"}</strong></div>
        <p>Final amount is recalculated from current prices and stock on the server.</p>
      </aside>
    </div>
  );
}
