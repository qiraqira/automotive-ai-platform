import { computeRankingScore } from "@automotive/editorial";
import type { StorySummary } from "./api";

// Extracted 2026-09-11 from apps/web/src/app/page.tsx so /news (the new
// "see all" destination for the homepage's Latest news section) can
// rank stories the exact same way instead of duplicating the logic.
function averageSourceTrust(story: StorySummary): number {
  if (story.sources.length === 0) return 50;
  const total = story.sources.reduce((sum, s) => sum + s.source.trustScore, 0);
  return total / story.sources.length;
}

export function rankStories(stories: StorySummary[]): StorySummary[] {
  const now = new Date();
  return [...stories].sort((a, b) => {
    const scoreA = computeRankingScore({
      importanceScore: a.importanceScore,
      sourceQualityScore: averageSourceTrust(a),
      publishedAt: new Date(a.lastUpdatedAt),
      now,
    });
    const scoreB = computeRankingScore({
      importanceScore: b.importanceScore,
      sourceQualityScore: averageSourceTrust(b),
      publishedAt: new Date(b.lastUpdatedAt),
      now,
    });
    return scoreB - scoreA;
  });
}
