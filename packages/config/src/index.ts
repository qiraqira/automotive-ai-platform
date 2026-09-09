import { z } from "zod";

// The ONLY place in the codebase that should read `process.env` directly
// for these values (docs/security.md) — everything else imports `env` from
// here, so a credential can never accidentally leak into a client bundle
// through a stray `process.env.X` in application code.

// Real, severe gap found and fixed 2026-09-08: `z.coerce.boolean()` (used
// below, previously, for every AUTO_*/AI_KILL_SWITCH flag) coerces via
// JS's own `Boolean()` constructor — which treats ANY non-empty string as
// `true`, including the literal string `"false"`. Verified live
// (`node -e`) before touching anything: `z.coerce.boolean().parse("false")`
// returns `true`; only a genuinely EMPTY string coerces to `false`. Every
// one of these flags is documented in `.env.example` as "all default OFF
// until proven safe" (see docs/editorial-system.md #75) and shown there
// with the exact literal value `AUTO_PUBLISH=false` — meaning a real
// deployment that copies `.env.example` as its starting `.env` (the
// normal, expected workflow) would have every one of these safety-off
// flags silently flip to ON, including `AUTO_PUBLISH` and `AI_KILL_SWITCH`
// itself, the one flag whose entire purpose is an emergency off-switch.
// `AUTH_JWT_SECRET`'s own production guard (below) throws loudly for an
// analogous "insecure by an easy real mistake" case; this one is worse
// because it doesn't even require a mistake — writing `false` is the
// correct, intuitive thing to type, and it was silently wrong before this
// fix, in every environment (dev, test, and production alike), for any
// caller that ever explicitly wrote the string "false" rather than
// leaving the var unset and relying on `z.coerce.boolean()`'s own default.
// Fixed with a real true/false string parser (only the literal "true" or
// "1" is true; anything else, including "false"/"0"/an empty string, is
// false) — matches the intuitive contract "false" already implied.
// No dedicated test suite exists for this package (no vitest wired up —
// same judgment call already made for the AUTH_JWT_SECRET guard below:
// standing one up for a single small guard was judged disproportionate
// scope there); verified live instead via real subprocess runs (see this
// fix's own memory entry for the exact commands and their real output).
const booleanEnvVar = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? defaultValue : v === "true" || v === "1"));

// Real gap found and fixed 2026-09-08, same investigation as the boolean
// fix above: `z.coerce.number().default(x)` only applies its default when
// the env var is completely UNSET (`undefined`) — an explicitly empty
// value (a real, plausible shape: a blank line like `API_PORT=` left over
// from an edited .env, or a templated deployment config that renders an
// unset variable as an empty string rather than omitting the line
// entirely) coerces via `Number("")`, which is `0`, not the intended
// default. Verified live (`node -e`) both the parse behavior and its real
// consequence for `API_PORT`/`WEB_PORT` specifically: Node's own
// `http.Server.listen(0)` doesn't error, it silently binds a random
// OS-assigned port — a genuinely confusing real deployment failure mode
// (a reverse proxy or Docker port mapping expecting the documented
// 4000/3000 would simply never reach the service, with no error anywhere
// pointing at why). For the two budget fields, an empty value would
// instead silently set that spend limit to $0 — not a security hole like
// the boolean gap above (it fails closed, blocking all AI spend, not
// open), but still a real, confusing "the default I thought I was
// getting isn't the one I got" trap, so fixed the same way for
// consistency rather than leaving an inconsistent partial fix. A genuine
// typo (e.g. "abc") still correctly throws — confirmed unaffected, this
// only changes the empty-string case.
const numberEnvVar = (defaultValue: number) => z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().default(defaultValue));

