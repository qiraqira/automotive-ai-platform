import type { Metadata } from "next";
import Link from "next/link";
import { search } from "@/lib/api";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: true }, // spec §31: don't index search result pages themselves
};

// spec §32 global search — MVP scope: Stories + CarModels/Brands, the two
// real content types that exist today. A plain <form method="get">, not a
// client component: this needs no client JS at all — a real GET
// navigation to /search?q=... is exactly what a search box needs.
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const results = q ? await search(q) : null;

  return (
    <section>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Search</h1>
      <form method="get" action="/search" style={{ marginBottom: 24 }}>
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search stories, cars, brands…"
          style={{ padding: 8, width: "100%", maxWidth: 400, fontSize: 16 }}
        />
      </form>

      {results && (
        <>
          {results.stories.length > 0 && (
            <>
              <h2 style={{ fontSize: 16 }}>Stories</h2>
              <ul className="story-list">
                {results.stories.map((s) => (
                  <li key={s.id} className="story-item">
                    {s.articleSlug ? <Link href={`/articles/en/${s.articleSlug}`}>{s.title}</Link> : s.title}
                  </li>
                ))}
              </ul>
            </>
          )}
          {results.carModels.length > 0 && (
            <>
              <h2 style={{ fontSize: 16 }}>Cars</h2>
              <ul className="story-list">
                {results.carModels.map((c) => (
                  <li key={`${c.brandSlug}/${c.modelSlug}`} className="story-item">
                    <a href={`/cars/${c.brandSlug}/${c.modelSlug}`}>{c.name}</a>
                  </li>
                ))}
              </ul>
            </>
          )}
          {results.stories.length === 0 && results.carModels.length === 0 && <p>No results for “{q}”.</p>}
        </>
      )}
    </section>
  );
}
