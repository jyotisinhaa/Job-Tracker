// Local backfill / bridge test.
// Runs the SAME fetch → map → upsert the Cloudflare Worker does, but from your
// machine. Use it to (a) prove the pipeline before deploying, and (b) manually
// pull a past Apify run into Supabase.
//
// Usage:
//   node files/backfill_from_apify.js <datasetId> [topN]
//     topN: how many highest-match jobs to keep (default 30; "all" = no cap)
//
// Reads SUPABASE_URL, SUPABASE_SERVICE_KEY, APIFY_TOKEN from ../.env

const fs = require("fs");
const path = require("path");

// --- tiny .env loader (no dependency) ---
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  const out = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  const env = loadEnv();
  const datasetId = process.argv[2];
  const topNArg = process.argv[3] || "30";
  const topN = topNArg.toLowerCase() === "all" ? Infinity : parseInt(topNArg, 10);
  if (!datasetId) {
    console.error("Usage: node files/backfill_from_apify.js <datasetId> [topN]");
    process.exit(1);
  }
  for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "APIFY_TOKEN"]) {
    if (!env[k]) { console.error(`Missing ${k} in .env`); process.exit(1); }
  }

  // 1. Fetch all scraped items from the Apify dataset
  const apifyUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${env.APIFY_TOKEN}&clean=true`;
  let items = await (await fetch(apifyUrl)).json();
  console.log(`Fetched ${items.length} items from Apify dataset ${datasetId}`);

  // Drop jobs that are too senior for a ~4-year profile: senior-track titles,
  // or descriptions that explicitly demand more than MAX_YEARS of experience
  // (the actor extracts required years into item.yearsOfExperience).
  const SENIOR_TITLE = /\b(staff|principal|distinguished|fellow|director|vice\s*president|vp|manager)\b|head of/i;
  // Backend-only: drop frontend / full-stack / UI / mobile roles.
  const FRONTEND_TITLE = /\b(frontend|front[\s-]?end|full[\s-]?stack|fullstack|ui|ux|react|angular|vue|javascript|web developer|mobile|ios|android)\b/i;
  const MAX_YEARS = 5;
  function reqYears(item) {
    const a = item.yearsOfExperience;
    if (!Array.isArray(a)) return null;
    let mx = null;
    for (const e of a) { const m = String((e && e.years) || "").match(/\d+/); if (m) { const n = +m[0]; if (mx == null || n > mx) mx = n; } }
    return mx;
  }
  function tooSenior(item) {
    if (SENIOR_TITLE.test(item.jobTitle || "")) return true;
    const y = reqYears(item);
    return y != null && y > MAX_YEARS;
  }

  const before = items.length;
  // Drop too-senior roles, and jobs that failed a soft filter such as
  // companySizeMin: 1000 (the actor flags those with dynamicFilterMatch === false).
  items = items.filter((item) => !tooSenior(item) && item.dynamicFilterMatch !== false && !FRONTEND_TITLE.test(item.jobTitle || ""));
  console.log(`Filtered out ${before - items.length} jobs (too-senior / too-small company / frontend); kept ${items.length}`);

  // 2. Map to the jobs table schema (identical to the Worker bridge)
  let rows = items
    .filter((item) => item.jobUrl || item.jobTitle)
    .map((item) => ({
      id: item.jobUrl || `${item.jobTitle}-${item.companyName}`.toLowerCase().replace(/\s+/g, "-"),
      role: item.jobTitle || "Untitled role",
      company: item.companyName || "Unknown company",
      location: item.location || "",
      url: item.jobUrl || null,
      status: "Saved",
      match_score: item.keywordMatchScorePercentage ?? null,
      posted_at: item.publishedAt || null,
    }));

  // Keep only the top-N best matches (highest match_score first)
  rows.sort((a, b) => (b.match_score ?? -1) - (a.match_score ?? -1));
  if (Number.isFinite(topN)) rows = rows.slice(0, topN);
  console.log(`Mapped ${rows.length} rows (top ${Number.isFinite(topN) ? topN : "all"} by match score)`);

  if (rows.length === 0) { console.log("Nothing to insert."); return; }

  // 3. Upsert into Supabase (service key bypasses RLS; ignore URL duplicates)
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/jobs?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    console.error(`Supabase upsert failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log(`✅ Upserted ${rows.length} jobs into Supabase.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
