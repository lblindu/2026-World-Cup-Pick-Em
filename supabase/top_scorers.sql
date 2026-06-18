-- Top scorers cache (players)
-- ---------------------------------------------------------------------------
-- Backs the "Top scorers (players)" widget at the bottom of Everyone's Picks.
-- Populated by sync-core from /players/topscorers (service-role writes);
-- client-read-only for authenticated users, matching the other cache tables.
-- Run once in the Supabase SQL Editor.

create table if not exists top_scorers (
  rank        int primary key,
  player      text not null,
  photo       text,
  api_team_id bigint,
  team        text,            -- app team name (mapped via team_map) for the flag
  goals       int  not null default 0,
  assists     int  default 0,
  updated_at  timestamptz default now()
);

alter table top_scorers enable row level security;

-- Authenticated users can read; only the service-role poller writes (bypasses RLS).
create policy read_all on top_scorers for select to authenticated using (true);
