// Shared image-list helpers for any article summary shape carrying real
// HERO-role photos — extracted 2026-09-16 (was duplicated across
// page.tsx and comparisons/page.tsx, about to be duplicated a third
// time) once GET /v1/featured-articles and GET /v1/stories started
// returning up to 2 HERO images instead of 1 (see LeadMedia's own
// comment below for the real bug this fixes). `ArticleImageRef` is
// deliberately its own small structural type rather than importing
// FeaturedArticleSummary from "@/lib/api" — every list this renders
// (featured articles, stories, topic articles) already returns this
// exact `{ altText, image: {...} }[]` shape, and a structural type here
// lets all of them use it without depending on one specific summary
// interface.
export interface ArticleImageRef {
  altText: string | null;
  image: { originalUrl: string; rightsStatus?: string; width: number | null; height: number | null };
}

import { clampedAspectRatio, pairedAspectRatio } from "@/lib/image-aspect";

export function isLogoImage(images: ArticleImageRef[]): boolean {
  const img = images[0]?.image;
  if (!img) return false;
  return img.rightsStatus === "EDITORIAL_ONLY" || img.originalUrl.toLowerCase().includes("logo");
}

// Added 2026-09-16, user's own direct complaint: a COMPARISON article
// (real, two HERO-role images — one per car, see publish-manual-
// article.ts's heroImagePair) showed only its FIRST hero photo in every
// list that renders one — GET /v1/featured-articles and GET /v1/stories
// both capped `images` at `take: 1` (since bumped to 2) — so a reader
// saw one single car photo next to a headline reading "Tesla Model 3
// vs. Toyota Corolla" with no visual sense that two different cars were
// even being discussed. Renders both real photos side by side, at one
// SHARED aspect ratio (pairedAspectRatio, not each image's own — see
// that function's own comment for why two independently-clamped ratios
// made an unrelated real bug: two photos of genuinely different real
// shapes rendering at two different heights). Falls back to the
// original single-image rendering for every non-comparison article,
// which only ever has one HERO image.
export function LeadMedia({
  images,
  isLogo,
  fallbackAlt,
  width = 440,
  borderRadius = 6,
  marginBottom = 12,
}: {
  images: ArticleImageRef[];
  isLogo: boolean;
  fallbackAlt: string;
  // number (px) for a fixed-width lead image, or a CSS width string
  // (e.g. "100%") to let a grid cell control the size instead — added
  // 2026-09-16 so the same component covers both the single big lead
  // photo and a grid of same-sized secondary-story photos.
  width?: number | string;
  // Added 2026-09-16 for ContentCard.tsx: a card already rounds+clips
  // its own outer corners (`.premium-card`), so the image's own
  // independent corner radius double-rounds against it — pass 0 there.
  borderRadius?: number;
  marginBottom?: number;
}) {
  if (images.length === 0 || isLogo) return null;
  if (images.length === 1) {
    const img = images[0]!;
    return (
      // eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment
      <img
        src={img.image.originalUrl}
        alt={img.altText ?? fallbackAlt}
        style={{
          width,
          maxWidth: "100%",
          aspectRatio: String(clampedAspectRatio(img.image.width, img.image.height)),
          objectFit: "contain",
          background: "var(--surface-alt, rgba(128,128,128,0.06))",
          borderRadius,
          marginBottom,
          display: "block",
        }}
      />
    );
  }
  const [left, right] = images;
  const sharedRatio = String(pairedAspectRatio(left!.image, right!.image));
  return (
    <div style={{ width, maxWidth: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom }}>
      {[left, right].map((img, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment
        <img
          key={i}
          src={img!.image.originalUrl}
          alt={img!.altText ?? fallbackAlt}
          style={{ width: "100%", aspectRatio: sharedRatio, objectFit: "contain", background: "var(--surface-alt, rgba(128,128,128,0.06))", borderRadius, display: "block" }}
        />
      ))}
    </div>
  );
}

// Same idea as LeadMedia above but for a small 96×64 list row — splits
// into two ~46×64 photos side by side instead of one, same "who vs
// whom" fix at a smaller size.
export function ListRowMedia({ images, isLogo, fallbackAlt }: { images: ArticleImageRef[]; isLogo: boolean; fallbackAlt: string }) {
  if (images.length === 0) return null;
  const boxStyle = { objectFit: "contain" as const, background: isLogo ? "#fff" : "var(--surface-alt, rgba(128,128,128,0.06))", padding: isLogo ? 6 : undefined, borderRadius: 4 };
  if (images.length === 1) {
    const img = images[0]!;
    return (
      // eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment
      <img src={img.image.originalUrl} alt={img.altText ?? fallbackAlt} style={{ width: 96, height: 64, flexShrink: 0, ...boxStyle }} />
    );
  }
  const [left, right] = images;
  return (
    <div style={{ display: "flex", gap: 4, width: 96, height: 64, flexShrink: 0 }}>
      {[left, right].map((img, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment
        <img key={i} src={img!.image.originalUrl} alt={img!.altText ?? fallbackAlt} style={{ width: 46, height: 64, ...boxStyle }} />
      ))}
    </div>
  );
}
