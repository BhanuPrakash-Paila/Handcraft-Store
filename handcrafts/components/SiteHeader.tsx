import Link from "next/link";
import { getCategories } from "@/lib/store-api";

export async function SiteHeader() {
  const categories = await getCategories();
  return (
    <>
      <div className="announcement">
        <span>Thoughtful objects, rooted in Indian craft traditions</span>
        <Link href="/policies/shipping">Shipping details</Link>
      </div>
      <header className="site-header">
        <Link href="/" className="brand" aria-label="Kondapalli Crafts home">
          <span className="brand-mark" aria-hidden="true">क</span>
          <span className="brand-name">Kondapalli <em>Crafts</em></span>
        </Link>
        <nav className="main-nav" aria-label="Main navigation">
          <Link href="/shop">Shop all</Link>
          {categories.map((category) => (
            <Link href={`/category/${category.slug}`} key={category.slug}>{category.name}</Link>
          ))}
          <Link href="/story">Our story</Link>
        </nav>
        <div className="header-actions">
          <form className="header-search" action="/shop">
            <label className="sr-only" htmlFor="site-search">Search products</label>
            <input id="site-search" name="q" placeholder="Search the collection" />
            <button aria-label="Search" type="submit">⌕</button>
          </form>
          <Link className="icon-link account-link" href="/account">Account</Link>
          <Link className="icon-link cart-link" href="/cart">Bag <span aria-hidden="true">↗</span></Link>
        </div>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-top">
        <div className="footer-brand">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true">क</span>
            <span className="brand-name">Kondapalli <em>Crafts</em></span>
          </Link>
          <p>A considered home for traditional crafts and thoughtful gifts.</p>
          <small>Brand, collection and business details are provisional until confirmed by the store owner.</small>
        </div>
        <div>
          <h2>Explore</h2>
          <Link href="/shop">Shop all</Link>
          <Link href="/story">Craft &amp; culture</Link>
          <Link href="/account">Your account</Link>
        </div>
        <div>
          <h2>Information</h2>
          <Link href="/policies/shipping">Shipping</Link>
          <Link href="/policies/returns">Returns &amp; refunds</Link>
          <Link href="/policies/privacy">Privacy</Link>
          <Link href="/policies/terms">Terms</Link>
        </div>
        <div>
          <h2>Get in touch</h2>
          <p>Support details will be published here once provided by the store owner.</p>
          <Link href="/policies/contact">Contact &amp; support</Link>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© Kondapalli Crafts · Provisional brand</span>
        <span>Made with care for craft, without unverified claims.</span>
      </div>
    </footer>
  );
}
