"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiUrl } from "@/lib/store-api";

interface Account {
  id: string;
  email: string;
  role: "customer" | "admin";
}

export function AccountPanel() {
  const [account, setAccount] = useState<Account | null>(null);
  const [signup, setSignup] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const configured = Boolean(apiUrl("api/account"));

  useEffect(() => {
    const endpoint = apiUrl("api/account");
    if (!endpoint) return;
    fetch(endpoint, { credentials: "include", cache: "no-store" })
      .then(async (response) => response.ok ? setAccount(await response.json()) : undefined)
      .catch(() => setMessage("Account service could not be reached."));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const endpoint = apiUrl(signup ? "api/account/signup" : "api/account/signin");
    if (!endpoint) return setMessage("Account services are not configured.");
    const form = new FormData(event.currentTarget);
    const payload: Record<string, string> = {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    };
    if (signup) payload.displayName = String(form.get("displayName") ?? "");
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) return setMessage(result.error ?? "Unable to sign in.");
      setAccount({ id: result.id, email: result.email, role: result.role ?? "customer" });
      setMessage(signup ? "Your account has been created." : "You are signed in.");
    } catch {
      setMessage("Account service could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    const endpoint = apiUrl("api/account/signout");
    if (!endpoint) return;
    await fetch(endpoint, { method: "POST", credentials: "include" }).catch(() => undefined);
    setAccount(null);
    setMessage("You have signed out.");
  }

  if (account) {
    return (
      <div className="account-card">
        <span className="eyebrow">Signed in</span>
        <h2>Welcome back.</h2>
        <p>{account.email}</p>
        <div className="account-links">
          <a href="/account/orders">Order history</a>
          <a href="/account/wishlist">Your wishlist</a>
          {account.role === "admin" && <a href="/admin">Store administration</a>}
        </div>
        <button className="button button-outline" onClick={() => void signOut()}>Sign out</button>
        <p className="status-message" aria-live="polite">{message}</p>
      </div>
    );
  }

  return (
    <section className="account-card">
      <span className="eyebrow">Your account</span>
      <h2>{signup ? "Create an account." : "Sign in."}</h2>
      {!configured && <div className="notice notice-muted">Account services are not configured. Set the Store API URL and database before enabling sign-in.</div>}
      <form className="account-form" onSubmit={submit}>
        {signup && <label className="field-label">Your name<input name="displayName" required maxLength={100} autoComplete="name" /></label>}
        <label className="field-label">Email<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
        <label className="field-label">Password<input name="password" type="password" required minLength={signup ? 12 : 1} maxLength={128} autoComplete={signup ? "new-password" : "current-password"} /></label>
        {signup && <p className="form-hint">Use at least 12 characters. Password reset is not enabled until an email provider is configured.</p>}
        <button className="button button-primary button-wide" disabled={busy || !configured}>{busy ? "Please wait…" : signup ? "Create account" : "Sign in"}</button>
      </form>
      <button className="text-button account-toggle" onClick={() => setSignup(!signup)}>
        {signup ? "Already have an account? Sign in" : "New here? Create an account"}
      </button>
      <p className="status-message" aria-live="polite">{message}</p>
    </section>
  );
}
