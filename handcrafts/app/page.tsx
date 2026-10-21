import Link from "next/link";
import Image from "next/image";
import { getCatalog, getCategories, formatRupees } from "@/lib/store-api";

export default async function Home() {
  const [catalog, categories] = await Promise.all([
    getCatalog({ limit: "4", sort: "newest" }),
    getCategories(),
  ]);
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">A home for considered craft</span>
          <h1>Tradition,<br /><em>held close.</em></h1>
          <p>
            Discover wooden toys, thoughtful gifts and traditional crafts—selected with care,
            and shared with their stories intact.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/shop">Explore the collection <span>↗</span></Link>
            <Link className="text-link" href="/story">A note on our approach</Link>
          </div>
          <div className="hero-caption"><span className="caption-rule" />Kondapalli Crafts · A provisional store identity</div>
        </div>
        <div className="hero-art" role="img" aria-label="Decorative abstract illustration in warm craft-inspired colors; not product photography">
          <div className="art-sun" />
          <div className="art-arch">
            <div className="art-center">
              <span className="art-star">✳</span>
              <span className="art-dot dot-one" />
              <span className="art-dot dot-two" />
              <span className="art-dot dot-three" />
              <span className="art-dot dot-four" />
            </div>
          </div>
          <div className="art-plinth plinth-one" />
          <div className="art-plinth plinth-two" />
          <div className="art-label">Illustration · not product photography</div>
          <span className="art-side-note">OBJECTS WITH MEANING · OBJECTS TO KEEP</span>
        </div>
      </section>

      <section className="intro-strip">
        <p>Thoughtful things, made to find a place in your home.</p>
        <span>WOOD · COLOR · CULTURE</span>
      </section>

      {categories.length > 0 && (
        <section className="category-discovery section-pad">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Browse by collection</span>
              <h2>Find your <em>kind of craft.</em></h2>
            </div>
            <Link className="text-link" href="/shop">Shop all <span>↗</span></Link>
          </div>
          <nav className="category-links" aria-label="Product categories">
            {categories.map((category) => (
              <Link href={`/category/${category.slug}`} key={category.slug}>
                <span>{category.name}</span>
                <small>{category.product_count} {category.product_count === 1 ? "piece" : "pieces"}</small>
                <span aria-hidden="true">↗</span>
              </Link>
            ))}
          </nav>
        </section>
      )}

      <section className="collection-section section-pad">
        <div className="section-heading">
          <div>
            <span className="eyebrow">The collection</span>
            <h2>Pieces with a <em>point of view.</em></h2>
          </div>
          <Link className="text-link" href="/shop">View the collection <span>↗</span></Link>
        </div>
        {!catalog.serviceAvailable ? (
          <div className="notice notice-muted">The live catalogue service is not configured or could not be reached. Product availability has not been verified.</div>
        ) : catalog.items.length ? (
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
                  <h3>{product.name}</h3>
                  <p>{product.short_description}</p>
                  <strong>{formatRupees(product.sale_price_paise ?? product.price_paise)}</strong>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="collection-empty">
            <div className="empty-ornament" aria-hidden="true">✳</div>
            <div>
              <span className="eyebrow">Being prepared with care</span>
              <h3>The first pieces are not here yet.</h3>
              <p>The catalogue will show only real products with approved details, current prices, stock and images.</p>
            </div>
            <Link className="button button-outline" href="/shop">Visit the shop</Link>
          </div>
        )}
      </section>

      <section className="story-band">
        <div className="story-art" aria-hidden="true">
          <span>क</span><i /><b /><small>CRAFT / CULTURE / CARE</small>
        </div>
        <div className="story-copy">
          <span className="eyebrow">A story still being written</span>
          <h2>Good craft deserves<br />a <em>good story.</em></h2>
          <p>
            We’re making room for the makers, materials and histories behind each piece.
            When the details are verified, they’ll be told here—not guessed at.
          </p>
          <Link className="text-link" href="/story">Our promise of care <span>↗</span></Link>
        </div>
      </section>

      <section className="values-section section-pad">
        <div className="section-heading centered-heading">
          <div>
            <span className="eyebrow">A considered experience</span>
            <h2>Clear, honest, <em>thoughtful.</em></h2>
          </div>
        </div>
        <div className="value-grid">
          <article><span>01</span><h3>Details before claims</h3><p>Product and provenance information appears only when supplied and reviewed.</p></article>
          <article><span>02</span><h3>Real availability</h3><p>Prices and inventory are intended to come from the store’s live catalogue.</p></article>
          <article><span>03</span><h3>Clarity at every step</h3><p>Shipping, returns and support details will be published after owner review.</p></article>
        </div>
      </section>

      <section className="closing-cta">
        <span className="eyebrow">A new collection, taking shape</span>
        <h2>Make space for <em>meaning.</em></h2>
        <p>Browse when the collection is ready, or learn about the care behind the store.</p>
        <Link className="button button-light" href="/shop">Explore the shop <span>↗</span></Link>
      </section>
    </main>
  );
}
