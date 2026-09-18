import type { Metadata } from "next";
import Link from "next/link";
import { buildHreflangAlternates, buildLocaleUrl, buildBreadcrumbJsonLd, safeJsonLdString } from "@automotive/seo";
import { getFeaturedCars, getCompare, type FeaturedCar, type CompareCar } from "@/lib/api";
import { clampedAspectRatio } from "@/lib/image-aspect";

const SITE_URL = process.env.PUBLIC_URL ?? "https://DOMAIN.COM";
const SITE_NAME = process.env.PROJECT_NAME ?? "PROJECT_NAME";

// User's own ask, 2026-09-16, made after reading homepage-engagement
// research together (Reuters Institute Digital News Report: audiences
// want a format/tool that serves their own task, not just more curated
// articles — and a car-site visitor's task is almost always "which of
// these two"). Every real trim/engine/photo already exists per model
// (catalogReviewedAt-gated, same as every other public car page); this
// just lets a visitor pick any two instead of only the pairs an editor
// happened to write a bespoke "X vs Y" article about.
//
// A plain GET form + server component, not a client-side picker — this
// app's own house style (see HeaderNav.tsx's comment: the ONLY client
// component here is the one that truly needs open/close state). Picking
// a car submits the form and reloads with `?a=brand|model&b=brand|model`
// in the URL, which also makes a specific comparison a real, shareable,
// bookmarkable link — not just client-side state that vanishes on
// refresh.
function parseSelection(value: string | undefined): { brandSlug: string; modelSlug: string } | null {
  if (!value) return null;
  const [brandSlug, modelSlug] = value.split("|");
  if (!brandSlug || !modelSlug) return null;
  return { brandSlug, modelSlug };
}

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }): Promise<Metadata> {
  const { a, b } = await searchParams;
  const path = "/compare";
  const alternates = buildHreflangAlternates(SITE_URL, path);
  const selA = parseSelection(a);
  const selB = parseSelection(b);
  const title =
    selA && selB
      ? `${selA.modelSlug.replace(/-/g, " ")} vs ${selB.modelSlug.replace(/-/g, " ")}: Compare specs & trims`
      : "Compare Any Two Cars — Real Specs & Trims";
  return {
    title,
    description: "Pick any two reviewed cars in the catalog and compare their real trims, engines and specs side by side — every figure sourced and checked, not a guess.",
    alternates: {
      canonical: buildLocaleUrl(SITE_URL, "en", path),
      languages: Object.fromEntries(alternates.map((a2) => [a2.hreflang, a2.href])),
    },
  };
}

function groupByBrand(cars: FeaturedCar[]): Map<string, FeaturedCar[]> {
  const map = new Map<string, FeaturedCar[]>();
  for (const car of cars) {
    const list = map.get(car.brandName) ?? [];
    list.push(car);
    map.set(car.brandName, list);
  }
  return new Map([...map.entries()].sort(([x], [y]) => x.localeCompare(y)));
}

