import Link from "next/link";
import { LeadMedia, type ArticleImageRef } from "./ArticleMedia";

// Shared "premium" content card, 2026-09-16 redesign (user's own two
// approved mockups) — one component instead of three near-identical
// hand-rolled card layouts for Comparisons/News/Guides, all of which
// share the same real shape: a real photo on top, a small badge, a
// title, and an optional one-line description. Uses `.premium-card`
// (globals.css) for the shared shadow/radius/hover-lift.
export function ContentCard({
  href,
  images,
  isLogo,
  fallbackAlt,
  badge,
  title,
  description,
  linkText,
  logoUrl,
}: {
  href: string;
  images: ArticleImageRef[];
  isLogo: boolean;
  fallbackAlt: string;
  badge: string;
  title: React.ReactNode;
  description?: string | null;
  linkText?: string;
  // Added 2026-09-18 for /brands — a small trademark badge next to the
  // title, distinct from `images`/LeadMedia above: LeadMedia
  // deliberately never renders a logo as the card's own lead photo (see
  // its own `isLogo` early-return), which is correct for an article
  // whose real subject is a car, but wrong here, where the logo IS the
  // subject. Optional and independent of `images` so every other
  // ContentCard caller is unaffected.
  logoUrl?: string | null;
}) {
  return (
    <Link href={href} className="premium-card">
      <div style={{ position: "relative" }}>
        <LeadMedia images={images} isLogo={isLogo} fallbackAlt={fallbackAlt} width="100%" borderRadius={0} marginBottom={0} />
        {images.length > 0 && !isLogo && (
          <span
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              fontFamily: "var(--font-sans)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "#fff",
              background: "rgba(15,18,23,0.85)",
              padding: "4px 10px",
              borderRadius: 100,
            }}
          >
            {badge}
          </span>
        )}
      </div>
      <div style={{ padding: "16px 18px 20px" }}>
        <h3 style={{ fontFamily: "var(--font-sans)", fontSize: 19, fontWeight: 700, margin: "0 0 6px", lineHeight: 1.3, display: "flex", alignItems: "center", gap: 10 }}>
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment
            <img
              src={logoUrl}
              alt=""
              style={{ width: 28, height: 28, objectFit: "contain", background: "#fff", borderRadius: 6, padding: 3, flexShrink: 0 }}
            />
          )}
          <span>{title}</span>
        </h3>
        {description && <p style={{ fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--ink-dim)", margin: "0 0 10px", lineHeight: 1.5 }}>{description}</p>}
        {linkText && <span style={{ fontFamily: "var(--font-sans)", fontSize: 13.5, fontWeight: 600, color: "var(--accent)" }}>{linkText} →</span>}
      </div>
    </Link>
  );
}
