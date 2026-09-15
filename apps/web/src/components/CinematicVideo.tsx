"use client";

import { useEffect, useId, useRef, useState } from "react";

// Added 2026-09-16, user's own ask, using a reference page they linked
// (mk.qira.ru/3) as the model: a real YouTube video shown as a muted,
// looping, full-width "moment" instead of a plain embed with visible
// controls — loads and starts playing only once actually scrolled into
// view (an IntersectionObserver, not autoplay-from-page-load), with a
// real unmute button rather than making the visitor go find one on
// YouTube itself. This is the second client component in apps/web
// (after HeaderNav.tsx) — same house-style exception: only when the
// interactivity genuinely can't be done as a server component/plain
// link, which play/pause/mute state can't.
//
// Uses the real YouTube IFrame Player API (not just editing the embed
// URL's `mute` param) specifically so unmuting doesn't restart/reload
// the video — `player.unMute()` just changes the live stream's volume.
// `prefers-reduced-motion` skips the autoplay entirely: a static
// thumbnail with a play button instead, and pressing play starts the
// real video WITH sound immediately (a genuine user gesture, so the
// browser's own autoplay-with-sound restriction doesn't apply) rather
// than muted-then-needing-a-second-click.

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string,
        options: {
          videoId: string;
          host?: string;
          playerVars?: Record<string, number | string>;
          events?: {
            onReady?: (event: { target: YTPlayer }) => void;
          };
        },
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayer {
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  playVideo: () => void;
}

let apiLoadPromise: Promise<void> | null = null;

function loadYouTubeIframeApi(): Promise<void> {
  if (apiLoadPromise) return apiLoadPromise;
  apiLoadPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve();
      return;
    }
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      resolve();
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    }
  });
  return apiLoadPromise;
}

export interface CinematicVideoProps {
  youtubeId: string;
  title: string;
  label?: string;
}

export default function CinematicVideo({ youtubeId, title, label }: CinematicVideoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerElementId = useId().replace(/:/g, "");
  const playerRef = useRef<YTPlayer | null>(null);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(true);
  const watchUrl = `https://www.youtube.com/watch?v=${youtubeId}`;

  // Read after mount, not during render — `window` doesn't exist during
  // Next.js's server render, so reading `matchMedia` directly in the
  // render body would make the client's first paint disagree with the
  // server-rendered HTML (a real hydration mismatch), not just a
  // theoretical one.
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  function startPlayer(startMuted: boolean) {
    if (started) return;
    setStarted(true);
    setMuted(startMuted);
    loadYouTubeIframeApi().then(() => {
      if (!window.YT) return;
      playerRef.current = new window.YT.Player(playerElementId, {
        videoId: youtubeId,
        // Same privacy-enhanced domain every other embed on this site
        // already uses (see next.config.mjs's CSP comment) — the
        // official IFrame API supports it via this `host` option rather
        // than needing a hand-built iframe URL.
        host: "https://www.youtube-nocookie.com",
        playerVars: {
          autoplay: 1,
          mute: startMuted ? 1 : 0,
          loop: 1,
          playlist: youtubeId,
          controls: startMuted ? 0 : 1,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: (event) => {
            event.target.playVideo();
          },
        },
      });
    });
  }

  useEffect(() => {
    if (reducedMotion) return; // handled by the click-to-play thumbnail instead
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            startPlayer(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startPlayer closes over stable refs/props only
  }, [reducedMotion]);

  function toggleMute() {
    const player = playerRef.current;
    if (!player) return;
    if (player.isMuted()) {
      player.unMute();
      setMuted(false);
    } else {
      player.mute();
      setMuted(true);
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#000", overflow: "hidden", borderRadius: 8, marginBottom: 8 }}>
      {reducedMotion && !started ? (
        <button
          onClick={() => startPlayer(false)}
          aria-label={`Play video: ${title}`}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            border: 0,
            padding: 0,
            cursor: "pointer",
            backgroundImage: `url(https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg)`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.9)",
              margin: "0 auto",
              fontSize: 22,
              color: "#111",
            }}
          >
            ▶
          </span>
        </button>
      ) : (
        <div id={playerElementId} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      )}
      {started && !reducedMotion && (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: "linear-gradient(to top, rgba(0,0,0,0.65), rgba(0,0,0,0.05) 45%, rgba(0,0,0,0) 65%)",
            }}
          />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "16px 20px", pointerEvents: "none" }}>
            {label && (
              <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#fff", opacity: 0.85, marginBottom: 4, fontWeight: 600 }}>{label}</div>
            )}
            <div style={{ fontSize: 20, fontWeight: 600, color: "#fff", maxWidth: "70%" }}>{title}</div>
          </div>
          <button
            onClick={toggleMute}
            aria-label={muted ? "Unmute video" : "Mute video"}
            style={{
              position: "absolute",
              right: 16,
              bottom: 16,
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.6)",
              background: "rgba(0,0,0,0.4)",
              color: "#fff",
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              fontSize: 11,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#fff",
              textDecoration: "none",
              border: "1px solid rgba(255,255,255,0.5)",
              padding: "6px 12px",
              borderRadius: 100,
              background: "rgba(0,0,0,0.3)",
            }}
          >
            YouTube ↗
          </a>
        </>
      )}
    </div>
  );
}
