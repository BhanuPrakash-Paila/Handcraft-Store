export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  short_description?: string | null;
  price_paise: number | string;
  sale_price_paise?: number | string | null;
  currency: string;
  available_quantity: number;
  image_url?: string | null;
  sku?: string | null;
}

export interface ProductPage extends ProductSummary {
  description: string;
  materials?: string | null;
  dimensions?: string | null;
  images: Array<{ url: string; altText: string; position: number }>;
  variants: Array<{ id: string; label: string; availableQuantity: number }>;
}

export interface CatalogResponse {
  items: ProductSummary[];
  total: number;
  page: number;
  pageSize: number;
  serviceAvailable: boolean;
}

export interface CategorySummary {
  slug: string;
  name: string;
  description?: string;
  product_count: number;
}

export function apiUrl(path: string): string | null {
  const base = process.env.NEXT_PUBLIC_STORE_API_URL?.replace(/\/+$/, "");
  return base ? `${base}/${path.replace(/^\/+/, "")}` : null;
}

export async function getCatalog(
  params: Record<string, string | undefined> = {},
): Promise<CatalogResponse> {
  const base = apiUrl("api/products");
  if (!base) return { items: [], total: 0, page: 1, pageSize: 24, serviceAvailable: false };
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  try {
    const response = await fetch(url, { next: { revalidate: 60 } });
    if (!response.ok) return { items: [], total: 0, page: 1, pageSize: 24, serviceAvailable: false };
    const catalog = (await response.json()) as Omit<CatalogResponse, "serviceAvailable">;
    return { ...catalog, serviceAvailable: true };
  } catch {
    return { items: [], total: 0, page: 1, pageSize: 24, serviceAvailable: false };
  }
}

export async function getProduct(slug: string): Promise<ProductPage | null> {
  const base = apiUrl(`api/products/${encodeURIComponent(slug)}`);
  if (!base) return null;
  try {
    const response = await fetch(base, { next: { revalidate: 60 } });
    if (!response.ok) return null;
    return (await response.json()) as ProductPage;
  } catch {
    return null;
  }
}

export async function getCategories(): Promise<CategorySummary[]> {
  const endpoint = apiUrl("api/categories");
  if (!endpoint) return [];
  try {
    const response = await fetch(endpoint, { next: { revalidate: 60 } });
    if (!response.ok) return [];
    return (await response.json()) as CategorySummary[];
  } catch {
    return [];
  }
}

export function formatRupees(paise: number | string): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(paise) / 100);
}
