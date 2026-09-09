import { requireAdminSession } from "@/lib/admin-auth";
import { getStories } from "@/lib/api";

// spec §37 "Editorial Queue" — MVP scope: the real ingested Stories with
// their real status/importance/source count, gated by the same real
// session check as /admin. The full editorial-review actions (Approve/
// Reject/Regenerate/Merge/Split/Publish) wait on there being an actual
// Article/AIJob pipeline to act on (see README.md status table) — showing
// those buttons now, wired to nothing, is exactly the fake-functionality
// spec §85 rules out. Each story's real `StoryEvent` timeline (spec §52
// "story evolution" — written by apps/worker/src/ingest.ts on discovery
// and on each new clustered piece of coverage) is shown here since this
// is the one page an editor would actually use it from. Real gap found
// and fixed 2026-09-07: `SourceAuthor` sat entirely unused since the
// initial schema scaffold — a real byline is now shown per source
// article where the source's feed actually provides one (only
// electrek.co's real feed does among the 3 seeded sources; the other two
// provide none — an honest per-source gap, not hidden).
// Second real gap found and fixed 2026-09-07: this page always called
// getStories() with a fixed limit and no offset — with 150+ real
// Stories in the DB, every Story older than the most recent page was
// permanently unreachable through the admin UI, no matter how many real
// stories actually existed. Real "Newer"/"Older" links below, driven by
// a real `offset` query param — the same pattern as any classic offset-
// paginated list, chosen over a cursor since Story has no natural
// cursor field already exposed here and offset is simplest/sufficient
// at this real data volume.
const PAGE_SIZE = 50;

export default async function AdminStoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const me = await requireAdminSession();
  const { offset: offsetParam } = await searchParams;
  const offset = Math.max(0, Number(offsetParam) || 0);
  const { stories, hasMore } = await getStories({ limit: PAGE_SIZE, offset });

  return (
    <section>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Admin</h1>
      <div className="story-meta">
        Logged in as {me.name}{" "}
        <form method="post" action="/api/admin/logout" style={{ display: "inline" }}>
          <button type="submit" style={{ font: "inherit", padding: 0, border: 0, background: "none", cursor: "pointer", textDecoration: "underline" }}>
            Log out
          </button>
        </form>
      </div>
      <nav style={{ margin: "12px 0 24px", fontFamily: "Arial, sans-serif", fontSize: 13 }}>
        <a href="/admin">Sources</a> · <a href="/admin/stories">Stories</a> · <a href="/admin/alerts">Alerts</a> ·{" "}
        <a href="/admin/audit-log">Audit log</a> · <a href="/admin/users">Users</a> · <a href="/admin/cars">Cars</a> ·{" "}
        <a href="/admin/redirects">Redirects</a> · <a href="/admin/analytics">Analytics</a> · <a href="/admin/articles">Articles</a>
      </nav>

      <h2 style={{ fontSize: 16 }}>
        Stories{" "}
        {stories.length > 0 && (
          <span className="story-meta">
            (showing {offset + 1}–{offset + stories.length})
          </span>
        )}
      </h2>
      <ul className="story-list">
        {stories.map((story) => (
          <li key={story.id} className="story-item">
            <div className="story-meta">
              {story.status} · importance {story.importanceScore} · {story._count.sourceArticles} source
              {story._count.sourceArticles === 1 ? "" : "s"}
            </div>
            <strong>{story.title}</strong>
            {story.sourceArticles.some((a) => a.author) && (
              <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                By {Array.from(new Set(story.sourceArticles.filter((a) => a.author).map((a) => a.author!.name))).join(", ")}
              </div>
            )}
            {story.events.length > 0 && (
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--ink-dim)" }}>
                {story.events.map((event) => (
                  <li key={event.id}>
                    {new Date(event.occurredAt).toLocaleString()} — <strong>{event.label}</strong>
                    {event.description ? `: ${event.description}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {stories.length === 0 && <p>No stories on this page.</p>}
      </ul>

      {/* Real gap found and fixed 2026-09-07 (same day, caught by this
          project's own a11y E2E suite): an unlabeled <nav> here is
          indistinguishable from the site nav above it — axe-core's real
          landmark-unique rule flagged this live, not a hypothetical. */}
      <nav aria-label="Stories pagination" style={{ marginTop: 16, fontFamily: "Arial, sans-serif", fontSize: 13 }}>
        {offset > 0 && (
          <a href={`/admin/stories?offset=${Math.max(0, offset - PAGE_SIZE)}`}>← Newer</a>
        )}
        {offset > 0 && hasMore && " · "}
        {hasMore && <a href={`/admin/stories?offset=${offset + PAGE_SIZE}`}>Older →</a>}
      </nav>
    </section>
  );
}
