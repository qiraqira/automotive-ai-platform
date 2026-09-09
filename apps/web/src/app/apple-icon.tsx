import { ImageResponse } from "next/og";

// Same real gap/fix as icon.tsx (see that file's comment) — Apple's own
// touch-icon convention, 180x180 per Apple's HIG, separate special
// filename Next.js recognizes automatically alongside icon.tsx.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 120,
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
