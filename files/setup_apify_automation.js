// One-time setup of the daily Apify automation, via the Apify REST API.
// Creates (idempotently-ish):
//   1. a Task = the LinkedIn scraper + your saved search input (scraper_input.json)
//   2. a Webhook = on task "run succeeded", POST to your Cloudflare Worker
//   3. a Schedule = run the task daily at 10:00 America/Los_Angeles
//
// Usage:
//   node files/setup_apify_automation.js <workerUrl>
//
// Reads APIFY_TOKEN from ../.env

const fs = require("fs");
const path = require("path");

const ACTOR_ID = "2rJKkhh7vjpX7pvjg"; // cheap_scraper/linkedin-job-scraper
const TASK_NAME = "daily-linkedin-jobs";
const SCHEDULE_NAME = "daily-linkedin-jobs";
const CRON = "0 10 * * *";
const TIMEZONE = "America/Los_Angeles";

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  const out = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function api(method, url, token, body) {
  const res = await fetch(`https://api.apify.com/v2/${url}${url.includes("?") ? "&" : "?"}token=${token}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${JSON.stringify(json)}`);
  return json.data ?? json;
}

async function main() {
  const env = loadEnv();
  const workerUrl = process.argv[2];
  if (!workerUrl) { console.error("Usage: node files/setup_apify_automation.js <workerUrl>"); process.exit(1); }
  if (!env.APIFY_TOKEN) { console.error("Missing APIFY_TOKEN in .env"); process.exit(1); }
  const token = env.APIFY_TOKEN;

  const input = JSON.parse(fs.readFileSync(path.join(__dirname, "scraper_input.json"), "utf8"));

  // 1. Task
  const task = await api("POST", "actor-tasks", token, {
    actId: ACTOR_ID,
    name: TASK_NAME,
    input,
  });
  console.log(`✅ Task created: ${task.id} (${task.name})`);

  // 2. Webhook: on this task's run success, hit the Worker
  const webhook = await api("POST", "webhooks", token, {
    eventTypes: ["ACTOR.RUN.SUCCEEDED"],
    condition: { actorTaskId: task.id },
    requestUrl: workerUrl,
    isAdHoc: false,
  });
  console.log(`✅ Webhook created: ${webhook.id} -> ${workerUrl}`);

  // 3. Schedule: run the task daily
  const schedule = await api("POST", "schedules", token, {
    name: SCHEDULE_NAME,
    cronExpression: CRON,
    timezone: TIMEZONE,
    isEnabled: true,
    actions: [{ type: "RUN_ACTOR_TASK", actorTaskId: task.id }],
  });
  console.log(`✅ Schedule created: ${schedule.id} (${CRON} ${TIMEZONE})`);

  console.log("\nDaily automation is live:");
  console.log(`  Every day 10:00 ${TIMEZONE} → scrape → webhook → Worker → top 30 into Supabase.`);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
