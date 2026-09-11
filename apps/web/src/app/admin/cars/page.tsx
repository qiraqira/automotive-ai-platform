import { requireAdminSession } from "@/lib/admin-auth";
import { getCarModelSlugs, getCarModel, getMarkets, getBrands } from "@/lib/api";

// Real gap found and fixed 2026-09-07: `PermissionKey.UPDATE_CAR`
// already existed and admin already had it granted, but no endpoint ever
// checked it — every real `Fact` row (spec §90-91's time/market-aware
// system) could only ever come from `seed.ts` or the crawler; there was
// no way for a human editor to correct a wrong spec/price or add a new
// one without a manual DB write. Reads reuse the same public
// `getCarModelSlugs()`/`getCarModel()` helpers the public `/cars/*` pages
// already use (this data was never permission-gated for reading) —
// only the two new mutations go through `adminFetch`.
// Second real gap found and fixed 2026-09-07: adding a Fact only ever
// worked on an *existing* CarModel — nothing let an editor add a new
// Brand or CarModel at all, even though this platform's actual Knowledge
// Graph is built around exactly those two entities. Two new forms below.
// Third real gap found and fixed 2026-09-07: this page never displayed
// or let an editor add to a CarModel's real Generation -> Trim ->
// Engine/Battery hierarchy at all — the exact structured data the public
// car page actually shows most prominently (above the flat Facts list).
// Fourth real gap found and fixed 2026-09-07 (same day, next pass): the
// remaining leaves of that hierarchy — Engine/Battery — flagged above as
// a deliberate follow-up, now closed the same way.
const ERROR_MESSAGES: Record<string, string> = {
  invalid_body: "Check the required fields.",
  slug_taken: "That slug is already taken.",
  brand_not_found: "That brand doesn't exist — add it first.",
  invalid_youtube_url: "Couldn't find a video ID in that URL — paste a real youtube.com/watch, youtu.be, /embed/, or /shorts/ link.",
  // Real gap found and fixed 2026-09-07: every correction route handler
  // sharing this page (battery/brand/engine/generation/trim/car-model/
  // fact) used to discard its real API response and always redirect
  // here as if it succeeded — `not_found` covers the real, if rare, race
  // where the row being corrected no longer exists by the time the form
  // submits.
  not_found: "That no longer exists — refresh the page and try again.",
  unknown_error: "Something went wrong.",
};

