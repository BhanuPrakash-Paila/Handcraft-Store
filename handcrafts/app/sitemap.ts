import type { MetadataRoute } from "next";
import { getCatalog, getCategories } from "@/lib/store-api";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!baseUrl) return [];
  const firstPage = await getCatalog({ limit: "48", page: "1" });
  const pageCount = Math.ceil(firstPage.total / 48);
  const remainingPages = await Promise.all(
    Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) =>
      getCatalog({ limit: "48", page: String(index + 2) }),
    ),
  );
  const categories = await getCategories();
  const products = [firstPage, ...remainingPages].flatMap((page) => page.items);
  return [
    { url: baseUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/shop`, changeFrequency: "daily", priority: 0.8 },
    { url: `${baseUrl}/story`, changeFrequency: "monthly", priority: 0.5 },
    ...categories.map((category) => ({
      url: `${baseUrl}/category/${category.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...products.map((product) => ({
      url: `${baseUrl}/products/${product.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
