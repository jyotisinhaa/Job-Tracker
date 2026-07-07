# Job Tracker — Setup Plan

## Context

Three files already exist in `files/`:

- `supabase_schema.sql` — Postgres table + row-level security for the `jobs` table
- `apify_supabase_bridge.js` — a Cloudflare Worker that catches Apify's "run succeeded"
  webhook, pulls the scraped dataset, and upserts rows into Supabase
- `job_tracker_supabase.html` — a kanban board that reads/writes the Supabase `jobs` table live

The **code is complete**, but nothing is connected yet. Only the Apify LinkedIn scraper is
live (runs daily 10am PST). Goal: a self-updating job board that fills daily on its own.

Data flow: `Apify (live) → Cloudflare Worker (bridge) → Supabase (Postgres) → HTML board`.

## Setup sequence (one link at a time, verify each)

### Phase 1 — Supabase (database)  ← YOU ARE HERE
1. Create account at supabase.com → new project (save DB password, pick nearest region).
2. SQL Editor → New query → paste all of `files/supabase_schema.sql` → Run (expect "Success").
3. Project Settings → API → copy **Project URL**, **anon** key, **service_role** key.

Verify: table `jobs` exists (Table Editor shows it, empty).

### Phase 2 — Connect the webpage (early win)
Edit: replace placeholders at `files/job_tracker_supabase.html` lines 68-69
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`) with the real Project URL + anon key.

Verify: open the HTML in a browser → no yellow config banner → "Loaded 0 jobs" →
manually **Add job** → it persists across refresh. The anon key is browser-safe;
the service_role key must NOT go here.

### Phase 3 — Cloudflare Worker (the bridge)
1. dash.cloudflare.com → Workers & Pages → Create Worker → Deploy default.
2. Edit code → paste `files/apify_supabase_bridge.js` → Deploy.
3. Settings → Variables and Secrets → add: `APIFY_TOKEN` (Apify → Settings → Integrations),
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (service_role). Store as Secret type.
4. Copy the Worker URL (`https://xxxx.workers.dev`).

**Field-mapping check (important):** get one sample dataset item from Apify (last run →
Storage → Dataset → one JSON row). The bridge assumes fields `jobTitle`, `companyName`,
`location`, `jobUrl`, `postedTime`, `keywordMatchScorePercentage` (bridge lines 51-61). If the
actor names them differently, rows get filtered out silently — fix the `.map(...)` to match,
then redeploy.

Verify: manually trigger the actor → Worker returns "Inserted/updated N jobs" and rows appear
in Supabase.

### Phase 4 — Apify webhook (close the loop)
Apify actor → Integrations/Webhooks → add webhook → event **Run succeeded** → paste the
Worker URL → save.

Verify: run the actor once → new jobs appear in the HTML board within ~5 min
(the page auto-refreshes every 5 min).

## Files edited during execution
- `files/job_tracker_supabase.html` — lines 68-69, inject real Supabase URL + anon key.
- `files/apify_supabase_bridge.js` — the `.map()` field mapping (only if sample data differs).

## Risks
- **Field mapping** is the most likely silent failure — resolved by inspecting a real dataset item.
- `on_conflict=url` upsert + `jobs_url_unique` partial index dedupe re-scraped jobs; confirm the
  actor outputs a stable `jobUrl` per listing.
- Keep the service_role key out of the HTML and out of any commit.

## End-to-end verification
Trigger the Apify actor → Worker responds 200 "Inserted/updated N jobs" → rows land in Supabase
`jobs` → open the HTML board → jobs render in the correct status columns → change a status /
edit a note → refresh → change persisted.
