"use client";

import { useEffect, useRef, useState } from "react";

// Real gap found and fixed 2026-09-11, user's explicit request ("хочу
// какое-нибудь выпадающее меню наверху по трем полосочкам чтобы удобнее
// было" — a hamburger dropdown menu up top for easier navigation): the
// header had exactly one link (Search) and zero site-wide navigation —
// every real section (News, Brands, Guides, the 5 real Topics, About)
// was only reachable via the footer or a deep link. This is the first
// client component in apps/web (everything else is a plain server
// component / GET form, per next.config.mjs's own "no client JS needed"
// posture) — a real, unavoidable exception since a toggleable dropdown
// needs client-side open/close state; every link inside it is still a
// plain `<a>`, not a client-side route transition.
const SECTIONS: { href: string; label: string }[] = [
  { href: "/news", label: "News" },
  { href: "/brands", label: "Brands" },
  { href: "/guides", label: "Guides" },
];

const TOPICS: { href: string; label: string }[] = [
  { href: "/topics/electric-vehicles", label: "Electric Vehicles" },
  { href: "/topics/autonomous-robotaxi", label: "Autonomous & Robotaxis" },
  { href: "/topics/micromobility", label: "E-Bikes & Scooters" },
  { href: "/topics/market-business", label: "Market & Business" },
  { href: "/topics/safety-recalls", label: "Safety & Recalls" },
];

export default function HeaderNav() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={menuRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: 16 }}>
      <a href="/search" style={{ fontFamily: "Arial, sans-serif", fontSize: 13 }}>
        Search
      </a>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu"
        aria-expanded={open}
        style={{ background: "none", border: "1px solid var(--line)", borderRadius: 4, padding: "6px 8px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 3 }}
      >
        <span style={{ width: 18, height: 2, background: "var(--ink)", display: "block" }} />
        <span style={{ width: 18, height: 2, background: "var(--ink)", display: "block" }} />
        <span style={{ width: 18, height: 2, background: "var(--ink)", display: "block" }} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            boxShadow: "0 10px 24px rgba(0,0,0,0.08)",
            padding: 12,
            minWidth: 220,
            zIndex: 30,
            fontFamily: "Arial, sans-serif",
            fontSize: 14,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 10 }}>
            {SECTIONS.map((s) => (
              <a key={s.href} href={s.href} onClick={() => setOpen(false)} style={{ padding: "6px 8px", borderRadius: 4, fontWeight: 700, textDecoration: "none" }}>
                {s.label}
              </a>
            ))}
          </div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-dim)", padding: "0 8px", marginBottom: 4 }}>
            Topics
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 10 }}>
            {TOPICS.map((t) => (
              <a key={t.href} href={t.href} onClick={() => setOpen(false)} style={{ padding: "6px 8px", borderRadius: 4, color: "var(--ink-dim)", textDecoration: "none" }}>
                {t.label}
              </a>
            ))}
          </div>
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <a href="/about" onClick={() => setOpen(false)} style={{ padding: "6px 8px", borderRadius: 4, textDecoration: "none", display: "block" }}>
              About
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
