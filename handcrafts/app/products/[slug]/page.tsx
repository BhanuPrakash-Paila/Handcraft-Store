import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ProductActions } from "@/components/ProductActions";
import { PageLoading } from "@/components/PageLoading";
import { formatRupees, getProduct } from "@/lib/store-api";
import { Suspense } from "react";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  return {
    title: product ? `${product.name} | Kondapalli Crafts` : "Product | Kondapalli Crafts",
    description: product?.short_description ?? "Product details from the Kondapalli Crafts collection.",
  };
}

export default function ProductPage(props: Props) {
  return <Suspense fallback={<PageLoading label="Loading product details…" />}><ProductContent params={props.params} /></Suspense>;
}

async function ProductContent({ params }: Props) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();
  const price = product.sale_price_paise ?? product.price_paise;
  const productUrl = process.env.NEXT_PUBLIC_SITE_URL
    ? new URL(`/products/${product.slug}`, process.env.NEXT_PUBLIC_SITE_URL).toString()
    : undefined;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.short_description || product.description,
    ...(product.sku ? { sku: product.sku } : {}),
    ...(product.images.length ? { image: product.images.map((image) => image.url) } : {}),
    offers: {
      "@type": "Offer",
      priceCurrency: product.currency,
      price: (Number(price) / 100).toFixed(2),
      availability: product.available_quantity > 0
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      ...(productUrl ? { url: productUrl } : {}),
    },
  };

  return (
    <main className="page-main product-detail">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <div className="product-gallery">
        <div className="product-main-image">
          {product.images[0]
            ? <Image src={product.images[0].url} alt={product.images[0].altText} fill sizes="(max-width: 760px) 100vw, 54vw" preload unoptimized />
            : <><span aria-hidden="true">✳</span><p>Product photography<br />will appear here</p></>}
        </div>
        {product.images.length > 1 && (
          <div className="product-thumbnails">
            {product.images.map((image) => (
              <div key={image.url} className="product-thumbnail">
                <Image src={image.url} alt={image.altText} fill sizes="100px" unoptimized />
              </div>
            ))}
          </div>
        )}
      </div>
      <section className="product-information">
        <span className="eyebrow">From the collection</span>
        <h1>{product.name}</h1>
        <div className="product-price">{formatRupees(price)}</div>
        <p className="product-description">{product.short_description || product.description}</p>
        {product.available_quantity > 0 ? (
          <p className="availability">Available · {product.available_quantity} in current inventory</p>
        ) : (
          <p className="availability availability-muted">Currently unavailable</p>
        )}
        <ProductActions productId={product.id} variants={product.variants} available={product.available_quantity} />
        <div className="product-facts">
          {product.sku && <div><span>SKU</span><strong>{product.sku}</strong></div>}
          {product.materials && <div><span>Materials</span><strong>{product.materials}</strong></div>}
          {product.dimensions && <div><span>Dimensions</span><strong>{product.dimensions}</strong></div>}
          <p>Only verified product specifications are shown. Delivery and return conditions depend on the store’s approved policies.</p>
        </div>
      </section>
    </main>
  );
}
