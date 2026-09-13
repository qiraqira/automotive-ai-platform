// Real gap found 2026-09-14 while doing an SEO pass on the car model
// page: it emitted a BreadcrumbList (from breadcrumb.ts) and nothing
// else — no structured data describing what the page is actually
// about, the same gap article.ts closed for article pages 2026-09-09.
// Schema.org's own `Car` type (a Vehicle/Product subtype) is the
// correct one for a page like this; Google scopes its dedicated
// Vehicle Listing rich-result UI to a separate merchant program, but
// the markup itself still helps a crawler correctly associate this
// page with the real-world entity (semantic SEO — the same reasoning
// that justifies Organization/WebSite schema on every page) — filled
// in only with fields this project genuinely has real data for. No
// price/rating/offers fields: this isn't a listing and fabricating
// those to chase a rich-result UI it isn't eligible for would violate
// this project's own "don't invent specifications" rule.

export interface CarJsonLdInput {
  brandName: string;
  modelName: string;
  description: string;
  url: string;
  imageUrl?: string;
  /** e.g. ["Gasoline", "Hybrid", "Electric"] — distinct real fuel types
   * across every generation this page actually lists, deduplicated. */
  fuelTypes?: string[];
  /** The most recent generation's own name, e.g. "G05 (fourth generation)". */
  currentModelName?: string;
  /** e.g. "2018" (current generation's start year) — a real, sourced year, not "present". */
  modelDate?: string;
}

export function buildCarJsonLd(input: CarJsonLdInput) {
  return {
    "@context": "https://schema.org",
    "@type": "Car",
    name: `${input.brandName} ${input.modelName}`,
    brand: { "@type": "Brand", name: input.brandName },
    manufacturer: { "@type": "Organization", name: input.brandName },
    description: input.description,
    url: input.url,
    ...(input.imageUrl ? { image: [input.imageUrl] } : {}),
    ...(input.currentModelName ? { model: input.currentModelName } : {}),
    ...(input.modelDate ? { vehicleModelDate: input.modelDate } : {}),
    ...(input.fuelTypes && input.fuelTypes.length > 0 ? { fuelType: input.fuelTypes } : {}),
  };
}
