import { ImageResponse } from "next/og";

// Real gap found and fixed 2026-09-09, same review pass that renamed the
// site to AutoNewsFeed: favicon.ico/apple-touch-icon.png both 404'd
// (verified live) — Google shows a site's favicon right in search
// results, and an unbranded/missing icon reads as unfinished. Generated
// at request time via next/og rather than a static file since there's no
// real logo asset yet — a simple monogram in the site's own accent color
// (globals.css's --accent) is honest and consistent, not a placeholder
// pretending to be a designed mark.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#c0392b",
          color: "#fff",
          fontSize: 22,
          fontWeight: 700,
          fontFamily: "Arial, sans-serif",
        }}
      >
        A
      </div>
    ),
    { ...size },
  );
}
