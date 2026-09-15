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
