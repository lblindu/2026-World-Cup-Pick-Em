# World Cup Pick'Em — Live Data Integration (front-end build handoff)

**Handoff spec for Claude Code.** The backend is **built and running** (see §1). This doc is now the front-end half: how to read the live data already flowing into Supabase, and how to build the live features on top of it.

**Visual source of truth:** `live-features-board.html` — it mocks every live feature in §3 (banner states, live leaderboard, glow on the Everyone's Picks screen, matchday dashboard, standings tab, admin health, notifications). The Everyone's Picks group-stage redesign is already shipped; these features build on top of it.

---

## 0. How to use this handoff

- **Read the actual repo first** (`src/`, and `supabase/functions/` for the existing Edge Functions). Build against the current code.
- **The backend is done — don't rebuild it.** Your job is the front-end features in §3, plus the one remaining backend task in §5 (knockout auto-grading).
- **Preserve existing fixes:** the `fetchAll()` pagination in `supabaseClient.js` and the knockout-reveal guard in `App.jsx`.
- **Keep the manual Admin score-entry path** as a fallback/override.

---

## 1. What's already built and running

The browser never calls the sports API. Two Supabase Edge Functions, scheduled by `pg_cron`, keep Supabase fresh; the app reads only from Supabase.

- **`sync-live`** — runs **every minute**. Self-gating: it checks the stored schedule for free and exits without any API call unless a match is in its window (kickoff − 5 min to FT, 3 h cap). When live, it writes status/elapsed/score into `api_fixtures`; at full time it writes the result into `group_results` **oriented to the lower-index (app) home team**; it updates `sync_state`. Honors the `sync_state.poller_paused` kill-switch.
- **`sync-core`** — runs **every 3 hours**. Refreshes the full schedule + standings into `api_fixtures` / `standings_cache`, and picks up knockout fixtures as the bracket forms. (This is where §5 knockout grading will be added.)
- **Cron jobs:** `wc-live-poller` (every min), `wc-core-refresh` (every 3 h), `wc-reset-quota` (nightly, resets the request counter).
- **Security/plan:** the API key lives in the Edge Function secret `API_FOOTBALL_KEY` (never in the client). Plan is Pro; the self-gating poller keeps usage to a few hundred calls on a busy day.

You don't need to touch any of this to build the front end.

---

## 2. The data contract — what to read

Everything below is **client-read-only** (RLS: authenticated `select`; only the service-role poller writes).

**`api_fixtures`** — one row per match; the heart of the live UI.
- `api_id` (PK), `match_id` (group games only; format `grp-lo-hi`, **home = lower index**), `grp`, `round`
- `kickoff_utc` (true UTC — convert per device), `home_team` / `away_team` (app names, **API home/away orientation**), `home_api_id` / `away_api_id`
- `status` (`NS`/`1H`/`HT`/`2H`/`ET`/`P`/`FT`/`AET`/`PEN`), `elapsed` (minute), `home_goals` / `away_goals` (API orientation), `is_final`, `updated_at`
- Drives: live banner, Everyone's-Picks glow, matchday dashboard, live scores. Knockout fixtures appear here as the bracket forms (`match_id` null, `round` = `Round of 32`, etc.).

**`group_results`** (existing table) — `match_id`, `home_goals`, `away_goals`. Written at FT, **oriented to your lower-index home team**, so your existing ✓/✕ and leaderboard logic reads it unchanged. (Live/provisional state comes from `api_fixtures`; only FT lands here.)

**`standings_cache`** — one row per team: `grp`, `rank`, `app_team`, `logo`, `played`, `win`, `draw`, `lose`, `gf`, `ga`, `gd`, `points`, `form`. The 12 group tables for the Standings tab.

**`sync_state`** (single row, `id=1`) — `last_poll_at`, `last_success_at`, `last_status_code`, `requests_today`, `live_window_open`, `last_ft_written`, `poller_paused`. Powers the Admin health panel; set `poller_paused=true` to stop live polling.

**`unmapped_teams`** — `api_team_id`, `api_name`. Should stay empty; any row = the Admin "unmapped team" alarm (a team result that can't tie to picks until mapped).

**`team_map`** — `api_team_id` → `app_team` + `grp`. Mostly backend; the front end rarely needs it.

**`notifications`** (optional) — for server-side push/email; the client can derive kickoff/movement alerts itself instead.

> **Orientation, in one line:** `api_fixtures` keeps the API's home/away (so the banner shows the real matchup); `group_results` is flipped to your app's home (lower index) for scoring. Don't cross the two.

---

## 3. Live UI features & visual rules

> Build to match **`live-features-board.html`**.

**The rule that ties them together — glow vs. check:**
- **Solid green ✓ / red ✕** = *final*, locked at full time, counted (from `group_results` / `is_final`).
- **Pulsing green glow** = *provisional / live* — currently right, can still change (computed from `api_fixtures` live state).
- Live state is **ephemeral**: only ever trust `group_results` / `is_final` for anything counted. A VAR reversal must only move a *glow*, never a locked ✓.

Each feature — what it shows / what it reads:

1. **Top banner — three states.** Live now / Next up / Last result, each with the user's pick. Reads `api_fixtures`: live = live-status rows; next = soonest `kickoff_utc > now`; last = most recent `is_final`. Retire the old kickoff+120 estimate.
2. **Leaderboard — live points & projected movement.** Live point swing (`+2 live`) and the rank each entry would hold "if it holds" vs. its locked rank (▲/▼). **Compute client-side** from `api_fixtures` live scores + `group_predictions` + your scoring rules; **never persist** live points. Locked points come from `group_results`.
3. **Everyone's Picks — glow on the right pick.** Live match column tinted; entries currently correct on it glow (provisional); finished games keep solid ✓/✕; draw/other picks stay neutral. Reads `api_fixtures` + picks.
4. **Matchday dashboard (Group Stage, after lock).** Summary-first (today's ✓/✕/live/upcoming + points), then the user's own games as state cards. Reads `api_fixtures` (today) + that user's `group_predictions`. Keep it summary-first so it's distinct from the full grid.
5. **Standings tab.** The 12 group tables from `standings_cache`. **Phase-2 layer:** "if it holds, your R32 pick advances/busts" — provisional qualification (top 2 + 8-best-third-placed) cross-referenced with the user's knockout advancer picks. Ship the table first.
6. **Admin — API sync health.** Reads `sync_state` + `unmapped_teams`: last poll/success, request count, live-window flag, last FT, and the unmapped-teams alarm. Controls: re-poll, enter a score, refresh standings, map a team, and **pause** (writes `sync_state.poller_paused`).
7. **Provisional-scoring note.** A compact "live scoring is provisional until full time" callout wherever live points/ranks appear. **Ship it *with* features 2–4.**
8. **Notifications.** Kickoff reminder, movement alert ("you moved into 2nd — provisional"), FT confirmation. **Start client-side** (derive "kicks off in 15 min" from `api_fixtures`, fire a Web Notification while open); add server push later via the optional `notifications` table.

---

## 4. Build sequence

Front-load operational safety and cheap wins; save the two complex pieces (live ranking math, provisional qualification) for once the rest is proven.

1. **Foundation:** a **minimal Admin health panel (§3.6)** reading `sync_state` / `unmapped_teams`, so everything else is debuggable.
2. **Heartbeat + cheap wins:** three-state **banner (§3.1)** and **Everyone's Picks glow (§3.3)**.
3. **Delight:** **live leaderboard (§3.2)**, shipped with the **provisional note (§3.7)**.
4. **Retention:** **matchday dashboard (§3.4)**.
5. **Standings (§3.5):** the table first, then the knockout-implications layer.
6. **Notifications (§3.8):** client-side reminders first, server push later.

---

## 5. Remaining backend task — knockout auto-grading

The one backend piece not yet wired. As the bracket forms, knockout fixtures land in `api_fixtures` (with `round` set). Add logic to `sync-core` that reads each knockout round's teams, maps API round names → your round keys, maps `api_team_id` → app team via `team_map`, and upserts `knockout_results(round, team)` — auto-grading knockout picks. Until this is built, knockouts can be entered via the existing Admin path.

| App key | Teams in round = | API round name |
|---|---|---|
| `ko32` | 32 qualifiers | `Round of 32` |
| `ro16` | 16 | `Round of 16` |
| `ro8`  | 8  | `Quarter-finals` |
| `ro4`  | 4  | `Semi-finals` |
| `ro2`  | 2 finalists | `Final` (both teams) |
| `third`| 3rd-place winner | `3rd Place Final` (winner) |
| `champ`| winner | `Final` (winner) |

Confirm exact round strings via `GET /fixtures/rounds?league=1&season=2026`. Team spellings already reconciled in `team_map` (Czech Republic→Czechia, Korea→South Korea, Ivory Coast→Côte d'Ivoire, Curacao→Curaçao, Bosnia→Bosnia & Herz., Congo DR→DR Congo, USA→United States; Türkiye matches).

---

## 6. Do NOT change

- The Knockouts scoring model, auth, entries CRUD.
- The `fetchAll()` pagination fix and the knockout-reveal guard.
- The manual Admin score-entry path (stays as a fallback).
- The backend (Edge Functions, cron, tables) — read from it; don't rebuild it.

---

## Appendix — API endpoints (for editing `sync-core`, e.g. §5)

Base `https://v3.football.api-sports.io` · header `x-apisports-key` · `league=1`, `season=2026`. Live fixtures refresh every 15s.

| Purpose | Request |
|---|---|
| Schedule / live | `GET /fixtures?league=1&season=2026` · live: `&status=1H-HT-2H-ET-P-BT-LIVE` · batch: `?ids=ID-ID` (≤20) |
| Standings (12 tables; also returns a 3rd-placed table — filter to `Group X`) | `GET /standings?league=1&season=2026` |
| Round names/order | `GET /fixtures/rounds?league=1&season=2026` |
| Teams (map) | `GET /teams?league=1&season=2026` |
