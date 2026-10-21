"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiUrl, formatRupees } from "@/lib/store-api";

interface Summary {
  orders: number;
  awaiting_fulfillment: number;
  confirmed_revenue_paise: string | number;
  low_stock_variants: number;
}

interface AdminOrder {
  order_number: string;
  email: string;
  status: "placed" | "processing" | "packed" | "shipped" | "delivered" | "cancelled";
  payment_status: string;
  total_paise: number | string;
  currency: string;
  created_at: string;
  carrier?: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
}

interface AdminCategory {
  id: string;
  slug: string;
  name: string;
  description: string;
  position: number;
  active: boolean;
}

export function AdminDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [message, setMessage] = useState(
    apiUrl("api/admin/summary") ? "" : "Store API is not configured.",
  );
  const [productId, setProductId] = useState("");
  const [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const [orderMessage, setOrderMessage] = useState("");
  const [orderBusy, setOrderBusy] = useState(false);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);

  const loadOrders = useCallback(async (search: string, status: string) => {
    const endpoint = apiUrl("api/admin/orders");
    if (!endpoint) return;
    const url = new URL(endpoint);
    if (search.trim()) url.searchParams.set("q", search.trim());
    if (status) url.searchParams.set("status", status);
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Orders could not be loaded.");
    setOrders(body as AdminOrder[]);
  }, []);

  const loadCategories = useCallback(async () => {
    const endpoint = apiUrl("api/admin/categories");
    if (!endpoint) return;
    const response = await fetch(endpoint, { credentials: "include", cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Categories could not be loaded.");
    setCategories(body as AdminCategory[]);
  }, []);

  useEffect(() => {
    const endpoint = apiUrl("api/admin/summary");
    if (!endpoint) return;
    fetch(endpoint, { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (response.status === 403) throw new Error("Administrator sign-in is required. No public or default admin account exists.");
        if (!response.ok) throw new Error("Admin service is not available.");
        return (await response.json()) as Summary;
      })
      .then(async (result: Summary) => {
        setSummary(result);
        await Promise.all([loadOrders("", ""), loadCategories()]);
      })
      .catch((error: Error) => setMessage(error.message));
  }, [loadCategories, loadOrders]);

  async function updateOrder(event: FormEvent<HTMLFormElement>, order: AdminOrder) {
    event.preventDefault();
    const endpoint = apiUrl(`api/admin/orders/${encodeURIComponent(order.order_number)}`);
    if (!endpoint) return setOrderMessage("Store API is not configured.");
    const form = new FormData(event.currentTarget);
    setOrderBusy(true);
    setOrderMessage("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: form.get("status"),
          carrier: form.get("carrier"),
          trackingNumber: form.get("trackingNumber"),
          trackingUrl: form.get("trackingUrl"),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Order update was rejected.");
      setOrderMessage(`Order ${order.order_number} updated. Payment remains ${order.payment_status}.`);
      await loadOrders(orderSearch, orderStatus);
    } catch (error) {
      setOrderMessage(error instanceof Error ? error.message : "Order update failed.");
    } finally {
      setOrderBusy(false);
    }
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const endpoint = apiUrl("api/admin/categories");
    if (!endpoint) return setMessage("Store API is not configured.");
    const data = new FormData(formElement);
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("categoryName"),
          slug: data.get("categorySlug"),
          description: data.get("categoryDescription"),
          position: Number(data.get("categoryPosition") || 0),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Category could not be created.");
      formElement.reset();
      setMessage("Category created. It appears in the storefront after an approved product is assigned and published.");
      await loadCategories();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Category could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleCategory(category: AdminCategory) {
    const endpoint = apiUrl(`api/admin/categories/${encodeURIComponent(category.id)}`);
    if (!endpoint) return;
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !category.active }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Category could not be updated.");
      await loadCategories();
      setMessage(`${category.name} ${category.active ? "deactivated" : "activated"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Category could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function assignCategories() {
    const endpoint = apiUrl(`api/admin/products/${productId}/categories`);
    if (!endpoint) return;
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryIds: selectedCategoryIds }),
      });
      const body = await response.json();
      setMessage(response.ok ? "Product categories saved." : body.error ?? "Product categories could not be saved.");
    } catch {
      setMessage("Product categories could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const endpoint = apiUrl("api/admin/products");
    if (!endpoint) return setMessage("Store API is not configured.");
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          slug: data.get("slug"),
          description: data.get("description"),
          sku: data.get("sku"),
          pricePaise: Math.round(Number(data.get("price")) * 100),
        }),
      });
      const result = await response.json();
      if (!response.ok) return setMessage(result.error ?? "Product could not be created.");
      setProductId(result.id);
      setSelectedCategoryIds([]);
      setMessage("Draft created. Add a stock variant and an approved product image before publishing.");
      formElement.reset();
    } catch {
      setMessage("Product could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function addVariant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const endpoint = apiUrl(`api/admin/products/${productId}/variants`);
    if (!endpoint) return;
    const data = new FormData(event.currentTarget);
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: data.get("label"),
        sku: data.get("variantSku"),
        quantity: Number(data.get("quantity")),
      }),
    });
    const result = await response.json();
    setMessage(response.ok ? "Variant and opening stock recorded. Add an approved product photo next." : result.error ?? "Variant could not be added.");
  }

  async function addImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("image");
    if (!(file instanceof File) || !file.size) return setMessage("Choose a product image.");
    const uploadUrl = apiUrl("api/admin/media");
    if (!uploadUrl) return;
    setBusy(true);
    try {
      const uploaded = await fetch(uploadUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": file.type },
        body: file,
      });
      const uploadBody = await uploaded.json();
      if (!uploaded.ok) return setMessage(uploadBody.error ?? "Image upload failed.");
      const imageUrl = apiUrl(`api/admin/products/${productId}/images`);
      if (!imageUrl) return;
      const saved = await fetch(imageUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blobName: uploadBody.blobName,
          altText: data.get("altText"),
          position: 0,
        }),
      });
      const savedBody = await saved.json();
      setMessage(saved.ok ? "Image and alt text saved. You can now publish the product." : savedBody.error ?? "Image details could not be saved.");
    } catch {
      setMessage("Image upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    const endpoint = apiUrl(`api/admin/products/${productId}`);
    if (!endpoint) return;
    const response = await fetch(endpoint, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "published" }),
    });
    const result = await response.json();
    setMessage(response.ok ? "Product published." : result.error ?? "Product could not be published.");
    if (response.ok) setProductId("");
  }

  return (
    <>
      {summary ? (
        <div className="admin-metrics">
          <article><span>Recorded orders</span><strong>{summary.orders}</strong></article>
          <article><span>Awaiting fulfillment</span><strong>{summary.awaiting_fulfillment}</strong></article>
          <article><span>Confirmed paid revenue</span><strong>{formatRupees(summary.confirmed_revenue_paise)}</strong></article>
          <article><span>Low-stock variants</span><strong>{summary.low_stock_variants}</strong></article>
        </div>
      ) : (
        <div className="notice notice-muted">{message || "Loading real operational metrics…"}</div>
      )}
      {summary && (
        <section className="admin-panel">
          <span className="eyebrow">Catalogue management</span>
          <h2>Create a product draft</h2>
          <form className="admin-form" onSubmit={createProduct}>
            <label className="field-label">Product name<input name="name" required maxLength={180} /></label>
            <label className="field-label">URL slug<input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" /></label>
            <label className="field-label">SKU<input name="sku" maxLength={100} /></label>
            <label className="field-label">Price in rupees<input name="price" type="number" min="0" step="0.01" required /></label>
            <label className="field-label">Description<textarea name="description" rows={4} maxLength={10000} /></label>
            <button className="button button-primary" disabled={busy}>Create draft</button>
          </form>
          {productId && (
            <div className="admin-followup">
              <h3>Complete this draft before publishing</h3>
              {categories.filter((category) => category.active).length > 0 && (
                <fieldset className="category-assignment">
                  <legend>Assign active categories</legend>
                  {categories.filter((category) => category.active).map((category) => (
                    <label key={category.id}>
                      <input
                        type="checkbox"
                        checked={selectedCategoryIds.includes(category.id)}
                        onChange={(event) => setSelectedCategoryIds((current) =>
                          event.target.checked
                            ? [...current, category.id]
                            : current.filter((id) => id !== category.id))}
                      />
                      {category.name}
                    </label>
                  ))}
                  <button className="button button-outline" type="button" disabled={busy} onClick={() => void assignCategories()}>
                    Save product categories
                  </button>
                </fieldset>
              )}
              <form className="admin-form" onSubmit={addVariant}>
                <label className="field-label">Option label<input name="label" defaultValue="Standard" required /></label>
                <label className="field-label">Variant SKU<input name="variantSku" /></label>
                <label className="field-label">Opening stock<input name="quantity" type="number" min="0" step="1" required /></label>
                <button className="button button-outline">Add variant &amp; stock</button>
              </form>
              <form className="admin-form image-upload-form" onSubmit={addImage}>
                <label className="field-label">Real product image<input name="image" type="file" accept="image/jpeg,image/png,image/webp" required /></label>
                <label className="field-label">Descriptive alt text<input name="altText" maxLength={240} required /></label>
                <button className="button button-outline" disabled={busy}>Upload image</button>
              </form>
              <button className="button button-primary" onClick={() => void publish()}>Publish after review</button>
            </div>
          )}
        </section>
      )}
      {summary && (
        <section className="admin-panel">
          <span className="eyebrow">Store navigation</span>
          <h2>Categories</h2>
          <form className="admin-form" onSubmit={createCategory}>
            <label className="field-label">Category name<input name="categoryName" required maxLength={120} /></label>
            <label className="field-label">URL slug<input name="categorySlug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" /></label>
            <label className="field-label">Description<textarea name="categoryDescription" rows={2} maxLength={2000} /></label>
            <label className="field-label">Display position<input name="categoryPosition" type="number" min="-100000" max="100000" step="1" defaultValue="0" /></label>
            <button className="button button-outline" disabled={busy}>Create category</button>
          </form>
          <div className="admin-category-list">
            {categories.map((category) => (
              <div key={category.id}>
                <span><strong>{category.name}</strong><small>/{category.slug} · {category.active ? "Active" : "Inactive"}</small></span>
                <button className="text-button" type="button" disabled={busy} onClick={() => void toggleCategory(category)}>
                  {category.active ? "Deactivate" : "Activate"}
                </button>
              </div>
            ))}
            {categories.length === 0 && <p>No categories have been created.</p>}
          </div>
        </section>
      )}
      {summary && (
        <section className="admin-panel">
          <span className="eyebrow">Fulfillment</span>
          <h2>Orders</h2>
          <form
            className="admin-form order-filter-form"
            onSubmit={(event) => {
              event.preventDefault();
              setOrderBusy(true);
              void loadOrders(orderSearch, orderStatus).catch((error: Error) => setOrderMessage(error.message)).finally(() => setOrderBusy(false));
            }}
          >
            <label className="field-label">Order number or customer email<input value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} maxLength={100} /></label>
            <label className="field-label">Fulfillment status
              <select value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)}>
                <option value="">All statuses</option>
                <option value="placed">Placed</option>
                <option value="processing">Processing</option>
                <option value="packed">Packed</option>
                <option value="shipped">Shipped</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <button className="button button-outline" disabled={orderBusy}>Search orders</button>
          </form>
          {orders.length === 0 ? <p>No orders match this filter.</p> : (
            <div className="admin-order-list">
              {orders.map((order) => (
                <article className="admin-order-row" key={order.order_number}>
                  <div className="admin-order-heading">
                    <strong>{order.order_number}</strong>
                    <span>{order.email}</span>
                    <span>{new Date(order.created_at).toLocaleString("en-IN")}</span>
                    <span>{formatRupees(order.total_paise)} · Payment {order.payment_status}</span>
                  </div>
                  <form className="admin-order-update" onSubmit={(event) => void updateOrder(event, order)}>
                    <label className="field-label">Fulfillment status
                      <select name="status" defaultValue={order.status}>
                        <option value="placed">Placed</option>
                        <option value="processing">Processing</option>
                        <option value="packed">Packed</option>
                        <option value="shipped">Shipped</option>
                        <option value="delivered">Delivered</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </label>
                    <label className="field-label">Carrier<input name="carrier" defaultValue={order.carrier ?? ""} maxLength={100} /></label>
                    <label className="field-label">Tracking number<input name="trackingNumber" defaultValue={order.tracking_number ?? ""} maxLength={160} /></label>
                    <label className="field-label">Tracking URL (HTTPS)<input name="trackingUrl" type="url" defaultValue={order.tracking_url ?? ""} placeholder="https://" /></label>
                    <button className="button button-outline" disabled={orderBusy}>Save fulfillment update</button>
                  </form>
                </article>
              ))}
            </div>
          )}
          {orderMessage && <p className="status-message" aria-live="polite">{orderMessage}</p>}
        </section>
      )}
      {message && <p className="status-message" aria-live="polite">{message}</p>}
    </>
  );
}
