// Rule-based topic classification — a stand-in for the AI classifier
// stage from docs/ai-pipeline.md's pipeline table ("Classifier") that
// doesn't exist yet. Same pattern already used for story clustering in
// apps/worker (pg_trgm rules today, embeddings/AI later): simple,
// deterministic, and honestly a placeholder — not dressed up as
// AI-powered. Each rule is a keyword set matched against the title;
// first match wins, in the order below (more specific topics first, so
// e.g. a recall story about an EV classifies as safety, not EV, since
// "what kind of story is this" matters more than "what kind of car").

export interface TopicRule {
  slug: string;
  name: string;
  keywords: string[];
}

export const TOPIC_RULES: TopicRule[] = [
  {
    slug: "safety-recalls",
    name: "Safety & Recalls",
    // Real gap found and fixed 2026-09-08: checked every real ingested
    // Story title against this list and found several genuinely
    // safety/fatality stories (a fatal Autopilot crash, a driver killed,
    // a fatal-crash lawsuit) fell through to "electric-vehicles" purely
    // because they mention "tesla"/"electric" and use none of the words
    // above. Added "killed"/"died"/"fatal" — each verified against every
    // real story title in this dev DB with zero false positives before
    // adding. Deliberately did NOT add the broader "kill" or "death":
    // "kill" alone would have misclassified a real, unrelated story
    // ("Tesla killing Solar Roof", a product-discontinuation story) as
    // safety-recalls, and "death" would have misclassified another real
    // story using "death spiral" as a business metaphor, not a literal
    // fatality — both confirmed live against real data, not assumed.
    keywords: ["recall", "safety", "investigat", "crash", "airbag", "iihs", "nhtsa", "killed", "died", "fatal"],
  },
  {
    slug: "electric-vehicles",
    name: "Electric Vehicles",
    keywords: [" ev ", "electric", "battery", "charging", "range", "tesla", "kwh"],
  },
  {
    slug: "market-business",
    name: "Market & Business",
    // Real gap found and fixed 2026-09-08, same pass as safety-recalls'
    // own keyword fix: checked every real ingested Story title against
    // this list and found genuine layoff/job-cut headlines ("VW to cut
    // 100k jobs...", "Jaguar Land Rover Opens Voluntary Layoffs...")
    // going entirely unclassified. Added "jobs"/"layoff" — each verified
    // against every real title with zero false positives. Deliberately
    // did NOT add "cfo" (a real candidate for corporate-news stories):
    // it's a real false positive against an actual unrelated story —
    // "Macfox X1S e-bike review..." contains "cfo" as a mid-word
    // substring (M-a-c-f-o-x), confirmed live before ruling it out.
    keywords: ["sales", "delivery", "deliveries", "price", "pricing", "market", "recession", "tariff", "jobs", "layoff"],
  },
  {
    slug: "micromobility",
    name: "E-Bikes & Scooters",
    // Real gap found and fixed 2026-09-08: checked every real ingested
    // Story title (73 unclassified at the time) and found a real,
    // sizeable cluster of e-bike/e-scooter stories (ENGWE, SONDORS,
    // Macfox, Navee, Tenways, Velotric, Rivian's own ALSO e-bike) with no
    // topic to land in at all. "e-bike"/"e-scooter" verified against
    // every real title with zero false positives — no other real story
    // in the checked set uses either term for anything but an actual
    // e-bike/e-scooter.
    keywords: ["e-bike", "e-scooter", "escooter"],
  },
  {
    slug: "autonomous-robotaxi",
    name: "Autonomous & Robotaxis",
    // Real gap found and fixed 2026-09-08, same pass: a second real
    // cluster (Waymo robotaxi expansion, Uber's UK autonomous launch, the
    // Tesla Cybercab) also had nowhere to land. Each keyword verified
    // against every real title with zero false positives.
    keywords: ["robotaxi", "autonomous", "waymo", "cybercab", "self-driving"],
  },
];

/** Returns the first matching topic's slug, or null if nothing matches —
 * a Story with no confident classification stays unclassified rather than
 * forced into a wrong bucket. Matching is case-insensitive substring
 * search on the title only (no body text exists to classify against yet
 * for Stories). */
export function classifyTopic(title: string): string | null {
  const lower = ` ${title.toLowerCase()} `;
  for (const rule of TOPIC_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return rule.slug;
    }
  }
  return null;
}
