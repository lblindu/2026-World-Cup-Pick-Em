# World Cup 2026 Pick'Em

A friends pool: predict every group match, predict who survives each knockout
round, compare everyone's picks, and climb the leaderboard. React + Vite front
end, Supabase back end (Postgres + Auth + Row Level Security). Hosts as a static
site on Cloudflare Pages.

## Stack
- **Front end:** Vite + React (static build → `dist/`)
- **Back end:** Supabase (database, email/password auth, RLS)
- **Hosting:** Cloudflare Pages + your domain

Scoring is computed in the browser from the data tables, so there's no heavy SQL
view to maintain.

---

## 1. Supabase setup
1. Create a project at supabase.com (free tier is plenty). For a clean
   "test in prod" workflow, make **two** projects — one `prod`, one `dev`.
2. Open **SQL Editor** and run the whole of `schema.sql`.
3. **Authentication → Providers:** make sure **Email** is enabled. For a small
   private pool you can turn **off** "Confirm email" so friends can sign in
   immediately (Authentication → Settings).
4. **Project Settings → API:** copy the **Project URL** and the **anon public**
   key. (Never use the `service_role` key in the front end.)

## 2. Local dev
```bash
npm install
cp .env.example .env.local      # then paste your URL + anon key
npm run dev
```
Open the printed localhost URL.

## 3. Make yourself a commissioner (admin)
1. Sign up once in the app (this creates your user id).
2. In Supabase: **Authentication → Users**, copy your id.
3. **SQL Editor:**
   ```sql
   insert into admins (user_id) values ('YOUR-USER-UUID');
   ```
4. Reload — the **🔒 Admin** tab now appears for you. Add a second row for your
   co-commissioner. RLS guarantees only people in `admins` can write results,
   no matter what.

## 4. Deploy to Cloudflare Pages
1. Push this folder to a Git repo (GitHub/GitLab).
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build settings:
   - Framework preset: **Vite**
   - Build command: `npm run build`
   - Build output directory: `dist`
4. **Settings → Environment variables** — add for **Production** (and again for
   **Preview** if you point previews at your `dev` Supabase):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy, then **Custom domains** → add your domain (DNS is already on
   Cloudflare, so it's a couple of clicks).

Every branch/commit gets a **preview URL**; only `main` publishes to your domain.
Test on the preview, then merge to go live.

## 5. Running the pool
- **Before kickoff:** players sign up, make group + knockout picks. Picks lock
  automatically at `settings.lock_at` (default 2026-06-11 19:00 UTC = 3pm ET).
  RLS blocks any writes after that, so it's enforced server-side, not just hidden.
- **Everyone's Picks** stays hidden until lock, then reveals.
- **During the tournament:** open **🔒 Admin** and enter each match's score under
  *Group Results*; mark who advanced under *Knockout Results*. The leaderboard
  and the green/✕ result marks update from that.

### Adjusting the lock (useful for testing)
```sql
update settings set lock_at = '2030-01-01 00:00:00+00';  -- far future: picks open
update settings set lock_at = '2020-01-01 00:00:00+00';  -- past: simulate locked / reveal
```

### Resetting test data
```sql
truncate group_predictions, knockout_predictions, tiebreakers,
         group_results, knockout_results;
```

## Entries
- Each person signs up once with their **name** (the owner), then creates up to
  **3 named entries**, each with its own group + knockout picks and tiebreakers.
- The entry **name** is the label shown everywhere; the **Leaderboard** also
  shows the owner's name next to each entry, so you can tell who's behind
  "Hail Mary Bracket." The 3-per-person cap is enforced in the database (RLS),
  not just the UI.
- Change the cap by editing the `< 3` in the `entries_insert` policy in
  `schema.sql` (and `MAX_ENTRIES` in `src/supabaseClient.js`).

## Notes
- Login is **email + password**; sessions persist, so players sign in once and
  stay logged in across visits.
- Knockout round keys: `ko32, ro16, ro8, ro4, ro2, third, champ`. The third-place
  game is just the winner pick; its two participants (and their 12-pt scoring)
  are derived from the semifinalists who miss the final.
- The top-scoring-team tiebreaker currently sums **group-stage** goals; extend
  `teamGoals()` if you later record knockout match scores too.
