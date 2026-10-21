import { OrderConfirmation } from "@/components/OrderConfirmation";
import { Suspense } from "react";
import { PageLoading } from "@/components/PageLoading";

export const metadata = { title: "Order details | Kondapalli Crafts" };

type OrderProps = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ access?: string }>;
};

export default function OrderPage(props: OrderProps) {
  return <Suspense fallback={<PageLoading label="Retrieving your order…" />}><OrderContent {...props} /></Suspense>;
}

async function OrderContent({
  params,
  searchParams,
}: OrderProps) {
  const [{ orderNumber }, { access }] = await Promise.all([params, searchParams]);
  return (
    <main className="page-main">
      <OrderConfirmation orderNumber={orderNumber} accessToken={access} />
    </main>
  );
}
