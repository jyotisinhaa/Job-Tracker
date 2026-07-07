# Job Hunt Tracker

An automated, self-updating LinkedIn job tracker. Every morning it scrapes fresh
roles matching your profile, ranks them against your resume, keeps the best 30,
and shows them on a kanban board.

```
Apify LinkedIn scraper ──(daily 10:00 PT)──▶ webhook ──▶ Cloudflare Worker
   (keyword + location filters)                              │ rank by resume match
                                                             │ drop too-senior roles
                                                             │ keep top 30
                                                             ▼
        Kanban board (HTML)  ◀──(auto-refresh)──  Supabase (Postgres)
```

## Components

| File | Role |
|------|------|
| `files/job_tracker_supabase.html` | The kanban board (reads/writes Supabase live) |
| `files/apify_supabase_bridge.js` | Cloudflare Worker: webhook → fetch → filter → rank → upsert |
| `files/supabase_schema.sql` | Postgres table + row-level security |
| `files/scraper_input.json` | The daily Apify search config (roles, locations, resume keywords, seniority filters) |
| `files/backfill_from_apify.js` | Manual reload: `node files/backfill_from_apify.js <datasetId> [topN]` |
| `files/setup_apify_automation.js` | One-time: creates the Apify task, webhook, and daily schedule |

## Setup

1. **Supabase** — create a project, run `files/supabase_schema.sql` in the SQL Editor.
2. **Config** — `cp .env.example .env` and fill in your Supabase + Apify keys.
   Put your Supabase URL + anon key into `files/job_tracker_supabase.html` (top of the script).
3. **Cloudflare Worker** — `npx wrangler deploy`, then set secrets:
   ```
   npx wrangler secret put APIFY_TOKEN
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_SERVICE_KEY
   ```
4. **Apify automation** — `node files/setup_apify_automation.js <your-worker-url>`.
5. **(Optional) Host the board** — `npx wrangler pages deploy public --project-name job-tracker --branch main`.

## Tuning

- **Target roles / locations / skills / seniority:** edit `files/scraper_input.json`,
  then update the Apify task (`PUT /v2/actor-tasks/<id>/input`).
- **How many jobs per day:** change `TOP_N` in `files/apify_supabase_bridge.js`, then `npx wrangler deploy`.
- **Seniority cutoff:** `MAX_YEARS` / the title regex in the Worker and backfill script.

## Notes

- The board uses the Supabase **anon/publishable** key, which is browser-safe. Row-level
  security currently allows anon read/write (single-user tracker). If you make the repo or
  the hosted site public and want it locked down, add auth (e.g. Cloudflare Access).
- Secrets live only in `.env` (gitignored) and in the Worker's secrets.
