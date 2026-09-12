// Shared with strip-inline-citations.ts (the DB-wide maintenance script)
// and every writer call site. The prompt-level instruction not to include
// inline citation syntax was already in place and still let 325 of 1168
// real TEXT blocks through (found live 2026-09-12, user's own report) —
// asking the model nicely isn't reliable enough on its own. This is the
// guaranteed backstop: strip the pattern in code from every paragraph
// before it's ever saved, regardless of what the model actually did.
const CITATION_PATTERN = / ?\(\[[^\]]+\]\(https?:\/\/[^)]+\)\)/g;

export function stripInlineCitations(text: string): string {
  return text.replace(CITATION_PATTERN, "").trim();
}
