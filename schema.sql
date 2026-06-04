-- =============================================================================
-- WORLD CUP 2026 PICK'EM — Supabase schema  (run in the Supabase SQL editor)
-- One shared league. Email+password auth. Each person owns up to 3 named
-- ENTRIES; picks belong to an entry. Scoring is computed in the app.
-- =============================================================================

create table settings (
  id        int primary key default 1,
  lock_at   timestamptz not null default '2026-06-11 19:00:00+00', -- opening kickoff (3pm ET)
  one_row   boolean default true check (one_row)
);
insert into settings (id) values (1) on conflict do nothing;

create table profiles (
  id            uuid primary key references auth.users on delete cascade,
  display_name  text,                                   -- the PERSON's name (owner)
  created_at    timestamptz default now()
);

create table admins (
  user_id   uuid primary key references auth.users on delete cascade,
  added_at  timestamptz default now()
);

-- Each person can own up to 3 entries; each entry has its own picks.
create table entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  name        text not null,                            -- the ENTRY's label
  created_at  timestamptz default now()
);
create index entries_user_idx on entries(user_id);

-- ---- Predictions (keyed by ENTRY) ------------------------------------------
create table group_predictions (
  entry_id    uuid not null references entries on delete cascade,
  match_id    text not null,                            -- e.g. 'A-0-1'
  pick        text not null check (pick in ('home','draw','away')),
  primary key (entry_id, match_id)
);
-- round in: ko32, ro16, ro8, ro4, ro2, third, champ
create table knockout_predictions (
  entry_id  uuid not null references entries on delete cascade,
  round     text not null,
  team      text not null,
  primary key (entry_id, round, team)
);
create table tiebreakers (
  entry_id          uuid primary key references entries on delete cascade,
  final_total_goals int,
  top_scoring_team  text,
  top_scorer        text,
  updated_at        timestamptz default now()
);

-- ---- Actual results (admins only) ------------------------------------------
create table group_results (
  match_id    text primary key,
  home_goals  int not null,
  away_goals  int not null
);
create table knockout_results (
  round  text not null,
  team   text not null,
  primary key (round, team)
);

-- =============================================================================
-- HELPERS
-- =============================================================================
create or replace function picks_open() returns boolean
language sql stable as $$ select now() < (select lock_at from settings where id = 1) $$;

create or replace function is_admin() returns boolean
language sql stable as $$ select exists (select 1 from admins where user_id = auth.uid()) $$;

create or replace function owns_entry(eid uuid) returns boolean
language sql stable as $$ select exists (select 1 from entries where id = eid and user_id = auth.uid()) $$;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
alter table settings              enable row level security;
alter table profiles              enable row level security;
alter table admins                enable row level security;
alter table entries               enable row level security;
alter table group_predictions     enable row level security;
alter table knockout_predictions  enable row level security;
alter table tiebreakers           enable row level security;
alter table group_results         enable row level security;
alter table knockout_results      enable row level security;

-- everyone signed-in can read (needed for reveal + leaderboard)
create policy read_all on settings             for select to authenticated using (true);
create policy read_all on profiles             for select to authenticated using (true);
create policy read_all on admins               for select to authenticated using (true);
create policy read_all on entries              for select to authenticated using (true);
create policy read_all on group_predictions    for select to authenticated using (true);
create policy read_all on knockout_predictions  for select to authenticated using (true);
create policy read_all on tiebreakers          for select to authenticated using (true);
create policy read_all on group_results        for select to authenticated using (true);
create policy read_all on knockout_results     for select to authenticated using (true);

create policy own_profile on profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- entries: create up to 3 (before lock), edit/delete your own (before lock)
create policy entries_insert on entries for insert to authenticated
  with check (
    user_id = auth.uid() and picks_open()
    and (select count(*) from entries e where e.user_id = auth.uid()) < 3
  );
create policy entries_update on entries for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy entries_delete on entries for delete to authenticated
  using (user_id = auth.uid() and picks_open());

-- predictions: write only for entries you own, only before lock
create policy own_groups on group_predictions for all to authenticated
  using (owns_entry(entry_id)) with check (owns_entry(entry_id) and picks_open());
create policy own_ko on knockout_predictions for all to authenticated
  using (owns_entry(entry_id)) with check (owns_entry(entry_id) and picks_open());
create policy own_tb on tiebreakers for all to authenticated
  using (owns_entry(entry_id)) with check (owns_entry(entry_id) and picks_open());

-- results: admins only
create policy admin_group_results on group_results for all to authenticated
  using (is_admin()) with check (is_admin());
create policy admin_ko_results on knockout_results for all to authenticated
  using (is_admin()) with check (is_admin());

-- =============================================================================
-- AUTO-CREATE A PROFILE ROW ON SIGNUP
-- =============================================================================
create or replace function handle_new_user() returns trigger
language plpgsql security definer as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

-- =============================================================================
-- MAKE YOURSELF AN ADMIN
--   1) sign up in the app, 2) copy your id from Authentication -> Users, then:
--   insert into admins (user_id) values ('YOUR-USER-UUID');
-- =============================================================================
