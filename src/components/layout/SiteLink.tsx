import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * Every in-site link goes through this: `next/link` with prefetching off, always.
 *
 * Why. Every page renders at request time (src/app/layout.tsx), so a prefetch of a page
 * route is a function invocation that returns no page data (154–218 bytes for a dynamic
 * route). With prefetching on, one Chromium page view made 28–84 prefetch requests beyond
 * the document, measured on 2026-11-16 against a local production build: 84 on `/` (nav,
 * footer, game cards and team links), 64 on `/teams/bos`, 44 on `/record`, 28 on `/about`.
 * On Vercel Hobby (a monthly allowance of invocations and Active CPU) that multiplies the
 * cost of every view for nothing. Navigation feedback comes from NavProgress instead.
 *
 * `prefetch` cannot be passed: the policy is the same for every link. ESLint's
 * `no-restricted-imports` (eslint.config.mjs) keeps `next/link` out of every other file.
 */
export function SiteLink(props: Omit<ComponentProps<typeof Link>, "prefetch">) {
  return <Link {...props} prefetch={false} />;
}