function PickerSelect({ name, cars, selected, label }: { name: string; cars: FeaturedCar[]; selected: string | null; label: string }) {
  const grouped = groupByBrand(cars);
  return (
    <label style={{ display: "block", flex: "1 1 220px", minWidth: 200 }}>
      <span style={{ display: "block", fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-muted)", marginBottom: 6 }}>
        {label}
      </span>
      <select
        name={name}
        defaultValue={selected ?? ""}
        style={{ width: "100%", padding: "12px 14px", fontFamily: "var(--font-sans)", fontSize: 15, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)" }}
      >
        <option value="" disabled>
          Choose a car…
        </option>
        {[...grouped.entries()].map(([brandName, brandCars]) => (
          <optgroup key={brandName} label={brandName}>
            {brandCars.map((car) => (
              <option key={`${car.brandSlug}|${car.modelSlug}`} value={`${car.brandSlug}|${car.modelSlug}`}>
                {car.brandName} {car.modelName}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

// Premium redesign, 2026-09-18 — same card shell (rounded, elevated,
// var(--font-sans) typography) as every ContentCard on the rest of the
// site, though this stays its own component rather than reusing
// ContentCard directly: a compare column mixes a clickable header with
// a large block of non-clickable data (facts table, trim list) below
// it, unlike ContentCard's "whole card is one Link" shape.
function CarColumn({ car }: { car: CompareCar }) {
  return (
    <div style={{ flex: "1 1 280px", minWidth: 240, borderRadius: "var(--radius-card, 12px)", overflow: "hidden", background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
      <Link href={`/cars/${car.brandSlug}/${car.modelSlug}`} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
        {car.heroImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs's comment
          <img
            src={car.heroImageUrl}
            alt={`${car.brandName} ${car.modelName}`}
            style={{
              width: "100%",
              aspectRatio: String(clampedAspectRatio(car.heroImageWidth, car.heroImageHeight)),
              objectFit: "contain",
              background: "var(--surface-alt, rgba(128,128,128,0.06))",
              display: "block",
            }}
          />
        )}
        <h2 style={{ fontFamily: "var(--font-sans)", fontSize: 20, fontWeight: 700, margin: 0, padding: "16px 18px 0" }}>
          {car.brandName} {car.modelName}
        </h2>
      </Link>
      <div style={{ padding: "0 18px 20px" }}>
        {car.generation && (
          <div style={{ fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--ink-dim)", margin: "4px 0 16px" }}>
            {car.generation.name}
            {car.generation.startYear ? ` (${car.generation.startYear}–${car.generation.endYear ?? "present"})` : ""}
          </div>
        )}
        {car.facts.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16, fontFamily: "var(--font-sans)", fontSize: 14 }}>
            <tbody>
              {car.facts.map((fact, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "6px 0", color: "var(--ink-dim)" }}>{fact.attribute.replace(/_/g, " ")}</td>
                  <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 600 }}>
                    {fact.value}
                    {fact.unit ? ` ${fact.unit}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {car.generation && car.generation.trims.length > 0 ? (
          <>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-muted)", marginBottom: 6 }}>
              Trims
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", fontFamily: "var(--font-sans)" }}>
              {car.generation.trims.map((trim, i) => (
                <li key={i} style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
                  <div style={{ fontWeight: 600 }}>{trim.name}</div>
                  {trim.engineName && <div style={{ fontSize: 13.5, color: "var(--ink-dim)" }}>{trim.engineName}</div>}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p style={{ fontFamily: "var(--font-sans)", fontSize: 14, color: "var(--ink-dim)" }}>No trim data published for the current generation yet.</p>
        )}
      </div>
    </div>
  );
}

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const { a, b } = await searchParams;
  const selA = parseSelection(a);
  const selB = parseSelection(b);

  const [{ carModels: featuredCars }, compareResult] = await Promise.all([
    getFeaturedCars(),
    selA && selB ? getCompare(selA.brandSlug, selA.modelSlug, selB.brandSlug, selB.modelSlug) : Promise.resolve(null),
  ]);

  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Home", url: SITE_URL },
    { name: "Compare", url: `${SITE_URL}/compare` },
  ]);

  return (
    <div className="wrap" style={{ paddingTop: 24, paddingBottom: 60 }}>
      {/* eslint-disable-next-line react/no-danger -- JSON-LD, not user content */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLdString(breadcrumbJsonLd) }} />
      <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 6 }}>
        Compare
      </div>
      <h1 style={{ fontFamily: "var(--font-sans)", fontSize: "clamp(26px, 3.5vw, 36px)", fontWeight: 800, margin: "0 0 10px", lineHeight: 1.15 }}>
        Compare any two cars
      </h1>
      <p style={{ fontFamily: "var(--font-sans)", fontSize: 15.5, color: "var(--ink-dim)", maxWidth: "52em", marginBottom: 32, lineHeight: 1.6 }}>
        Pick any two reviewed cars in the catalog — real trims, engines and specs, side by side. Every figure sourced and checked, same as every
        other page on this site, {SITE_NAME}.
      </p>

      <form method="get" style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 40, paddingBottom: 24, borderBottom: "1px solid var(--line)" }}>
        <PickerSelect name="a" cars={featuredCars} selected={a ?? null} label="Car A" />
        <PickerSelect name="b" cars={featuredCars} selected={b ?? null} label="Car B" />
        <button
          type="submit"
          style={{ padding: "12px 24px", fontFamily: "var(--font-sans)", fontSize: 15, fontWeight: 600, borderRadius: 10, border: "none", background: "var(--accent, #1a1a1a)", color: "#fff", cursor: "pointer" }}
        >
          Compare
        </button>
      </form>

      {selA && selB && !compareResult && (
        <p style={{ fontFamily: "var(--font-sans)", fontSize: 14.5, color: "var(--ink-dim)" }}>
          One or both of those cars couldn&rsquo;t be found — try picking again from the dropdowns above.
        </p>
      )}

      {compareResult && (
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
          <CarColumn car={compareResult.cars[0]} />
          <CarColumn car={compareResult.cars[1]} />
        </div>
      )}
    </div>
  );
}
