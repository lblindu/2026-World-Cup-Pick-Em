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
  const [entries, profiles, gp, kp] = await Promise.all([
    fetchAll("entries", "id,name,user_id"),
    fetchAll("profiles", "id,display_name"),
    fetchAll("group_predictions", "entry_id,match_id,pick"),
    fetchAll("knockout_predictions", "entry_id,round,team"),
  ]);
  const owners = {}; profiles.forEach((p) => (owners[p.id] = p.display_name));
  const map = {};
  entries.forEach((e) => (map[e.id] = {
    id: e.id, name: e.name, owner: owners[e.user_id] || "—", ownerId: e.user_id, gp: {}, ko: {},
  }));
  gp.forEach((r) => { if (map[r.entry_id]) map[r.entry_id].gp[r.match_id] = r.pick; });
  kp.forEach((r) => { if (map[r.entry_id]) { (map[r.entry_id].ko[r.round] ||= []).push(r.team); } });
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
