import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = !!(url && anon);
export const MAX_ENTRIES = 3;

export const supabase = isConfigured
  ? createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

// ---- Auth ------------------------------------------------------------------
export const signUp = (email, password, displayName) =>
  supabase.auth.signUp({ email, password, options: { data: { display_name: displayName } } });
export const signIn = (email, password) => supabase.auth.signInWithPassword({ email, password });
export const signOut = () => supabase.auth.signOut();
export const sendPasswordReset = (email) =>
  supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
export const updatePassword = (newPassword) =>
  supabase.auth.updateUser({ password: newPassword });

export async function ensureProfile(user) {
  const name = user.user_metadata?.display_name || user.email.split("@")[0];
  await supabase.from("profiles").upsert({ id: user.id, display_name: name });
  return name;
}
export async function isAdmin(userId) {
  const { data } = await supabase.from("admins").select("user_id").eq("user_id", userId).maybeSingle();
  return !!data;
}
export async function getLockAt() {
  const { data } = await supabase.from("settings").select("lock_at").eq("id", 1).maybeSingle();
  return data?.lock_at ? new Date(data.lock_at) : null;
}

// ---- Entries (each person owns up to MAX_ENTRIES) --------------------------
export async function loadMyEntries(userId) {
  const { data } = await supabase.from("entries").select("id,name").eq("user_id", userId).order("created_at");
  return data || [];
}
export async function createEntry(userId, name) {
  const { data, error } = await supabase.from("entries").insert({ user_id: userId, name }).select("id,name").single();
  if (error) throw error;
  return data;
}
export async function renameEntry(id, name) { await supabase.from("entries").update({ name }).eq("id", id); }
export async function deleteEntry(id) { await supabase.from("entries").delete().eq("id", id); }

// ---- Per-entry picks -------------------------------------------------------
export async function loadEntryPicks(entryId) {
  const [gp, kp, tb] = await Promise.all([
    supabase.from("group_predictions").select("match_id,pick").eq("entry_id", entryId),
    supabase.from("knockout_predictions").select("round,team").eq("entry_id", entryId),
    supabase.from("tiebreakers").select("*").eq("entry_id", entryId).maybeSingle(),
  ]);
  const gp_ = {}; (gp.data || []).forEach((r) => (gp_[r.match_id] = r.pick));
  const ko = {}; (kp.data || []).forEach((r) => { ko[r.round] = ko[r.round] || []; ko[r.round].push(r.team); });
  return { gp: gp_, ko, tb: tb.data || {} };
}
export async function saveGroupPicks(entryId, gp) {
  await supabase.from("group_predictions").delete().eq("entry_id", entryId);
  const rows = Object.entries(gp).map(([match_id, pick]) => ({ entry_id: entryId, match_id, pick }));
  if (rows.length) await supabase.from("group_predictions").insert(rows);
}
export async function saveKnockoutPicks(entryId, ko) {
  await supabase.from("knockout_predictions").delete().eq("entry_id", entryId);
  const rows = [];
  Object.entries(ko).forEach(([round, teams]) => (teams || []).forEach((team) => rows.push({ entry_id: entryId, round, team })));
  if (rows.length) await supabase.from("knockout_predictions").insert(rows);
}
export async function saveTiebreakers(entryId, tb) {
  await supabase.from("tiebreakers").upsert({
    entry_id: entryId,
    final_total_goals: tb.final_total_goals ?? null,
    top_scoring_team: tb.top_scoring_team ?? null,
    top_scorer: tb.top_scorer ?? null,
  });
}

// Fetch every row from a table, 1000 at a time, to get past
// Supabase's per-request row cap (default 1000 rows).
async function fetchAll(table, columns) {
  const step = 1000;
  let from = 0, all = [], chunk;
  do {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + step - 1);
    if (error) throw error;
    chunk = data || [];
    all = all.concat(chunk);
    from += chunk.length;
  } while (chunk.length === step);
  return all;
}

