// Real gap found live 2026-09-16 (user's own direct complaint after the
// 2026-09-15 no-crop fix): every thumbnail grid on the site forced the
// image into a fixed 4:3 box with `object-fit: contain` so nothing got
// cropped, but real car/article photos run roughly 1.4–2.2 wide (rarely
// anywhere near 4:3 = 1.33) — every tile letterboxed, and by a different
// amount tile to tile, which reads as sloppy rather than "safely
// uncropped". The actual fix is giving each tile its own aspect ratio
// (its real photo's own shape) instead of guessing one constant for
// every photo on the site. Clamped to a sane band so a rare portrait or
// ultra-panoramic outlier still gets a little letterbox rather than
// blowing up the grid's row heights.
const MIN_RATIO = 1.3;
const MAX_RATIO = 2.2;
const FALLBACK_RATIO = 1.6;

export function clampedAspectRatio(width: number | null | undefined, height: number | null | undefined): number {
  if (!width || !height || width <= 0 || height <= 0) return FALLBACK_RATIO;
  const ratio = width / height;
  if (!Number.isFinite(ratio)) return FALLBACK_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

// Real gap found live 2026-09-16 (user's own direct complaint, a
// COMPARISON article's two-up hero pair, one car photo per side): each
// image getting its OWN aspect ratio is right for an independent grid
// tile, but wrong for a deliberate side-by-side PAIR — two real photos
// almost never share the same shape (a hatchback vs. a sedan, a
// portrait vs. a landscape crop), so two independently-clamped ratios
// in two equal-width columns render at two different heights, which
// reads as a layout bug even though neither image is individually
// letterboxed. A pair needs ONE shared ratio so both sides match —
// averaging the two (raw, unclamped) ratios first keeps that shared
// ratio honest to both real photos rather than just picking one side's
// shape and forcing the other to match it.
export function pairedAspectRatio(
  a: { width: number | null | undefined; height: number | null | undefined },
  b: { width: number | null | undefined; height: number | null | undefined },
): number {
  const rawRatio = (w: number | null | undefined, h: number | null | undefined) => (w && h && w > 0 && h > 0 ? w / h : null);
  const ra = rawRatio(a.width, a.height);
  const rb = rawRatio(b.width, b.height);
  if (ra == null && rb == null) return FALLBACK_RATIO;
  const avg = ra != null && rb != null ? (ra + rb) / 2 : (ra ?? rb)!;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, avg));
}
