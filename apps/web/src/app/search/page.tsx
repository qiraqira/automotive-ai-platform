import type { Metadata } from "next";
import { search } from "@/lib/api";
import { ContentCard } from "@/components/ContentCard";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: true }, // spec §31: don't index search result pages themselves
};

// spec §32 global search — MVP scope: Stories + CarModels/Brands, the two
// real content types that exist today. A plain <form method="get">, not a
// client component: this needs no client JS at all — a real GET
// navigation to /search?q=... is exactly what a search box needs.
//
// Premium redesign, 2026-09-18 — user's own direct ask to bring /search
// in line with the same ContentCard-grid style already applied to
// /news, /guides, /comparisons, /topics/[slug] and /brands. Neither
// SearchResults shape carries a photo (see `SearchResults` in
// lib/api.ts), so every card here renders as the same photo-less text
// card /brands already established, not a new pattern.
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const results = q ? await search(q) : null;

  return (
    <section>
      <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 6 }}>
        Search
      </div>
      <h1 style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(26px, 3.5vw, 36px)", fontWeight: 800, margin: "0 0 24px", lineHeight: 1.15 }}>
        Search stories, cars &amp; brands
      </h1>
      <form method="get" action="/search" style={{ marginBottom: 40 }}>
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search stories, cars, brands…"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 16,
            padding: "12px 16px",
            width: "100%",
            maxWidth: 440,
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "var(--surface-alt, rgba(128,128,128,0.06))",
            color: "inherit",
          }}
        />
      </form>

      {results && (
        <>
          {results.stories.length > 0 && (
            <div style={{ marginBottom: 48 }}>
              <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 20 }}>
                Stories
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 24 }}>
                {results.stories.map((s) => (
                  <ContentCard
                    key={s.id}
                    href={s.articleSlug ? `/articles/en/${s.articleSlug}` : "/search"}
                    images={[]}
                    isLogo={false}
                    fallbackAlt={s.title}
                    badge="Story"
                    title={s.title}
                  />
                ))}
              </div>
            </div>
          )}
          {results.carModels.length > 0 && (
            <div>
              <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 20 }}>
                Cars
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 24 }}>
                {results.carModels.map((c) => (
                  <ContentCard
                    key={`${c.brandSlug}/${c.modelSlug}`}
                    href={`/cars/${c.brandSlug}/${c.modelSlug}`}
                    images={[]}
                    isLogo={false}
                    fallbackAlt={c.name}
                    badge="Car"
                    title={c.name}
                  />
                ))}
              </div>
            </div>
          )}
          {results.stories.length === 0 && results.carModels.length === 0 && (
            <p style={{ fontFamily: "var(--font-sans)", color: "var(--ink-dim)" }}>No results for &ldquo;{q}&rdquo;.</p>
          )}
        </>
      )}
    </section>
  );
}