export async function loadEveryone() {
  const [entries, profiles, gp, kp, tbs] = await Promise.all([
    fetchAll("entries", "id,name,user_id"),
    fetchAll("profiles", "id,display_name"),
    fetchAll("group_predictions", "entry_id,match_id,pick"),
    fetchAll("knockout_predictions", "entry_id,round,team"),
    fetchAll("tiebreakers", "entry_id,final_total_goals,top_scoring_team,top_scorer"),
  ]);
  const owners = {}; profiles.forEach((p) => (owners[p.id] = p.display_name));
  const map = {};
  entries.forEach((e) => (map[e.id] = {
    id: e.id, name: e.name, owner: owners[e.user_id] || "—", ownerId: e.user_id, gp: {}, ko: {}, tb: {},
  }));
  gp.forEach((r) => { if (map[r.entry_id]) map[r.entry_id].gp[r.match_id] = r.pick; });
  kp.forEach((r) => { if (map[r.entry_id]) { (map[r.entry_id].ko[r.round] ||= []).push(r.team); } });
  tbs.forEach((r) => { if (map[r.entry_id]) map[r.entry_id].tb = r; });
  return Object.values(map);
}

export async function loadResults() {
  const [gr, kr] = await Promise.all([
    supabase.from("group_results").select("match_id,home_goals,away_goals"),
    supabase.from("knockout_results").select("round,team"),
  ]);
  const groupResults = {}; (gr.data || []).forEach((r) => (groupResults[r.match_id] = { h: r.home_goals, a: r.away_goals }));
  const koResults = {}; (kr.data || []).forEach((r) => { koResults[r.round] = koResults[r.round] || []; koResults[r.round].push(r.team); });
  return { groupResults, koResults };
}

// ---- Live fixtures (api_fixtures, client-read-only) ------------------------
// Drives the three-state banner and the Everyone's-Picks live glow. API
// orientation is preserved here (home_team/home_goals); callers convert to the
// app's lower-index orientation by team name when comparing against picks.
export async function loadFixtures() {
  const { data, error } = await supabase
    .from("api_fixtures")
    .select("api_id,match_id,grp,round,kickoff_utc,home_team,away_team,status,elapsed,home_goals,away_goals,is_final");
  if (error) throw error;
  return data || [];
}

// ---- Top scorers (top_scorers cache, client-read-only) ---------------------
// Populated by sync-core from /players/topscorers. Returns [] if the table
// doesn't exist yet (backend not deployed), so the widget just stays hidden.
export async function loadTopScorers() {
  const { data, error } = await supabase
    .from("top_scorers").select("rank,player,team,goals,assists").order("rank");
  if (error) throw error;
  return data || [];
}

// ---- Standings (standings_cache, client-read-only) -------------------------
export async function loadStandings() {
  const { data, error } = await supabase
    .from("standings_cache")
    .select("grp,rank,app_team,logo,played,win,draw,lose,gf,ga,gd,points,form");
  if (error) throw error;
  return data || [];
}

// ---- Admin: API sync health (read-only health + pause kill-switch) ---------
// Reads the single sync_state row (id=1) and the unmapped_teams alarm table.
// Both are client-read-only per the data contract; only the pause control writes.
export async function loadSyncHealth() {
  const [ss, ut] = await Promise.all([
    supabase.from("sync_state").select("*").eq("id", 1).maybeSingle(),
    supabase.from("unmapped_teams").select("api_team_id,api_name").order("api_name"),
  ]);
  if (ss.error) throw ss.error;
  if (ut.error) throw ut.error;
  return { sync: ss.data || null, unmapped: ut.data || [] };
}
// The poller kill-switch: sync-live exits early when poller_paused is true.
// .select() back the row so we can tell a real write from an RLS no-op: an
// UPDATE that no policy allows succeeds but changes 0 rows (returns []).
export async function setPollerPaused(paused) {
  const { data, error } = await supabase
    .from("sync_state").update({ poller_paused: paused }).eq("id", 1).select("poller_paused");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Write blocked — sync_state has no admin UPDATE policy (RLS changed 0 rows). See the SQL fix.");
  }
  return data[0].poller_paused;
}

// ---- Admin writes ----------------------------------------------------------
export async function saveGroupResult(matchId, h, a) {
  await supabase.from("group_results").upsert({ match_id: matchId, home_goals: h, away_goals: a });
}
export async function saveKnockoutResults(koResults) {
  await supabase.from("knockout_results").delete().neq("round", "__none__");
  const rows = [];
  Object.entries(koResults).forEach(([round, teams]) => (teams || []).forEach((team) => rows.push({ round, team })));
  if (rows.length) await supabase.from("knockout_results").insert(rows);
}