export default async function AdminCarsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await requireAdminSession();
  const { error } = await searchParams;
  const { carModels: slugs } = await getCarModelSlugs();
  // Real gap found and fixed 2026-09-08, same shape as apps/web's
  // homepage fix (see that file's own comment): Promise.all meant a
  // single car model's fetch failing (getCarModel() throws for any
  // non-404 failure — a real, plausible transient issue) crashed this
  // ENTIRE admin page, including every other car model that had already
  // loaded fine. The render below already tolerates a `null` result per
  // car (`if (!result) return null`) — extending that same tolerance to
  // a car whose fetch failed, not just one that's genuinely absent.
  const carModelResults = await Promise.allSettled(slugs.map((s) => getCarModel(s.brandSlug, s.modelSlug)));
  const carModels = carModelResults.flatMap((result) => {
    if (result.status === "rejected") {
      console.error(JSON.stringify({ timestamp: new Date().toISOString(), error: "admin_cars_car_model_failed", reason: String(result.reason) }));
      return [];
    }
    // Genuinely absent (a real 404) stays filtered out too, same as
    // before — this list's own "Cars (N)" count above should reflect
    // what actually rendered, not the raw slug count.
    return result.value ? [result.value] : [];
  });
  const { markets } = await getMarkets();
  const { brands } = await getBrands();

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

      <h2 style={{ fontSize: 16 }}>
        Cars <span className="story-meta">({carModels.length})</span>
      </h2>

      {carModels.map((result) => {
        const { carModel } = result;
        // Real gap found and fixed 2026-09-07 (same day, later pass):
        // the "audit my own recent additions" pass that scoped the Add-
        // fact/Add-generation labels by full car-model identity (two
        // passes ago) never got propagated all the way down the real
        // tree — every label below (generation/trim/engine, both the
        // "Add" and "Correct" forms) was only ever scoped by its own
        // immediate name, not the full path. That's a real, not
        // theoretical, collision risk: trim names like "Sport"/"Base"
        // and generation codes are routinely reused across different
        // real car models. Every label below is now built from this one
        // fully-qualified prefix instead.
        const carLabel = `${carModel.brand.name} ${carModel.name}`;
        return (
          <div key={carModel.id} style={{ marginBottom: 32, paddingBottom: 16, borderBottom: "1px solid #ddd" }}>
            <h3 style={{ fontSize: 18 }}>{carLabel}</h3>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
              <form method="post" action={`/api/admin/brands/${carModel.brand.id}`} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <label>
                  Brand name{" "}
                  <input
                    type="text"
                    name="name"
                    defaultValue={carModel.brand.name}
                    aria-label={`Correct brand name for ${carModel.brand.name} via ${carLabel}`}
                    style={{ width: 120 }}
                  />
                </label>
                <input
                  type="text"
                  name="country"
                  defaultValue={carModel.brand.country ?? ""}
                  placeholder="country"
                  aria-label={`Correct brand country for ${carModel.brand.name} via ${carLabel}`}
                  style={{ width: 70 }}
                />
                <button type="submit">Update brand</button>
              </form>

              <form
                method="post"
                action={`/api/admin/cars/${carModel.brand.slug}/${carModel.slug}`}
                style={{ display: "flex", gap: 4, alignItems: "center" }}
              >
                <label>
                  Model name{" "}
                  <input
                    type="text"
                    name="name"
                    defaultValue={carModel.name}
                    aria-label={`Correct model name for ${carLabel}`}
                    style={{ width: 120 }}
                  />
                </label>
                <button type="submit">Update model</button>
              </form>
            </div>

            <ul className="story-list">
              {carModel.facts.map((fact) => (
                <li key={fact.id} className="story-item">
                  <div className="story-meta">
                    <span className="badge">{fact.status}</span>
                    {fact.attribute}
                    {fact.market ? ` (${fact.market.code})` : ""}
                  </div>
                  <form method="post" action={`/api/admin/facts/${fact.id}`} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="text"
                      name="value"
                      defaultValue={fact.value}
                      aria-label={`Value for ${fact.attribute}`}
                      style={{ width: 140 }}
                    />
                    <input
                      type="text"
                      name="unit"
                      defaultValue={fact.unit ?? ""}
                      placeholder="unit"
                      aria-label={`Unit for ${fact.attribute}`}
                      style={{ width: 80 }}
                    />
                    <button type="submit">Update</button>
                  </form>
                </li>
              ))}
            </ul>

            <form
              method="post"
              action={`/api/admin/cars/${carModel.brand.slug}/${carModel.slug}/facts`}
              style={{ display: "flex", gap: 8, marginTop: 8 }}
            >
              <input
                type="text"
                name="attribute"
                placeholder="attribute (e.g. price)"
                aria-label={`New fact attribute for ${carLabel}`}
                required
                style={{ width: 180 }}
              />
              <input
                type="text"
                name="value"
                placeholder="value"
                aria-label={`New fact value for ${carLabel}`}
                required
                style={{ width: 120 }}
              />
              <input
                type="text"
                name="unit"
                placeholder="unit"
                aria-label={`New fact unit for ${carLabel}`}
                style={{ width: 80 }}
              />
              <select
                name="marketId"
                aria-label={`Market for new fact for ${carLabel}`}
                defaultValue=""
                style={{ width: 140 }}
              >
                <option value="">No market (global)</option>
                {markets.map((market) => (
                  <option key={market.id} value={market.id}>
                    {market.name} ({market.code})
                  </option>
                ))}
              </select>
              <button type="submit">Add fact</button>
            </form>

            <h4 style={{ fontSize: 14, marginTop: 16 }}>Generations</h4>
            {carModel.generations.length === 0 ? (
              <p className="story-meta">No generations recorded yet.</p>
            ) : (
              <ul className="story-list">
                {carModel.generations.map((gen) => {
                  const genLabel = `${carLabel} ${gen.name}`;
                  return (
                  <li key={gen.id} className="story-item">
                    <form
                      method="post"
                      action={`/api/admin/generations/${gen.id}`}
                      style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}
                    >
                      <input type="text" name="name" defaultValue={gen.name} aria-label={`Correct generation name for ${genLabel}`} style={{ width: 100 }} />
                      <input
                        type="number"
                        name="startYear"
                        defaultValue={gen.startYear ?? ""}
                        placeholder="start year"
                        aria-label={`Correct start year for ${genLabel}`}
                        style={{ width: 90 }}
                      />
                      <input
                        type="number"
                        name="endYear"
                        defaultValue={gen.endYear ?? ""}
                        placeholder="end year"
                        aria-label={`Correct end year for ${genLabel}`}
                        style={{ width: 90 }}
                      />
                      <button type="submit">Update generation</button>
                    </form>
                    {gen.trims.length === 0 ? (
                      <p className="story-meta">No trims recorded yet.</p>
                    ) : (
                      <ul>
                        {gen.trims.map((trim) => {
                          const trimLabel = `${genLabel} ${trim.name}`;
                          return (
                          <li key={trim.id} style={{ marginBottom: 8 }}>
                            <form
                              method="post"
                              action={`/api/admin/trims/${trim.id}`}
                              style={{ display: "flex", gap: 4, alignItems: "center" }}
                            >
                              <input
                                type="text"
                                name="name"
                                defaultValue={trim.name}
                                aria-label={`Correct trim name for ${trimLabel}`}
                                style={{ width: 110, fontWeight: "bold" }}
                              />
                              <button type="submit">Update trim</button>
                            </form>
                            {trim.engines.map((e) => (
                              <form
                                key={e.id}
                                method="post"
                                action={`/api/admin/engines/${e.id}`}
                                style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 2 }}
                              >
                                <input
                                  type="text"
                                  name="name"
                                  defaultValue={e.name}
                                  aria-label={`Correct engine name for ${trimLabel} ${e.name}`}
                                  style={{ width: 100 }}
                                />
                                <input
                                  type="number"
                                  name="powerHp"
                                  defaultValue={e.powerHp ?? ""}
                                  placeholder="hp"
                                  aria-label={`Correct power for ${trimLabel} ${e.name}`}
                                  style={{ width: 60 }}
                                />
                                <input
                                  type="text"
                                  name="fuel"
                                  defaultValue={e.fuel ?? ""}
                                  placeholder="fuel"
                                  aria-label={`Correct fuel for ${trimLabel} ${e.name}`}
                                  style={{ width: 70 }}
                                />
                                <button type="submit">Update engine</button>
                              </form>
                            ))}
                            {trim.batteries.map((b) => (
                              <form
                                key={b.id}
                                method="post"
                                action={`/api/admin/batteries/${b.id}`}
                                style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 2 }}
                              >
                                <input
                                  type="number"
                                  name="capacityKwh"
                                  defaultValue={b.capacityKwh ?? ""}
                                  placeholder="kWh"
                                  aria-label={`Correct battery capacity for battery ${b.id}`}
                                  style={{ width: 60 }}
                                />
                                <input
                                  type="number"
                                  name="rangeKm"
                                  defaultValue={b.rangeKm ?? ""}
                                  placeholder="range km"
                                  aria-label={`Correct battery range for battery ${b.id}`}
                                  style={{ width: 80 }}
                                />
                                <button type="submit">Update battery</button>
                              </form>
                            ))}
                            <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                              <form method="post" action={`/api/admin/trims/${trim.id}/engines`} style={{ display: "flex", gap: 4 }}>
                                <input
                                  type="text"
                                  name="name"
                                  placeholder="engine name"
                                  aria-label={`New engine name for ${trimLabel}`}
                                  required
                                  style={{ width: 110 }}
                                />
                                <input type="number" name="powerHp" placeholder="hp" aria-label={`New engine hp for ${trimLabel}`} style={{ width: 60 }} />
                                <input type="text" name="fuel" placeholder="fuel" aria-label={`New engine fuel for ${trimLabel}`} style={{ width: 70 }} />
                                <button type="submit">Add engine</button>
                              </form>
                              <form method="post" action={`/api/admin/trims/${trim.id}/batteries`} style={{ display: "flex", gap: 4 }}>
                                <input
                                  type="number"
                                  name="capacityKwh"
                                  placeholder="kWh"
                                  aria-label={`New battery capacity for ${trimLabel}`}
                                  style={{ width: 60 }}
                                />
                                <input
                                  type="number"
                                  name="rangeKm"
                                  placeholder="range km"
                                  aria-label={`New battery range for ${trimLabel}`}
                                  style={{ width: 80 }}
                                />
                                <button type="submit">Add battery</button>
                              </form>
                            </div>
                          </li>
                          );
                        })}
                      </ul>
                    )}
                    <form
                      method="post"
                      action={`/api/admin/generations/${gen.id}/trims`}
                      style={{ display: "flex", gap: 8, marginTop: 4 }}
                    >
                      <input
                        type="text"
                        name="slug"
                        placeholder="trim slug (e.g. m340i)"
                        aria-label={`New trim slug for ${genLabel}`}
                        required
                        style={{ width: 140 }}
                      />
                      <input
                        type="text"
                        name="name"
                        placeholder="trim name (e.g. M340i)"
                        aria-label={`New trim name for ${genLabel}`}
                        required
                        style={{ width: 140 }}
                      />
                      <button type="submit">Add trim</button>
                    </form>
                  </li>
                  );
                })}
              </ul>
            )}
            <form
              method="post"
              action={`/api/admin/cars/${carModel.brand.slug}/${carModel.slug}/generations`}
              style={{ display: "flex", gap: 8, marginTop: 8 }}
            >
              <input
                type="text"
                name="slug"
                placeholder="generation slug (e.g. g20)"
                aria-label={`New generation slug for ${carLabel}`}
                required
                style={{ width: 140 }}
              />
              <input
                type="text"
                name="name"
                placeholder="generation name (e.g. G20)"
                aria-label={`New generation name for ${carLabel}`}
                required
                style={{ width: 140 }}
              />
              <input
                type="number"
                name="startYear"
                placeholder="start year"
                aria-label={`New generation start year for ${carLabel}`}
                style={{ width: 100 }}
              />
              <input
                type="number"
                name="endYear"
                placeholder="end year"
                aria-label={`New generation end year for ${carLabel}`}
                style={{ width: 100 }}
              />
              <button type="submit">Add generation</button>
            </form>

            <h4 style={{ fontSize: 14, marginTop: 16 }}>Videos</h4>
            {carModel.videos.length === 0 ? (
              <p className="story-meta">No videos added yet.</p>
            ) : (
              <ul className="story-list">
                {carModel.videos.map((video) => (
                  <li key={video.id} className="story-item" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span className="badge">{video.category}</span>
                    <span>{video.title}</span>
                    <a href={`https://www.youtube.com/watch?v=${video.youtubeId}`} target="_blank" rel="noreferrer">
                      watch
                    </a>
                    <form method="post" action={`/api/admin/car-videos/${video.id}`}>
                      <button type="submit" aria-label={`Remove video ${video.title} for ${carLabel}`}>
                        Remove
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <form
              method="post"
              action={`/api/admin/cars/${carModel.brand.slug}/${carModel.slug}/videos`}
              style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}
            >
              <input
                type="url"
                name="url"
                placeholder="YouTube URL"
                aria-label={`New video URL for ${carLabel}`}
                required
                style={{ width: 220 }}
              />
              <input
                type="text"
                name="title"
                placeholder="title (e.g. Official reveal)"
                aria-label={`New video title for ${carLabel}`}
                required
                style={{ width: 200 }}
              />
              <select name="category" aria-label={`New video category for ${carLabel}`} defaultValue="OFFICIAL">
                <option value="OFFICIAL">Official</option>
                <option value="CRASH_TEST">Crash test</option>
                <option value="REVIEW">Review</option>
              </select>
              <button type="submit">Add video</button>
            </form>
          </div>
        );
      })}

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Add car model</h2>
      <form method="post" action="/api/admin/cars" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select name="brandSlug" aria-label="Brand for new car model" required defaultValue="">
          <option value="" disabled>
            brand
          </option>
          {brands.map((brand) => (
            <option key={brand.id} value={brand.slug}>
              {brand.name}
            </option>
          ))}
        </select>
        <input type="text" name="slug" placeholder="slug (e.g. model-3)" aria-label="New car model slug" required style={{ width: 160 }} />
        <input type="text" name="name" placeholder="name (e.g. Model 3)" aria-label="New car model name" required style={{ width: 160 }} />
        <button type="submit">Add car model</button>
      </form>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>Add brand</h2>
      <form method="post" action="/api/admin/brands" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input type="text" name="slug" placeholder="slug (e.g. tesla)" aria-label="New brand slug" required style={{ width: 140 }} />
        <input type="text" name="name" placeholder="name (e.g. Tesla)" aria-label="New brand name" required style={{ width: 140 }} />
        <input type="text" name="country" placeholder="country code (e.g. US)" aria-label="New brand country" style={{ width: 140 }} />
        <button type="submit">Add brand</button>
      </form>
    </section>
  );
}