const schema = z.object({
  PROJECT_NAME: z.string().default("PROJECT_NAME"),
  PUBLIC_DOMAIN: z.string().default("DOMAIN.COM"),
  PUBLIC_URL: z.string().default("https://DOMAIN.COM"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  AUTH_JWT_SECRET: z.string().default("dev-only-insecure-secret-change-me"),
  AUTH_COOKIE_NAME: z.string().default("automotive_session"),

  AI_DEFAULT_TEXT_PROVIDER: z.string().default("anthropic"),
  AI_DEFAULT_EMBEDDING_PROVIDER: z.string().default("openai"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  AI_DAILY_BUDGET_USD: numberEnvVar(20),
  AI_MONTHLY_BUDGET_USD: numberEnvVar(400),
  AI_PER_TASK_MAX_USD: numberEnvVar(2),

  AUTO_CLUSTER: booleanEnvVar(false),
  AUTO_RESEARCH: booleanEnvVar(false),
  AUTO_DRAFT: booleanEnvVar(false),
  AUTO_PUBLISH: booleanEnvVar(false),
  AUTO_MODERATION: booleanEnvVar(false),
  AUTO_SEO: booleanEnvVar(false),
  AI_KILL_SWITCH: booleanEnvVar(false),

  // Real gap closed 2026-09-09: packages/editorial/src/quality-gate.ts's
  // evaluateQualityGate() has existed since 2026-09-08 (unit-tested,
  // configurable thresholds per spec §36's own "must be configurable"
  // requirement) but had zero real caller — nothing computed the 6 scores
  // it needs, so AUTO_MODERATION stayed permanently off. Wired in
  // apps/worker/src/fact-check.ts (a real second AI pass judging the
  // drafted article against its own sources) — these two thresholds are
  // that gate's actual configuration, not hardcoded in the fact-check
  // module itself, matching the "no thresholds buried in code" rule
  // quality-gate.ts's own top comment states. Defaults are a starting
  // point, not derived from any real calibration data yet (no article has
  // ever been scored) — tune them once enough real scored articles exist
  // to see the real score distribution.
  QUALITY_GATE_PUBLISH_AT: numberEnvVar(70),
  QUALITY_GATE_REVIEW_AT: numberEnvVar(50),

  API_PORT: numberEnvVar(4000),
  WEB_PORT: numberEnvVar(3000),
});

// NOTE: apps/web deliberately does NOT import this module. This schema
// requires DATABASE_URL (api/worker always have it); forcing apps/web to
// satisfy the same schema just to read one non-secret URL would couple a
// frontend that shouldn't even have DB credentials in scope to a backend
// env contract. apps/web reads its one var (API_INTERNAL_URL, not a
// secret) directly — see apps/web/src/lib/api.ts.

export const env = schema.parse(process.env);

// Real gap found and fixed 2026-09-07, same day as the RBAC-suspension
// and rate-limiting fixes: `AUTH_JWT_SECRET` had a hardcoded, publicly-
// visible-in-source default (`"dev-only-insecure-secret-change-me"`)
// and no length validation at all — if this service were ever started
// in production without that env var explicitly set, it would boot
// successfully and silently sign every real session with a secret
// anyone reading this codebase already knows, letting anyone forge a
// valid token for any user (including an admin) and completely bypass
// every auth/RBAC fix made today. Same "fail loud in production, never
// silently insecure" posture already used for the session cookie's
// `secure` flag (`apps/api/src/app.ts`) — this throws at startup
// instead of ever serving a single request with a known-weak secret.
// Doesn't fire in development/test: nothing here ever sets
// `NODE_ENV=production` (confirmed by checking every package.json
// script and vitest config), so local dev and the full test/E2E suite
// are unaffected.
const INSECURE_DEFAULT_JWT_SECRET = "dev-only-insecure-secret-change-me";
const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32;

if (
  env.NODE_ENV === "production" &&
  (env.AUTH_JWT_SECRET === INSECURE_DEFAULT_JWT_SECRET ||
    env.AUTH_JWT_SECRET.length < MIN_PRODUCTION_JWT_SECRET_LENGTH)
) {
  throw new Error(
    `AUTH_JWT_SECRET must be set to a real, unique secret (at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters) in production — refusing to start with the insecure development default.`,
  );
}

export const budgetLimits = {
  dailyUsd: env.AI_DAILY_BUDGET_USD,
  monthlyUsd: env.AI_MONTHLY_BUDGET_USD,
  perTaskUsd: env.AI_PER_TASK_MAX_USD,
};

export const qualityGateThresholds = {
  publishAt: env.QUALITY_GATE_PUBLISH_AT,
  reviewAt: env.QUALITY_GATE_REVIEW_AT,
};

export const featureFlags = {
  autoCluster: env.AUTO_CLUSTER,
  autoResearch: env.AUTO_RESEARCH,
  autoDraft: env.AUTO_DRAFT,
  autoPublish: env.AUTO_PUBLISH,
  autoModeration: env.AUTO_MODERATION,
  autoSeo: env.AUTO_SEO,
  aiKillSwitch: env.AI_KILL_SWITCH,
};
