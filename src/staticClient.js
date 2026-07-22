/**
 * Static data client — used when building the offline archive (VITE_STATIC=true).
 * Reads from public/static-data.json (fetched at runtime, so the JSON stays
 * separate from the JS bundle and the file remains human-readable).
 *
 * Exports the same async function signatures as supabaseClient.js so App.jsx
 * needs no changes — the vite.config alias swaps this in at build time.
 */

let _cache = null;

async function _load() {
  if (_cache) return _cache;
  const r = await fetch("/static-data.json");
  _cache = await r.json();
  return _cache;
}

// ---- Data shape helpers ------------------------------------------------
function _groupResults(d) {
  const out = {};
  (d.groupResults?.flat?.() ?? d.groupResults ?? []).forEach
    ? (d.groupResults ?? []).forEach(r => (out[r.match_id] = { h: r.home_goals, a: r.away_goals }))
    : Object.assign(out, d.groupResults);
  return out;
}

function _koResults(d) {
  const out = {};
  (d.knockoutResults ?? []).forEach(r => {
    (out[r.round] ||= []).push(r.team);
  });
  return out;
}

// ---- Public API --------------------------------------------------------

export const isConfigured = true;
export const MAX_ENTRIES = 3;
export const supabase = null;

// Auth — no-ops in static mode; user is always "guest"
export const signUp    = async () => ({});
export const signIn    = async () => ({});
export const signOut   = async () => {};
export const sendPasswordReset = async () => {};
export const updatePassword    = async () => {};
export async function ensureProfile() { return "Guest"; }
export async function isAdmin()       { return false; }
export async function getLockAt()     { return null; }

// Entries — return empty (no personal picks in read-only mode)
export async function loadMyEntries() { return []; }
export async function createEntry()   { throw new Error("read-only"); }
export async function renameEntry()   {}
export async function deleteEntry()   {}
export async function loadEntryPicks() { return { gp: {}, ko: {}, tb: {} }; }
export async function saveGroupPicks()    {}
export async function saveKnockoutPicks() {}
export async function saveTiebreakers()   {}

// Core data reads
export async function loadEveryone() {
  const d = await _load();
  const owners = {};
  (d.profiles ?? []).forEach(p => (owners[p.id] = p.display_name));
  const map = {};
  (d.entries ?? []).forEach(e => (map[e.id] = {
    id: e.id, name: e.name, owner: owners[e.user_id] || "—", ownerId: e.user_id, gp: {}, ko: {}, tb: {},
  }));
  (d.groupPredictions ?? []).forEach(r => { if (map[r.entry_id]) map[r.entry_id].gp[r.match_id] = r.pick; });
  (d.knockoutPredictions ?? []).forEach(r => { if (map[r.entry_id]) (map[r.entry_id].ko[r.round] ||= []).push(r.team); });
  (d.tiebreakers ?? []).forEach(r => { if (map[r.entry_id]) map[r.entry_id].tb = r; });
  return Object.values(map);
}

export async function loadResults() {
  const d = await _load();
  const groupResults = {};
  (d.groupResults ?? []).forEach(r => (groupResults[r.match_id] = { h: r.home_goals, a: r.away_goals }));
  const koResults = {};
  (d.knockoutResults ?? []).forEach(r => (koResults[r.round] ||= []).push(r.team));
  return { groupResults, koResults };
}

export async function loadFixtures() {
  const d = await _load();
  return d.fixtures ?? [];
}

export async function loadTopScorers() {
  const d = await _load();
  return d.topScorers ?? [];
}

export async function loadStandings() {
  const d = await _load();
  return d.standings ?? [];
}

// Admin writes — no-ops in static mode
export async function saveGroupResult()    {}
export async function saveKnockoutResults() {}
export async function loadSyncHealth()     { return { sync: null, unmapped: [] }; }
export async function setPollerPaused()    {}
