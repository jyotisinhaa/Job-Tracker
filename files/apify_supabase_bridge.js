// Cloudflare Worker: Apify → Supabase bridge
//
// WHAT THIS DOES:
// Apify calls this Worker's URL as a webhook when your daily schedule
// finishes running. This Worker then fetches the resulting job listings
// from Apify's API and writes (upserts) them into your Supabase "jobs" table.
//
// SETUP (see the walkthrough below the code):
// 1. Create a free Cloudflare account → Workers & Pages → Create Worker
// 2. Paste this code in
// 3. Set the four environment variables (Settings → Variables)
// 4. Deploy, copy the Worker URL
// 5. In Apify: your Actor → Webhooks → add this URL as a webhook for
//    "Run succeeded"

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Only POST accepted (Apify webhook)", { status: 405 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response("Invalid JSON payload", { status: 400 });
    }

    // Apify's webhook payload includes the run's default dataset ID
    const datasetId =
      payload?.resource?.defaultDatasetId ||
      payload?.eventData?.defaultDatasetId;

    if (!datasetId) {
      return new Response("No dataset ID found in webhook payload", { status: 400 });
    }

    // 1. Fetch the scraped job listings from Apify's dataset
    const apifyRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${env.APIFY_TOKEN}&clean=true`
    );
    if (!apifyRes.ok) {
      return new Response(`Failed to fetch Apify dataset: ${apifyRes.status}`, { status: 502 });
    }
    const items = await apifyRes.json();

    // How many of the best-matching jobs to keep per run.
    const TOP_N = 30;

    // Drop jobs too senior for a ~4-year profile: senior-track titles, or
    // descriptions that demand more than MAX_YEARS of experience (the actor
    // extracts required years into item.yearsOfExperience).
    const SENIOR_TITLE = /\b(staff|principal|distinguished|fellow|director|vice\s*president|vp|manager)\b|head of/i;
    const MAX_YEARS = 5;
    const reqYears = (item) => {
      const a = item.yearsOfExperience;
      if (!Array.isArray(a)) return null;
      let mx = null;
      for (const e of a) { const m = String((e && e.years) || "").match(/\d+/); if (m) { const n = +m[0]; if (mx == null || n > mx) mx = n; } }
      return mx;
    };
    const tooSenior = (item) => {
      if (SENIOR_TITLE.test(item.jobTitle || "")) return true;
      const y = reqYears(item);
      return y != null && y > MAX_YEARS;
    };

    // 2. Map Apify's fields to your Supabase "jobs" table schema.
    //    Adjust field names here if your Actor's output differs.
    let rows = items
      .filter((item) => (item.jobUrl || item.jobTitle) && !tooSenior(item))
      .map((item) => ({
        id:
          item.jobUrl ||
          `${item.jobTitle}-${item.companyName}`.toLowerCase().replace(/\s+/g, "-"),
        role: item.jobTitle || "Untitled role",
        company: item.companyName || "Unknown company",
        location: item.location || "",
        url: item.jobUrl || null,
        status: "Saved",
        match_score: item.keywordMatchScorePercentage ?? null,
        // Use publishedAt (ISO timestamp, e.g. "2026-07-02T00:00:00.000Z").
        // NOT postedTime — that's a relative string like "5 days ago" and
        // would break the timestamptz column, failing the whole batch.
        posted_at: item.publishedAt || null,
      }));

    // Keep only the TOP_N best matches (highest match_score first), so each
    // day adds up to TOP_N genuinely-best-fit jobs. Dedupe (on_conflict=id)
    // means jobs already on the board aren't re-added.
    rows.sort((a, b) => (b.match_score ?? -1) - (a.match_score ?? -1));
    rows = rows.slice(0, TOP_N);

    if (rows.length === 0) {
      return new Response("No rows to insert", { status: 200 });
    }

    // 3. Upsert into Supabase. The service role key bypasses RLS.
    //    Dedupe on the primary key "id" (which we set to the job URL), so
    //    re-running the scrape won't create duplicate rows. We use "id" (not
    //    "url") because the schema's url index is partial and Postgres can't
    //    use a partial index for ON CONFLICT.
    const upsertRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/jobs?on_conflict=id`,
      {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
      }
    );

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      return new Response(`Supabase upsert failed: ${upsertRes.status} ${errText}`, { status: 502 });
    }

    return new Response(`Inserted/updated ${rows.length} jobs.`, { status: 200 });
  },
};
