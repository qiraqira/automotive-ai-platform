import { requireAdminSession, adminFetch } from "@/lib/admin-auth";

interface ArticleRow {
  id: string;
  slug: string;
  locale: string;
  headline: string;
  subtitle: string | null;
  status: string;
  authorType: string;
  createdAt: string;
  story: { id: string; title: string } | null;
  images: { altText: string | null; image: { originalUrl: string; attribution: string | null } }[];
}

type StatusFilter = "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "REJECTED";

const STATUSES: StatusFilter[] = ["DRAFT", "IN_REVIEW", "PUBLISHED", "REJECTED"];
const PAGE_SIZE = 50;

// The review queue for apps/worker/src/write-article.ts's real Writer
// stage output — when AUTO_PUBLISH is off (the real default, "AI
// assisted, not autonomous"), a real AI-written Article lands here as
// DRAFT instead of going straight live, and a human with PUBLISH_ARTICLE
// decides publish vs. reject. Same zero-client-JS <form method="post">
// pattern as every other admin correction flow (/admin/alerts's Resolve
// button, etc.).
const ERROR_MESSAGES: Record<string, string> = {
  not_found: "That article no longer exists — refresh and try again.",
  forbidden: "Your account doesn't have permission to publish/reject articles.",
  unknown_error: "Something went wrong.",
  no_file: "No image file was received — choose a file before uploading.",
  file_too_large: "That image is over the 10MB limit.",
  invalid_image: "That file isn't a recognized image (JPEG, PNG, or WebP).",
};

export default async function AdminArticlesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; offset?: string; error?: string }>;
}) {
  const me = await requireAdminSession();
  const { status: statusParam, offset: offsetParam, error } = await searchParams;
  const status: StatusFilter = STATUSES.includes(statusParam as StatusFilter) ? (statusParam as StatusFilter) : "DRAFT";
  const offset = Math.max(0, Number(offsetParam) || 0);

  const res = await adminFetch(`/v1/admin/articles?status=${status}&offset=${offset}`);
  const { articles, hasMore } = (res.ok ? await res.json() : { articles: [], hasMore: false }) as {
    articles: ArticleRow[];
    hasMore: boolean;
  };

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

      {error && (
        <p style={{ color: "#b00020", border: "1px solid #b00020", padding: 8, marginBottom: 16 }}>
          {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.unknown_error}
        </p>
      )}

      <h2 style={{ fontSize: 16 }}>AI-written articles</h2>
      <nav style={{ margin: "8px 0 16px", fontFamily: "Arial, sans-serif", fontSize: 13 }}>
        {STATUSES.map((s, i) => (
          <span key={s}>
            {i > 0 && " · "}
            {s === status ? <strong>{s}</strong> : <a href={`/admin/articles?status=${s}`}>{s}</a>}
          </span>
        ))}
      </nav>

      {articles.length === 0 && <p>No {status.toLowerCase()} articles{status === "DRAFT" ? " — the Writer stage runs automatically every 15 minutes when a key is configured." : "."}</p>}
      <ul className="story-list">
        {articles.map((article) => (
          <li key={article.id} className="story-item">
            <div className="story-meta">
              <span className="badge">{article.status}</span> {article.authorType} · {new Date(article.createdAt).toLocaleString()}
              {article.story ? ` · from: ${article.story.title}` : ""}
            </div>
            <strong>{article.headline}</strong>
            {article.subtitle && <p style={{ margin: "4px 0" }}>{article.subtitle}</p>}
            {article.images[0] && (
              // A real safety net, not decoration — apps/worker/src/
              // fetch-images.ts's Commons matching is real but imperfect
              // (see that file's comments); a reviewer needs to actually
              // SEE the picture before deciding Publish, so it renders
              // here even in this plain admin list, not just on the
              // final public page.
              <figure style={{ margin: "8px 0" }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>, see next.config.mjs */}
                <img src={article.images[0].image.originalUrl} alt="" style={{ maxWidth: 320, height: "auto", display: "block" }} />
                {article.images[0].image.attribution && <figcaption className="story-meta">{article.images[0].image.attribution}</figcaption>}
              </figure>
            )}
            {status === "PUBLISHED" && (
              <p className="story-meta">
                <a href={`/articles/${article.locale}/${article.slug}`} target="_blank" rel="noreferrer">
                  View live →
                </a>
              </p>
            )}
            {(status === "DRAFT" || status === "IN_REVIEW") && (
              <>
                {/* User's explicit instruction: search free stock first
                    (apps/worker/src/fetch-images.ts), upload one manually
                    — e.g. ChatGPT-generated — when nothing free was
                    found, or to replace an imperfect auto-match. Real
                    file upload, not a URL field — encType is required
                    for a real multipart body. */}
                <form method="post" action={`/api/admin/articles/${article.id}/upload-image`} encType="multipart/form-data" style={{ margin: "6px 0" }}>
                  <input type="file" name="image" accept="image/jpeg,image/png,image/webp" required />
                  <button type="submit">{article.images[0] ? "Replace image" : "Upload image"}</button>
                </form>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <form method="post" action={`/api/admin/articles/${article.id}/publish`}>
                    <button type="submit">Publish</button>
                  </form>
                  <form method="post" action={`/api/admin/articles/${article.id}/reject`}>
                    <button type="submit">Reject</button>
                  </form>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>

      <nav aria-label="Articles pagination" style={{ marginTop: 16, fontFamily: "Arial, sans-serif", fontSize: 13 }}>
        {offset > 0 && <a href={`/admin/articles?status=${status}&offset=${Math.max(0, offset - PAGE_SIZE)}`}>← Newer</a>}
        {offset > 0 && hasMore && " · "}
        {hasMore && <a href={`/admin/articles?status=${status}&offset=${offset + PAGE_SIZE}`}>Older →</a>}
      </nav>
    </section>
  );
}
