import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/view/routes";

/** /robots.txt (NAV-18): every page may be crawled; the JSON endpoints may not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
