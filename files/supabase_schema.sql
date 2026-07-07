-- Run this in Supabase: Project → SQL Editor → New query → paste → Run

create table jobs (
  id text primary key,
  role text not null,
  company text not null,
  location text,
  url text,
  status text not null default 'Saved',
  notes text default '',
  match_score integer,
  posted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Dedupe key so the daily Apify pull doesn't create duplicate rows
create unique index jobs_url_unique on jobs (url) where url is not null and url != '';

-- Enable Row Level Security
alter table jobs enable row level security;

-- Since this is a personal single-user tracker, allow the anon key
-- (used by the browser-facing tracker) full read/write. The board's
-- "Add job" and delete (×) buttons use the anon/publishable key, so it
-- needs insert + delete in addition to read + update. The server-side
-- bridge uses the service role key, which bypasses RLS entirely.
create policy "anon can read jobs"
  on jobs for select
  using (true);

create policy "anon can update status/notes"
  on jobs for update
  using (true);

create policy "anon can insert jobs"
  on jobs for insert
  with check (true);

create policy "anon can delete jobs"
  on jobs for delete
  using (true);

-- Auto-update the updated_at timestamp on every change
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger jobs_updated_at
  before update on jobs
  for each row
  execute function set_updated_at();
