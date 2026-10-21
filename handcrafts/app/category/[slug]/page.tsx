import { notFound } from "next/navigation";
import { getCatalog, formatRupees } from "@/lib/store-api";
import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { PageLoading } from "@/components/PageLoading";
import type { Metadata } from "next";

const readableSlug = (slug: string) =>
  slug.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");

export async function generateMetadata({
  params,
}: CategoryProps): Promise<Metadata> {
  const { slug } = await params;
  const categoryName = readableSlug(slug);
  return {
    title: `${categoryName} | Kondapalli Crafts`,
    description: `Browse published items in ${categoryName}. Only approved product information is listed.`,
  };
}

type CategoryProps = {
  params: Promise<{ slug: string }>;
};

export default function CategoryPage(props: CategoryProps) {
  return <Suspense fallback={<PageLoading label="Loading this collection…" />}><CategoryContent params={props.params} /></Suspense>;
}

async function CategoryContent({ params }: CategoryProps) {
  const { slug } = await params;
  const catalog = await getCatalog({ category: slug });
  if (catalog.serviceAvailable && !catalog.total && catalog.items.length === 0) notFound();
  return (
    <main className="page-main">
      <div className="page-heading">
        <span className="eyebrow">Browse by collection</span>
        <h1>{readableSlug(slug)}<em>.</em></h1>
        <p>{catalog.serviceAvailable
          ? `${catalog.total} published ${catalog.total === 1 ? "piece" : "pieces"} in this collection.`
          : "Connect the live catalogue to verify this collection."}</p>
      </div>
      {!catalog.serviceAvailable ? (
        <div className="notice notice-muted">The live catalogue service is not configured or could not be reached. This collection cannot be verified right now.</div>
      ) : (
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
      )}
    </main>
  );
}
