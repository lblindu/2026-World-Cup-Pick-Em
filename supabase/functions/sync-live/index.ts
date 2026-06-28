import { createClient } from "jsr:@supabase/supabase-js@2";

const API = "https://v3.football.api-sports.io";
const KEY = Deno.env.get("API_FOOTBALL_KEY")!;
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Must match data.js order (drives match_id orientation).
const GROUPS: Record<string, string[]> = {
  A: ["Mexico", "South Africa", "South Korea", "Czechia"],
  B: ["Canada", "Bosnia & Herz.", "Qatar", "Switzerland"],
  C: ["Brazil", "Morocco", "Haiti", "Scotland"],
  D: ["United States", "Paraguay", "Australia", "Türkiye"],
  E: ["Germany", "Curaçao", "Côte d'Ivoire", "Ecuador"],
  F: ["Netherlands", "Japan", "Sweden", "Tunisia"],
  G: ["Belgium", "Egypt", "Iran", "New Zealand"],
  H: ["Spain", "Cape Verde", "Saudi Arabia", "Uruguay"],
  I: ["France", "Senegal", "Iraq", "Norway"],
  J: ["Argentina", "Algeria", "Austria", "Jordan"],
  K: ["Portugal", "DR Congo", "Uzbekistan", "Colombia"],
  L: ["England", "Croatia", "Ghana", "Panama"],
};
const FINAL = ["FT", "AET", "PEN"];
const LEAD = 5 * 60 * 1000;        // start 5 min before kickoff
const CAP  = 3 * 60 * 60 * 1000;   // stop treating as live after 3h (safety)

async function apiGet(path: string) {
  const r = await fetch(`${API}${path}`, { headers: { "x-apisports-key": KEY } });
  return { status: r.status, body: await r.json() };
}

Deno.serve(async () => {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // kill-switch + request counter
  const { data: ss } = await sb.from("sync_state")
    .select("poller_paused, requests_today").eq("id", 1).maybeSingle();
  if (ss?.poller_paused) {
    return new Response(JSON.stringify({ skipped: "paused" }), { headers: { "Content-Type": "application/json" } });
  }

  // GATE (free, no API call): fixtures in-window and not final
  const lower = new Date(now - CAP).toISOString();
  const upper = new Date(now + LEAD).toISOString();
  const { data: due } = await sb.from("api_fixtures")
    .select("api_id, match_id, grp")
    .eq("is_final", false)
    .gte("kickoff_utc", lower)
    .lte("kickoff_utc", upper);

  if (!due || due.length === 0) {
    await sb.from("sync_state").update({
      last_poll_at: nowIso, live_window_open: false, updated_at: nowIso,
    }).eq("id", 1);
    return new Response(JSON.stringify({ window: "closed", polled: 0 }), { headers: { "Content-Type": "application/json" } });
  }

  // team map (for FT orientation + standings grp)
  const { data: tm } = await sb.from("team_map").select("api_team_id, app_team, grp");
  const appByApiId = new Map<number, string>();
  const teamById = new Map<number, { app: string; grp: string }>();
  for (const t of tm ?? []) {
    appByApiId.set(Number(t.api_team_id), t.app_team);
    teamById.set(Number(t.api_team_id), { app: t.app_team, grp: t.grp });
  }

  const byId = new Map(due.map((d) => [Number(d.api_id), d]));
  const ids = [...byId.keys()];
  let lastStatus = 0, lastFt: string | null = null, batches = 0;
  const fixUpdates: Promise<any>[] = [];
  const grpResults: any[] = [];

  for (let i = 0; i < ids.length; i += 20) {
    const res = await apiGet(`/fixtures?ids=${ids.slice(i, i + 20).join("-")}`);
    lastStatus = res.status; batches++;
    for (const f of res.body?.response ?? []) {
      const st = f.fixture.status.short;
      const isFinal = FINAL.includes(st);
      // keep api_fixtures in the API's own home/away orientation (for display)
      fixUpdates.push(sb.from("api_fixtures").update({
        status: st, elapsed: f.fixture.status.elapsed,
        home_goals: f.goals.home, away_goals: f.goals.away,
        is_final: isFinal, updated_at: nowIso,
      }).eq("api_id", f.fixture.id));

      // at FT, write group_results oriented to the lower-index (app) home team
      const meta = byId.get(f.fixture.id);
      if (isFinal) {
        lastFt = `${f.teams.home.name} ${f.goals.home}-${f.goals.away} ${f.teams.away.name}`;
        if (meta?.match_id && meta.grp) {
          const order = GROUPS[meta.grp];
          const [lo, hi] = meta.match_id.split("-").slice(1).map(Number);
          const appHome = order[lo];
          const apiHomeApp = appByApiId.get(f.teams.home.id);
          const sameOrient = apiHomeApp === appHome;
          grpResults.push({
            match_id: meta.match_id,
            home_goals: sameOrient ? f.goals.home : f.goals.away,
            away_goals: sameOrient ? f.goals.away : f.goals.home,
          });
        }
      }
    }
  }

  await Promise.all(fixUpdates);
  let stWrites = 0;
  if (grpResults.length) {
    await sb.from("group_results").upsert(grpResults, { onConflict: "match_id" });

    // A game just finished → refresh standings now instead of waiting up to 3h
    // for sync-core. Best-effort: never let this break the FT write.
    try {
      const stnd = await apiGet(`/standings?league=1&season=2026`);
      batches++; // count the extra API call
      const seen = new Set<string>();
      const srows: any[] = [];
      for (const lg of stnd.body?.response ?? []) {
        for (const table of lg.league?.standings ?? []) {
          for (const r of table) {
            const label = String(r.group ?? "");
            if (!label.toLowerCase().startsWith("group")) continue; // skip 3rd-placed table
            const t2 = teamById.get(r.team.id);
            const grp = t2?.grp ?? label.replace(/group\s*/i, "").trim();
            const key = `${grp}:${r.team.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            srows.push({
              grp, rank: r.rank, api_team_id: r.team.id, app_team: t2?.app ?? r.team.name, logo: r.team.logo,
              played: r.all.played, win: r.all.win, draw: r.all.draw, lose: r.all.lose,
              gf: r.all.goals.for, ga: r.all.goals.against, gd: r.goalsDiff, points: r.points,
              form: r.form, updated_at: nowIso,
            });
          }
        }
      }
      if (srows.length) {
        await sb.from("standings_cache").upsert(srows, { onConflict: "grp,api_team_id" });
        stWrites = srows.length;
      }
    } catch (_e) { /* best-effort */ }
  }

  await sb.from("sync_state").update({
    last_poll_at: nowIso, last_success_at: nowIso, last_status_code: lastStatus,
    live_window_open: true, requests_today: (ss?.requests_today ?? 0) + batches,
    last_ft_written: lastFt ?? undefined, updated_at: nowIso,
  }).eq("id", 1);

  return new Response(JSON.stringify({
    window: "open", polled: ids.length, ft_writes: grpResults.length, standings: stWrites, status: lastStatus,
  }), { headers: { "Content-Type": "application/json" } });
});