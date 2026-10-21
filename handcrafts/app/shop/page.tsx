import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { PageLoading } from "@/components/PageLoading";
import { getCatalog, formatRupees } from "@/lib/store-api";

export const metadata = {
  title: "Shop the collection | Kondapalli Crafts",
  description: "Browse the Kondapalli Crafts collection. Product listings appear here when approved items are published.",
};

type ShopProps = {
  searchParams: Promise<{
    q?: string; category?: string; sort?: string; page?: string;
    minPrice?: string; maxPrice?: string; available?: string;
  }>;
};

export default function ShopPage(props: ShopProps) {
  return <Suspense fallback={<PageLoading label="Preparing the collection…" />}><ShopContent searchParams={props.searchParams} /></Suspense>;
}

async function ShopContent({ searchParams }: ShopProps) {
  const query = await searchParams;
  const catalog = await getCatalog({
    q: query.q,
    category: query.category,
    sort: query.sort,
    page: query.page,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    available: query.available,
  });
  const pageCount = Math.max(1, Math.ceil(catalog.total / catalog.pageSize));
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
    params.set("page", String(page));
    return `/shop?${params.toString()}`;
  };
  return (
    <main className="page-main">
      <div className="page-heading">
        <span className="eyebrow">The collection</span>
        <h1>Made to be <em>kept.</em></h1>
        <p>Thoughtful craft, meaningful gifting, and objects with a story—once the store’s real catalogue is ready.</p>
      </div>
      <div className="catalog-toolbar">
        <form action="/shop" className="catalog-filters">
          <label className="catalog-search">
            <span className="sr-only">Search products</span>
            <input name="q" placeholder="Search by name, category or detail" defaultValue={query.q} />
          </label>
          <label className="catalog-filter-label">Min ₹
            <input name="minPrice" type="number" min="0" step="1" defaultValue={query.minPrice} />
          </label>
          <label className="catalog-filter-label">Max ₹
            <input name="maxPrice" type="number" min="0" step="1" defaultValue={query.maxPrice} />
          </label>
          <label className="catalog-filter-label">Sort
            <select name="sort" defaultValue={query.sort ?? "newest"}>
              <option value="newest">Newest</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="bestsellers">Bestsellers</option>
            </select>
          </label>
          {query.category && <input type="hidden" name="category" value={query.category} />}
          <label className="availability-filter"><input name="available" type="checkbox" value="true" defaultChecked={query.available === "true"} /> In stock</label>
          <button className="button button-outline" type="submit">Apply</button>
        </form>
        <span>{catalog.total} {catalog.total === 1 ? "piece" : "pieces"}</span>
      </div>
      {Object.values(query).some(Boolean) && (
        <div className="active-filters">
          <span>Filters are applied</span>
          <Link href="/shop">Clear all</Link>
        </div>
      )}
      {!catalog.serviceAvailable ? (
        <div className="notice notice-muted">The live catalogue service is not configured or could not be reached. Search results and availability cannot be verified right now.</div>
      ) : catalog.items.length > 0 ? (
        <div className="product-grid">
          {catalog.items.map((product) => (
            <Link className="product-card" key={product.id} href={`/products/${product.slug}`}>
              <div className="product-image-placeholder">
                {product.image_url
                  ? <Image src={product.image_url} alt={product.name} fill sizes="(max-width: 760px) 48vw, 24vw" unoptimized />
                  : <span>Image to be added</span>}
              </div>
              <div className="product-card-copy">
                <span className="eyebrow">{product.available_quantity > 0 ? "Available" : "Out of stock"}</span>
                <h2>{product.name}</h2>
                <p>{product.short_description}</p>
                <strong>{formatRupees(product.sale_price_paise ?? product.price_paise)}</strong>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state catalog-empty">
          <span className="eyebrow">{query.q ? "No matching pieces" : "Collection in preparation"}</span>
          <h2>{query.q ? "Nothing found just yet." : "A collection worth waiting for."}</h2>
          <p>
            {query.q
              ? "Try another search, or clear your filters to explore the full collection."
              : "There are no published products in the catalogue yet. Real product details, prices, stock and images will appear here once supplied and approved."}
          </p>
          {query.q && <Link className="button button-outline" href="/shop">Clear search</Link>}
        </div>
      )}
      {catalog.total > catalog.pageSize && (
        <nav className="pagination" aria-label="Catalogue pages">
          {catalog.page > 1 ? <Link href={pageHref(catalog.page - 1)}>← Previous</Link> : <span />}
          <span>Page {catalog.page} of {pageCount}</span>
          {catalog.page < pageCount ? <Link href={pageHref(catalog.page + 1)}>Next →</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
