import { CheckoutForm } from "@/components/CheckoutForm";

export const metadata = {
  title: "Checkout | Kondapalli Crafts",
  description: "Secure checkout. Online payment remains disabled until Razorpay configuration is verified.",
};

export default function CheckoutPage() {
  return (
    <main className="page-main checkout-page">
      <div className="page-heading page-heading-compact">
        <span className="eyebrow">A considered final step</span>
        <h1>Delivery <em>details.</em></h1>
      </div>
      <CheckoutForm />
    </main>
  );
}
