export const metadata = {
  title: "Craft & culture | Kondapalli Crafts",
  description: "An introduction to the craft traditions this provisional store hopes to represent.",
};

export default function StoryPage() {
  return (
    <main className="page-main story-page">
      <span className="eyebrow">Craft, with care</span>
      <h1>Every object begins with <em>attention.</em></h1>
      <p className="story-lead">
        This space is reserved for the real people, process, place and material stories behind the collection.
      </p>
      <div className="notice notice-muted">
        <strong>A note on what is—and isn’t—here yet</strong>
        <p>
          No artisan partnerships, provenance, certification or product claims are published until verified details
          are supplied and approved by the store owner. This page is intentionally a placeholder for that first-hand story.
        </p>
      </div>
    </main>
  );
}
