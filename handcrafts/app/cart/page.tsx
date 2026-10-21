import { CartClient } from "@/components/CartClient";

export const metadata = { title: "Your bag | Kondapalli Crafts" };

export default function CartPage() {
  return (
    <main className="page-main">
      <div className="page-heading page-heading-compact">
        <span className="eyebrow">Your selection</span>
        <h1>Your <em>bag.</em></h1>
      </div>
      <CartClient />
    </main>
  );
}
