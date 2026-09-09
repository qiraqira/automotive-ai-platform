// Editorial ranking (spec §95): what decides homepage placement/breaking/
// related-stories/trending. Every input is 0-100 except `publishedAt`;
// `engagementScore`/`editorialValueScore` are optional because the
// analytics pipeline and quality-gate scoring don't run yet (see
// README.md's status table) — a piece of real, freshly-published content
// must not get penalized to zero just because those signals don't exist
// yet, so missing ones default to a neutral midpoint rather than 0.

export interface RankingInput {
  importanceScore: number;
  sourceQualityScore: number;
  publishedAt: Date;
  now?: Date;
  engagementScore?: number;
  editorialValueScore?: number;
}

const NEUTRAL_DEFAULT = 50;

// Freshness matters a lot in the first few hours (breaking news) and much
// less after that (spec §53's breaking/important/normal/low tiers are all
// about the same first hours) — an exponential half-life models that
// better than a linear decay, which would make a 24h-old story look
// almost as fresh as a 1h-old one.
const FRESHNESS_HALF_LIFE_HOURS = 12;

const WEIGHTS = {
  importance: 0.35,
  freshness: 0.25,
  sourceQuality: 0.15,
  engagement: 0.15,
  editorialValue: 0.1,
};

function freshnessScore(publishedAt: Date, now: Date): number {
  const ageHours = Math.max(0, (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60));
  return 100 * Math.pow(0.5, ageHours / FRESHNESS_HALF_LIFE_HOURS);
}

/** Returns a 0-100 ranking score — higher means more prominent placement
 * (homepage hero, breaking bar, trending). Pure function: no DB/clock
 * dependency beyond the explicit `now` override used in tests. */
export function computeRankingScore(input: RankingInput): number {
  const now = input.now ?? new Date();
  const freshness = freshnessScore(input.publishedAt, now);
  const engagement = input.engagementScore ?? NEUTRAL_DEFAULT;
  const editorialValue = input.editorialValueScore ?? NEUTRAL_DEFAULT;

  return (
    input.importanceScore * WEIGHTS.importance +
    freshness * WEIGHTS.freshness +
    input.sourceQualityScore * WEIGHTS.sourceQuality +
    engagement * WEIGHTS.engagement +
    editorialValue * WEIGHTS.editorialValue
  );
}
