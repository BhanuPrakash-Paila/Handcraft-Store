import Link from "next/link";
import { AdminDashboard } from "@/components/AdminDashboard";

export const metadata = { title: "Store administration | Kondapalli Crafts" };

export default function AdminPage() {
  return (
    <main className="page-main admin-page">
      <div className="page-heading">
        <span className="eyebrow">Restricted workspace</span>
        <h1>Store <em>administration.</em></h1>
        <p>Every operation is authorized by the server. Administrator access must be explicitly provisioned by the owner.</p>
        <Link className="text-link" href="/account">Sign in to your account ↗</Link>
      </div>
      <AdminDashboard />
    </main>
  );
}
