-- Run this in Supabase → SQL Editor → New query → Run.
-- Adds the two RLS policies the board's "Add job" and delete (×) buttons need.
-- Safe to run once; if you ever re-run, drop them first (statements below).

-- drop policy if exists "anon can insert jobs" on jobs;
-- drop policy if exists "anon can delete jobs" on jobs;

create policy "anon can insert jobs"
  on jobs for insert
  with check (true);

create policy "anon can delete jobs"
  on jobs for delete
  using (true);
