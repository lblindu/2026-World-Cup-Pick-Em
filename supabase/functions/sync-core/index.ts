import { createClient } from "jsr:@supabase/supabase-js@2";

const API = "https://v3.football.api-sports.io";
const KEY = Deno.env.get("API_FOOTBALL_KEY")!;
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ⚠️ This within-group ORDER must match your app's data.js exactly (it drives match_id).
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

async function apiGet(path: string) {
  const r = await fetch(`${API}${path}`, { headers: { "x-apisports-key": KEY } });
  return { status: r.status, body: await r.json() };
}

Deno.serve(async () => {
  const { data: tm } = await sb.from("team_map").select("api_team_id, app_team, grp");
  const teamById = new Map<number, { app: string; grp: string }>();
  for (const t of tm ?? []) teamById.set(Number(t.api_team_id), { app: t.app_team, grp: t.grp });

  // ---- fixtures ----
  const fx = await apiGet(`/fixtures?league=1&season=2026`);
  const unmapped = new Map<number, string>();
  const rows: any[] = [];
  for (const f of fx.body?.response ?? []) {
    const h = f.teams.home, a = f.teams.away;
    const hm = teamById.get(h.id), am = teamById.get(a.id);
    if (!hm) unmapped.set(h.id, h.name);
    if (!am) unmapped.set(a.id, a.name);

    const round = f.league.round ?? "";
    let grp: string | null = null, match_id: string | null = null;
    if (round.toLowerCase().startsWith("group") && hm && am && hm.grp === am.grp) {
      grp = hm.grp;
      const order = GROUPS[grp];
      const i = order.indexOf(hm.app), j = order.indexOf(am.app);
      if (i >= 0 && j >= 0) match_id = `${grp}-${Math.min(i, j)}-${Math.max(i, j)}`;
    }

    const st = f.fixture.status.short;
    rows.push({
      api_id: f.fixture.id, match_id, round, grp,
      kickoff_utc: f.fixture.date,
      home_api_id: h.id, away_api_id: a.id,
      home_team: hm?.app ?? h.name, away_team: am?.app ?? a.name,
      status: st, elapsed: f.fixture.status.elapsed,
      home_goals: f.goals.home, away_goals: f.goals.away,
      is_final: FINAL.includes(st),
      updated_at: new Date().toISOString(),
    });
  }
  const { error: fxErr } = rows.length
    ? await sb.from("api_fixtures").upsert(rows, { onConflict: "api_id" })
    : { error: null };
  if (unmapped.size) {
    await sb.from("unmapped_teams").upsert(
      [...unmapped].map(([api_team_id, api_name]) => ({ api_team_id, api_name })),
      { onConflict: "api_team_id" },
    );
  }

  // ---- standings: GROUP TABLES ONLY, deduped ----
  const stnd = await apiGet(`/standings?league=1&season=2026`);
  const seen = new Set<string>();
  const srows: any[] = [];
  for (const lg of stnd.body?.response ?? []) {
    for (const table of lg.league?.standings ?? []) {
      for (const r of table) {
        const label = String(r.group ?? "");
        if (!label.toLowerCase().startsWith("group")) continue; // skip 3rd-placed ranking table
        const t2 = teamById.get(r.team.id);
        const grp = t2?.grp ?? label.replace(/group\s*/i, "").trim();
        const key = `${grp}:${r.team.id}`;
        if (seen.has(key)) continue; // dedupe safety net
        seen.add(key);
        srows.push({
          grp, rank: r.rank, api_team_id: r.team.id, app_team: t2?.app ?? r.team.name, logo: r.team.logo,
          played: r.all.played, win: r.all.win, draw: r.all.draw, lose: r.all.lose,
          gf: r.all.goals.for, ga: r.all.goals.against, gd: r.goalsDiff, points: r.points,
          form: r.form, updated_at: new Date().toISOString(),
        });
      }
    }
  }
  const { error: sErr } = srows.length
    ? await sb.from("standings_cache").upsert(srows, { onConflict: "grp,api_team_id" })
    : { error: null };

  // ---- top scorers (players) ----
  // Best-effort: never let this break fixtures/standings sync.
  let tsCount = 0, tsErr: string | null = null;
  try {
    const ts = await apiGet(`/players/topscorers?league=1&season=2026`);
    const tsrows: any[] = [];
    let trank = 0;
    for (const e of ts.body?.response ?? []) {
      const st = e.statistics?.[0];
      const goals = st?.goals?.total ?? 0;
      if (!goals) continue; // skip players with no goals
      trank++;
      if (trank > 30) break; // cache the top 30
      const t = teamById.get(st.team?.id);
      tsrows.push({
        rank: trank,
        player: e.player?.name ?? `${e.player?.firstname ?? ""} ${e.player?.lastname ?? ""}`.trim(),
        photo: e.player?.photo ?? null,
        api_team_id: st.team?.id ?? null,
        team: t?.app ?? st.team?.name ?? null,
        goals,
        assists: st.goals?.assists ?? 0,
        updated_at: new Date().toISOString(),
      });
    }
    if (tsrows.length) {
      await sb.from("top_scorers").upsert(tsrows, { onConflict: "rank" });
      await sb.from("top_scorers").delete().gt("rank", tsrows.length); // prune stale tail
      tsCount = tsrows.length;
    }
  } catch (e) { tsErr = String(e); }

  // ---- health ----
  const now = new Date().toISOString();
  await sb.from("sync_state").update({
    last_poll_at: now, last_success_at: now, last_status_code: fx.status, updated_at: now,
  }).eq("id", 1);

  return new Response(JSON.stringify({
    fixtures: rows.length, standings: srows.length, top_scorers: tsCount, unmapped: unmapped.size,
    errors: { fixtures: fxErr?.message ?? null, standings: sErr?.message ?? null, top_scorers: tsErr },
  }), { headers: { "Content-Type": "application/json" } });
});