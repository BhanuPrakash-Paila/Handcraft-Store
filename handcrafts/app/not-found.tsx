import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page-main empty-state not-found">
      <span className="eyebrow">A little detour</span>
      <h1>We couldn’t find that <em>page.</em></h1>
      <p>It may have moved, or the item is not currently published.</p>
      <Link className="button button-primary" href="/shop">Return to the collection</Link>
    </main>
  );
}
