import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Kondapalli Crafts | Tradition, Handcrafted with Love",
    template: "%s | Kondapalli Crafts",
  },
  description:
    "A considered home for traditional crafts and thoughtful gifts. Brand and store details remain provisional until confirmed.",
  applicationName: "Kondapalli Crafts",
  openGraph: {
    title: "Kondapalli Crafts",
    description: "A considered home for traditional crafts and thoughtful gifts.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
