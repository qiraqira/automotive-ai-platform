// Real gap found and fixed 2026-09-07: `Brand.country` (ISO 3166-1
// alpha-2, e.g. "DE" for BMW) has had real seed data since the schema's
// original scaffold but no caller anywhere ever formatted it for a
// reader — a raw code is not the kind of "render one real value, not a
// hardcoded/raw form" the rest of this package's locale-aware
// formatters (units.ts) already stand for. Uses the platform's own
// `Intl.DisplayNames` rather than a hand-maintained code→name table, so
// it stays correct for every real ISO code without this project owning
// a list it would have to keep in sync itself.

/** Converts an ISO 3166-1 alpha-2 country code to its display name in
 * the given locale (English by default — no locale-selection UI exists
 * yet, same honest scope as units.ts's `unitSystem`). Returns the raw
 * code unchanged if the runtime can't resolve it (an unknown/malformed
 * code), rather than throwing or silently showing nothing for real
 * data.
 *
 * Real gap found and fixed 2026-09-07: `Intl.DisplayNames.of()` is
 * case-sensitive and does NOT throw for a lowercase code — verified
 * live (`node -e`), not assumed: `.of("DE")` → "Germany", but
 * `.of("de")` silently returns the literal string `"de"` back
 * unresolved (only a genuinely malformed code like `.of("d")` throws,
 * which the catch below already handled). Real, live risk: neither
 * `POST /v1/brands` nor `PATCH /v1/brands/:id` (apps/api/src/app.ts)
 * validates `country`'s casing at all, so an admin typing "de" instead
 * of "DE" into the real "Add brand"/correction form would show the raw
 * lowercase code on the real public car page instead of "Germany" —
 * exactly the kind of data-entry-casing mistake silently reaching a
 * real page that the Generation startYear/endYear fix (same day)
 * closed for a different field. */
export function formatCountryName(countryCode: string, locale = "en"): string {
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: "region" });
    return displayNames.of(countryCode.toUpperCase()) ?? countryCode;
  } catch {
    return countryCode;
  }
}
