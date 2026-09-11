import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";
import { formatCountryName } from "@automotive/utils";
import { getBrand } from "@/lib/api";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";

// Real brand hub page (vertical-slice plan, 2026-09-11, spec's "Brand
// Pages" section): a person searching "BMW" should land somewhere that
// lists every real BMW model this site covers plus its real news, not
// just whichever single model page they happened to land on. Same
// hreflang/canonical shape as the car-model page's own generateMetadata —
// the /es/ edition doesn't exist yet, but declaring the alternate now
// costs nothing and documents the intended URL for when it does.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const path = `/brands/${slug}`;
  const alternates = buildHreflangAlternates(SITE_URL, path);
  return {
    alternates: {
      canonical: buildLocaleUrl(SITE_URL, "en", path),
      languages: Object.fromEntries(alternates.map((a) => [a.hreflang, a.href])),
    },
  };
}

export default async function BrandPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getBrand(slug);
  if (!result) notFound();
  const { brand, relatedStories } = result;

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Home", url: SITE_URL },
    { name: brand.name, url: `${SITE_URL}/brands/${slug}` },
  ]);

  return (
    <article>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: safeJsonLdString(breadcrumbJsonLd) }}
      />
      {brand.country && <div className="story-meta">{formatCountryName(brand.country)}</div>}
      <h1 style={{ fontSize: 32, margin: "4px 0 20px" }}>{brand.name}</h1>

      {brand.models.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16 }}>Models</h2>
          <ul className="story-list">
            {brand.models.map((m) => (
              <li key={m.slug} className="story-item">
                <Link href={`/cars/${slug}/${m.slug}`}>{m.name}</Link>
                {m.generationCount > 0 && (
                  <span className="story-meta">
                    {" "}
                    — {m.generationCount} generation{m.generationCount === 1 ? "" : "s"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {relatedStories.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16 }}>Latest {brand.name} news</h2>
          <ul className="story-list">
            {relatedStories.map((story) => (
              <li key={story.id} className="story-item">
                {story.articleSlug ? <Link href={`/articles/en/${story.articleSlug}`}>{story.title}</Link> : story.title}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
