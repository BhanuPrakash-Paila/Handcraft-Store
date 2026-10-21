import { notFound } from "next/navigation";

const pages: Record<string, { title: string; note: string }> = {
  shipping: {
    title: "Shipping & delivery",
    note: "Shipping charges, destinations, handling times, courier details and delivery estimates must be confirmed by the store owner before this policy is published.",
  },
  returns: {
    title: "Returns & refunds",
    note: "Return eligibility, time limits, damaged-item handling, cancellation terms and refund processing details require business and legal review.",
  },
  privacy: {
    title: "Privacy",
    note: "The final privacy notice must describe actual data handling, processors, retention, customer rights and applicable Indian privacy requirements.",
  },
  terms: {
    title: "Terms & conditions",
    note: "Business identity, product terms, applicable law, consumer rights and dispute processes need owner and legal review before launch.",
  },
  contact: {
    title: "Contact & customer support",
    note: "A verified support email address, phone number and service hours have not been supplied yet.",
  },
};

export function generateStaticParams() {
  return Object.keys(pages).map((slug) => ({ slug }));
}

export default async function PolicyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const content = pages[slug];
  if (!content) notFound();
  return (
    <main className="page-main policy-page">
      <span className="eyebrow">Store information · Draft</span>
      <h1>{content.title}<em>.</em></h1>
      <div className="notice notice-warning">
        <strong>Owner review required before launch</strong>
        <p>{content.note}</p>
      </div>
      <p className="policy-placeholder">This page intentionally contains a review placeholder rather than invented business policy.</p>
    </main>
  );
}
