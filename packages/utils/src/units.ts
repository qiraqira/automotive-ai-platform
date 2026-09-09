// Localization engine, unit half (spec §93-94): "не переводить числа как
// обычный текст — использовать structured data... renderer уже решает".
// Canonical values (km, kW) are stored once (e.g. on a Fact or
// CarSpecification); these functions convert and format for the viewer's
// unit system at render time — the stored value never changes, only the
// display does.

export type UnitSystem = "metric" | "imperial";

// International mile, exact by treaty (not a rounded approximation) —
// using anything looser would drift the spec's own worked example
// (500 km → 311 miles) off by enough to fail a test.
const KM_PER_MILE = 1.609344;

// Mechanical horsepower: 1 hp = 745.7 W = 0.7457 kW. Matches the factor
// already used when the BMW 3 Series seed data (packages/database/src/
// seed.ts) derived powerKw from real-world powerHp figures — keeping one
// factor used consistently everywhere a hp/kW conversion happens.
const KW_PER_HP = 0.7457;

export function kmToMiles(km: number): number {
  return km / KM_PER_MILE;
}

export function milesToKm(miles: number): number {
  return miles * KM_PER_MILE;
}

export function kwToHp(kw: number): number {
  return kw / KW_PER_HP;
}

export function hpToKw(hp: number): number {
  return hp * KW_PER_HP;
}

/** Canonical value is kilometers; renders as "km" for metric markets and
 * whole-number "miles" for imperial ones — spec §94's own worked example
 * (500 km → US "311 miles", Spanish "500 km"). */
export function formatDistanceKm(km: number, unitSystem: UnitSystem): string {
  if (unitSystem === "imperial") {
    return `${Math.round(kmToMiles(km))} miles`;
  }
  return `${Math.round(km)} km`;
}

/** Canonical value is kilowatts; renders as "kW" for metric and whole-
 * number "hp" for imperial. Simplification worth flagging: real-world
 * convention is less clean than distance (many metric-using markets
 * still quote hp for cars) — this is a reasonable default, not a claim
 * that every metric market prefers kW for power specifically. */
export function formatPowerKw(kw: number, unitSystem: UnitSystem): string {
  if (unitSystem === "imperial") {
    return `${Math.round(kwToHp(kw))} hp`;
  }
  return `${Math.round(kw)} kW`;
}
