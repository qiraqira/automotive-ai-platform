import type { Metadata } from "next";

// Applies to every /admin/* page (login, dashboard, stories, ...) in one
// place — defense in depth alongside robots.txt's Disallow: /admin/
// (see src/app/robots.ts for why both matter).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
