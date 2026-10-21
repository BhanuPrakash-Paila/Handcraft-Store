import { AccountPanel } from "@/components/AccountPanel";

export const metadata = { title: "Your account | Kondapalli Crafts" };

export default function AccountPage() {
  return (
    <main className="page-main account-page">
      <div className="page-heading page-heading-compact">
        <span className="eyebrow">Your details, kept secure</span>
        <h1>Your <em>account.</em></h1>
      </div>
      <AccountPanel />
    </main>
  );
}
