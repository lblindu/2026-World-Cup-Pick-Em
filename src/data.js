// ---- Real 2026 groups (draw of Dec 5, 2025) --------------------------------
export const GROUPS = [
  { id: "A", teams: [["Mexico", "mx"], ["South Africa", "za"], ["South Korea", "kr"], ["Czechia", "cz"]] },
  { id: "B", teams: [["Canada", "ca"], ["Bosnia & Herz.", "ba"], ["Qatar", "qa"], ["Switzerland", "ch"]] },
  { id: "C", teams: [["Brazil", "br"], ["Morocco", "ma"], ["Haiti", "ht"], ["Scotland", "gb-sct"]] },
  { id: "D", teams: [["United States", "us"], ["Paraguay", "py"], ["Australia", "au"], ["Türkiye", "tr"]] },
  { id: "E", teams: [["Germany", "de"], ["Curaçao", "cw"], ["Côte d'Ivoire", "ci"], ["Ecuador", "ec"]] },
  { id: "F", teams: [["Netherlands", "nl"], ["Japan", "jp"], ["Sweden", "se"], ["Tunisia", "tn"]] },
  { id: "G", teams: [["Belgium", "be"], ["Egypt", "eg"], ["Iran", "ir"], ["New Zealand", "nz"]] },
  { id: "H", teams: [["Spain", "es"], ["Cape Verde", "cv"], ["Saudi Arabia", "sa"], ["Uruguay", "uy"]] },
  { id: "I", teams: [["France", "fr"], ["Senegal", "sn"], ["Iraq", "iq"], ["Norway", "no"]] },
  { id: "J", teams: [["Argentina", "ar"], ["Algeria", "dz"], ["Austria", "at"], ["Jordan", "jo"]] },
  { id: "K", teams: [["Portugal", "pt"], ["DR Congo", "cd"], ["Uzbekistan", "uz"], ["Colombia", "co"]] },
  { id: "L", teams: [["England", "gb-eng"], ["Croatia", "hr"], ["Ghana", "gh"], ["Panama", "pa"]] },
];

export const FLAG = {};
export const TEAM_GROUP = {};
GROUPS.forEach((g) => g.teams.forEach(([n, f]) => { FLAG[n] = f; TEAM_GROUP[n] = g.id; }));

export const CODE = {
  "Mexico": "MEX", "South Africa": "RSA", "South Korea": "KOR", "Czechia": "CZE",
  "Canada": "CAN", "Bosnia & Herz.": "BIH", "Qatar": "QAT", "Switzerland": "SUI",
  "Brazil": "BRA", "Morocco": "MAR", "Haiti": "HAI", "Scotland": "SCO",
  "United States": "USA", "Paraguay": "PAR", "Australia": "AUS", "Türkiye": "TUR",
  "Germany": "GER", "Curaçao": "CUW", "Côte d'Ivoire": "CIV", "Ecuador": "ECU",
  "Netherlands": "NED", "Japan": "JPN", "Sweden": "SWE", "Tunisia": "TUN",
  "Belgium": "BEL", "Egypt": "EGY", "Iran": "IRN", "New Zealand": "NZL",
  "Spain": "ESP", "Cape Verde": "CPV", "Saudi Arabia": "KSA", "Uruguay": "URU",
  "France": "FRA", "Senegal": "SEN", "Iraq": "IRQ", "Norway": "NOR",
  "Argentina": "ARG", "Algeria": "ALG", "Austria": "AUT", "Jordan": "JOR",
  "Portugal": "POR", "DR Congo": "COD", "Uzbekistan": "UZB", "Colombia": "COL",
  "England": "ENG", "Croatia": "CRO", "Ghana": "GHA", "Panama": "PAN",
};

const PAIRS = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
export const MATCHES = GROUPS.flatMap((g) =>
  PAIRS.map(([i, j]) => ({ id: `${g.id}-${i}-${j}`, group: g.id, home: g.teams[i][0], away: g.teams[j][0] }))
);
export const TOTAL_MATCHES = MATCHES.length; // 72

// Each level = a round PLAYED; you pick the WINNERS who advance out of it.
export const KO = [
  { key: "ko32", label: "Group Stage", count: 32, pts: 1, from: "all", adv: "teams that advance out of the groups into the Round of 32" },
  { key: "ro16", label: "Round of 32", count: 16, pts: 2, from: "ko32", adv: "winners who advance to the Round of 16" },
  { key: "ro8", label: "Round of 16", count: 8, pts: 4, from: "ro16", adv: "winners who advance to the Quarterfinals" },
  { key: "ro4", label: "Quarterfinals", count: 4, pts: 8, from: "ro8", adv: "winners — your four semifinalists" },
  { key: "ro2", label: "Semifinals", count: 2, pts: 24, from: "ro4", adv: "winners — your two finalists" },
  { key: "third", label: "3rd-Place Game", count: 1, pts: 16, from: "thirdpool", adv: "winner — the two losing semifinalists play off" },
  { key: "champ", label: "Final", count: 1, pts: 32, from: "ro2", adv: "winner — your champion" },
];
export const KO_KEYS = KO.map((r) => r.key);
export const ALL_TEAMS = GROUPS.flatMap((g) => g.teams.map((t) => t[0]));

export function emptyKo() {
  return Object.fromEntries(KO.map((r) => [r.key, []]));
}

// candidate pool for a round = teams chosen in the previous round (of that picks object)
export function poolFor(ko, key) {
  const r = KO.find((x) => x.key === key);
  if (r.from === "all") return ALL_TEAMS;
  if (r.from === "thirdpool") return (ko.ro4 || []).filter((t) => !(ko.ro2 || []).includes(t));
  return ko[r.from] || [];
}

// keep every round consistent with its parent after any change (pure)
export function syncCascade(ko) {
  const k = { ...ko };
  k.ro16 = (k.ro16 || []).filter((t) => (k.ko32 || []).includes(t));
  k.ro8 = (k.ro8 || []).filter((t) => k.ro16.includes(t));
  k.ro4 = (k.ro4 || []).filter((t) => k.ro8.includes(t));
  k.ro2 = (k.ro2 || []).filter((t) => k.ro4.includes(t));
  k.champ = (k.champ || []).filter((t) => k.ro2.includes(t));
  const thirdPool = k.ro4.filter((t) => !k.ro2.includes(t));
  k.third = (k.third || []).filter((t) => thirdPool.includes(t));
  return k;
}

// ---- Scoring ---------------------------------------------------------------
// groupResults: { [matchId]: {h, a} }   (home/away goals)
// koResults:    { ko32:[], ro16:[], ro8:[], ro4:[], ro2:[], champ:[], third:[winner] }
export function matchWinner(match, score) {
  if (!score || score.h == null || score.a == null) return null;
  if (score.h > score.a) return "home";
  if (score.a > score.h) return "away";
  return "draw";
}

const inter = (a = [], b = []) => a.filter((x) => b.includes(x)).length;

// ---- Group standings & qualification ----------------------------------------
// Compute group standings from completed match results.
// Returns { [groupId]: [ { team, pts, gd, gf }, ...sorted ] }
export function groupStandings(groupResults = {}) {
  const st = {};
  GROUPS.forEach((g) => {
    st[g.id] = g.teams.map(([name]) => ({ team: name, pts: 0, gd: 0, gf: 0 }));
  });
  MATCHES.forEach((m) => {
    const s = groupResults[m.id];
    if (!s || s.h == null || s.a == null) return;
    const grp = st[m.group];
    const home = grp.find((r) => r.team === m.home);
    const away = grp.find((r) => r.team === m.away);
    home.gf += s.h; home.gd += s.h - s.a;
    away.gf += s.a; away.gd += s.a - s.h;
    if (s.h > s.a) { home.pts += 3; }
    else if (s.a > s.h) { away.pts += 3; }
    else { home.pts += 1; away.pts += 1; }
  });
  const cmp = (a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team);
  Object.values(st).forEach((g) => g.sort(cmp));
  return st;
}

// Derive the 32 qualified teams, cross-checking our standings computation
// against whatever R32 fixtures the API has already scheduled.
//
// Returns { qualified: Set<string>, provisional: boolean, mismatches: string[] }
//   qualified    — set of team names we consider qualified (API wins if available)
//   provisional  — true if group stage not fully complete (max calcs should show "~")
//   mismatches   — teams where our calc and the API disagree (for console warnings)
export function computeQualified(fixtures = [], groupResults = {}) {
  // --- Source A: teams named in R32 fixtures from api_fixtures ---
  const r32Fx = fixtures.filter((f) => f.round && f.round.toLowerCase().includes("round of 32"));
  let fromAPI = null;
  if (r32Fx.length >= 16) {
    fromAPI = new Set();
    r32Fx.forEach((f) => { if (f.home_team) fromAPI.add(f.home_team); if (f.away_team) fromAPI.add(f.away_team); });
  }

  // --- Source B: computed from group standings ---
  const totalMatches = MATCHES.length; // 72
  const playedMatches = MATCHES.filter((m) => {
    const s = groupResults[m.id];
    return s && s.h != null && s.a != null;
  }).length;
  const provisional = playedMatches < totalMatches;

  let fromCalc = null;
  if (!provisional) {
    const st = groupStandings(groupResults);
    const qualified = new Set();
    const thirds = [];
    GROUPS.forEach((g) => {
      const sorted = st[g.id];
      qualified.add(sorted[0].team);
      qualified.add(sorted[1].team);
      thirds.push({ ...sorted[2], group: g.id });
    });
    // Best 8 third-place teams (same tiebreaker: pts → gd → gf → name)
    thirds.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));
    thirds.slice(0, 8).forEach((t) => qualified.add(t.team));
    fromCalc = qualified;
  }

  // --- Cross-check when both sources exist ---
  const mismatches = [];
  if (fromAPI && fromCalc) {
    fromAPI.forEach((t) => { if (!fromCalc.has(t)) mismatches.push(`API has ${t}, calc does not`); });
    fromCalc.forEach((t) => { if (!fromAPI.has(t)) mismatches.push(`Calc has ${t}, API does not`); });
    if (mismatches.length) console.warn("[computeQualified] mismatch:", mismatches);
  }

  const qualified = fromAPI || fromCalc || null;
  return { qualified, provisional: provisional && !fromAPI, mismatches };
}

// KO round sizes (must match KO_ROUNDS in App.jsx).
const KO_ROUND_SIZES = { ko32: 32, ro16: 16, ro8: 8, ro4: 4, ro2: 2, champ: 1 };
const KO_ROUND_KEYS_ORDERED = ["ko32", "ro16", "ro8", "ro4", "ro2", "champ"];

// Map API round string to the koResults dest key (same logic as sync-live).
function _koDestKey(round) {
  if (!round) return null;
  const r = round.toLowerCase();
  if (r.includes("round of 32") || r.includes("1/16")) return "ro16";
  if (r.includes("round of 16") || r.includes("1/8"))  return "ro8";
  if (r.includes("quarter"))                            return "ro4";
  if (r.includes("semi"))                               return "ro2";
  if (r.includes("3rd") || r.includes("third"))        return "third";
  if (r.includes("final"))                              return "champ";
  return null;
}

// ---- Max points -------------------------------------------------------------
// Max points an entry can still achieve given current tournament state.
// fixtures: api_fixtures rows (used to determine which teams are eliminated mid-round)
// qualifiedSet: Set of qualified teams (null = treat all as alive, provisional)
// Returns same shape as scoreBreakdown: { GR, R32, R16, QF, SF, TH, FN, total }
export function maxBreakdown(gp = {}, ko = {}, koResults = {}, qualifiedSet = null, groupResults = {}, fixtures = []) {
  // Source round = deepest round with its full expected quota of teams.
  // e.g. during R32 with only 1 ro16 team, source stays ko32 (not ro16).
  let sourceKey = null;
  for (const key of KO_ROUND_KEYS_ORDERED) {
    if ((koResults[key] || []).length >= KO_ROUND_SIZES[key]) sourceKey = key;
  }

  // Teams eliminated from completed KO fixtures (their opponent advanced, they didn't).
  const eliminatedSet = new Set();
  fixtures.forEach((f) => {
    if (!f.is_final || f.grp) return;
    const dest = _koDestKey(f.round);
    if (!dest) return;
    const winners = new Set(koResults[dest] || []);
    if (f.home_team && !winners.has(f.home_team)) eliminatedSet.add(f.home_team);
    if (f.away_team && !winners.has(f.away_team)) eliminatedSet.add(f.away_team);
  });

  // aliveSet = source round teams minus eliminated; fall back to qualifiedSet pre-KO.
  const sourceTeams = sourceKey ? new Set((koResults[sourceKey] || []).filter(t => !eliminatedSet.has(t))) : null;

  const alive = (team) => {
    if (sourceTeams) return sourceTeams.has(team);
    if (qualifiedSet) return qualifiedSet.has(team);
    return true;
  };

  // GR: remaining unplayed matches where the entry made a pick
  let GR = 0;
  MATCHES.forEach((m) => {
    if (gp[m.id] && !(groupResults[m.id] && groupResults[m.id].h != null)) GR += 1;
  });

  const R32 = (ko.ko32 || []).filter(alive).length * 1;
  const R16 = (ko.ro16 || []).filter(alive).length * 2;
  const QF  = (ko.ro8  || []).filter(alive).length * 4;
  const SF  = (ko.ro4  || []).filter(alive).length * 8;
  const finalistAlive = (ko.ro2   || []).filter(alive).length;
  const champAlive    = (ko.champ || []).filter(alive).length;
  const FN = finalistAlive * 24 + champAlive * 32;
  const predPart = (ko.ro4 || []).filter((t) => !(ko.ro2 || []).includes(t));
  const TH = predPart.filter(alive).length * 12 + (ko.third || []).filter(alive).length * 16;

  return { GR, R32, R16, QF, SF, TH, FN, total: GR + R32 + R16 + QF + SF + TH + FN };
}

// returns { GR, R32, R16, QF, SF, TH, FN, total }
export function scoreBreakdown(gp = {}, ko = {}, groupResults = {}, koResults = {}) {
  let GR = 0;
  MATCHES.forEach((m) => {
    const w = matchWinner(m, groupResults[m.id]);
    if (w && gp[m.id] === w) GR += 1;
  });
  const R32 = inter(ko.ko32, koResults.ko32) * 1;
  const R16 = inter(ko.ro16, koResults.ro16) * 2;
  const QF = inter(ko.ro8, koResults.ro8) * 4;
  const SF = inter(ko.ro4, koResults.ro4) * 8;
  const finalists = inter(ko.ro2, koResults.ro2) * 24;
  const champOk = (ko.champ?.[0] && ko.champ[0] === koResults.champ?.[0]) ? 32 : 0;
  const FN = finalists + champOk;
  // third-place participants = semifinalists (ro4) not in final (ro2).
  // Only known once both SF games are done (ro2 has 2 finalists) — guard to avoid
  // awarding 12 pts prematurely when ro2 is empty and all SF teams look like "participants".
  const predPart = (ko.ro4 || []).filter((t) => !(ko.ro2 || []).includes(t));
  const actPart = (koResults.ro2 || []).length >= 2
    ? (koResults.ro4 || []).filter((t) => !(koResults.ro2 || []).includes(t))
    : [];
  const thirdWinnerOk = (ko.third?.[0] && ko.third[0] === koResults.third?.[0]) ? 16 : 0;
  const TH = inter(predPart, actPart) * 12 + thirdWinnerOk;
  return { GR, R32, R16, QF, SF, TH, FN, total: GR + R32 + R16 + QF + SF + TH + FN };
}

// total goals per team across recorded group matches (top-scoring-team tiebreaker)
export function teamGoals(groupResults = {}) {
  const g = {};
  MATCHES.forEach((m) => {
    const s = groupResults[m.id];
    if (!s || s.h == null || s.a == null) return;
    g[m.home] = (g[m.home] || 0) + s.h;
    g[m.away] = (g[m.away] || 0) + s.a;
  });
  return g;
}

export const esc = (s) => String(s);
export const flag = (t) => FLAG[t] || "";

// ---- Schedule data & helpers -------------------------------------------
const _S2A = { "Curacao":"Curaçao","Turkiye":"Türkiye","Congo DR":"DR Congo","Bosnia-Herzegovina":"Bosnia & Herz.","Ivory Coast":"Côte d'Ivoire" };

export const TEAM_CODE = {
  "Algeria":"ALG","Argentina":"ARG","Australia":"AUS","Austria":"AUT","Belgium":"BEL",
  "Bosnia & Herz.":"BIH","Brazil":"BRA","Canada":"CAN","Cape Verde":"CPV","Colombia":"COL",
  "DR Congo":"COD","Croatia":"CRO","Curaçao":"CUW","Czechia":"CZE","Ecuador":"ECU",
  "Egypt":"EGY","England":"ENG","France":"FRA","Germany":"GER","Ghana":"GHA","Haiti":"HAI",
  "Iran":"IRN","Iraq":"IRQ","Côte d'Ivoire":"CIV","Japan":"JPN","Jordan":"JOR","Mexico":"MEX",
  "Morocco":"MAR","Netherlands":"NED","New Zealand":"NZL","Norway":"NOR","Panama":"PAN",
  "Paraguay":"PAR","Portugal":"POR","Qatar":"QAT","Saudi Arabia":"KSA","Scotland":"SCO",
  "Senegal":"SEN","South Africa":"RSA","South Korea":"KOR","Spain":"ESP","Sweden":"SWE",
  "Switzerland":"SUI","Tunisia":"TUN","Türkiye":"TUR","United States":"USA","Uruguay":"URU",
  "Uzbekistan":"UZB",
};

// Full 72-match group schedule. dt = local-naive US Eastern ISO string.
export const SCHEDULE = (() => {
  const raw = [
    {g:"A",num:1, dt:"2026-06-11T15:00",home:"Mexico",        away:"South Africa",       md:1,loc:"Estadio Azteca, Mexico City"},
    {g:"A",num:2, dt:"2026-06-11T22:00",home:"South Korea",   away:"Czechia",            md:1,loc:"Estadio Akron, Zapopan"},
    {g:"B",num:3, dt:"2026-06-12T15:00",home:"Canada",        away:"Bosnia-Herzegovina", md:1,loc:"BMO Field, Toronto"},
    {g:"D",num:4, dt:"2026-06-12T21:00",home:"United States", away:"Paraguay",           md:1,loc:"SoFi Stadium, Inglewood"},
    {g:"B",num:5, dt:"2026-06-13T15:00",home:"Qatar",         away:"Switzerland",        md:1,loc:"Levi's Stadium, Santa Clara"},
    {g:"C",num:6, dt:"2026-06-13T18:00",home:"Brazil",        away:"Morocco",            md:1,loc:"MetLife Stadium, East Rutherford"},
    {g:"C",num:7, dt:"2026-06-13T21:00",home:"Haiti",         away:"Scotland",           md:1,loc:"Gillette Stadium, Foxborough"},
    {g:"D",num:8, dt:"2026-06-13T23:59",home:"Australia",     away:"Turkiye",            md:1,loc:"BC Place, Vancouver"},
    {g:"E",num:9, dt:"2026-06-14T13:00",home:"Germany",       away:"Curacao",            md:1,loc:"NRG Stadium, Houston"},
    {g:"F",num:10,dt:"2026-06-14T16:00",home:"Netherlands",   away:"Japan",              md:1,loc:"AT&T Stadium, Arlington"},
    {g:"E",num:11,dt:"2026-06-14T19:00",home:"Ivory Coast",   away:"Ecuador",            md:1,loc:"Lincoln Financial Field, Philadelphia"},
    {g:"F",num:12,dt:"2026-06-14T22:00",home:"Sweden",        away:"Tunisia",            md:1,loc:"Estadio BBVA, Guadalupe"},
    {g:"H",num:13,dt:"2026-06-15T12:00",home:"Spain",         away:"Cape Verde",         md:1,loc:"Mercedes-Benz Stadium, Atlanta"},
    {g:"G",num:14,dt:"2026-06-15T15:00",home:"Belgium",       away:"Egypt",              md:1,loc:"Lumen Field, Seattle"},
    {g:"H",num:15,dt:"2026-06-15T18:00",home:"Saudi Arabia",  away:"Uruguay",            md:1,loc:"Hard Rock Stadium, Miami Gardens"},
    {g:"G",num:16,dt:"2026-06-15T21:00",home:"Iran",          away:"New Zealand",        md:1,loc:"SoFi Stadium, Inglewood"},
    {g:"I",num:17,dt:"2026-06-16T15:00",home:"France",        away:"Senegal",            md:1,loc:"MetLife Stadium, East Rutherford"},
    {g:"I",num:18,dt:"2026-06-16T18:00",home:"Iraq",          away:"Norway",             md:1,loc:"Gillette Stadium, Foxborough"},
    {g:"J",num:19,dt:"2026-06-16T21:00",home:"Argentina",     away:"Algeria",            md:1,loc:"Arrowhead Stadium, Kansas City"},
    {g:"J",num:20,dt:"2026-06-16T23:59",home:"Austria",       away:"Jordan",             md:1,loc:"Levi's Stadium, Santa Clara"},
    {g:"K",num:21,dt:"2026-06-17T13:00",home:"Portugal",      away:"Congo DR",           md:1,loc:"NRG Stadium, Houston"},
    {g:"L",num:22,dt:"2026-06-17T16:00",home:"England",       away:"Croatia",            md:1,loc:"AT&T Stadium, Arlington"},
    {g:"L",num:23,dt:"2026-06-17T19:00",home:"Ghana",         away:"Panama",             md:1,loc:"BMO Field, Toronto"},
    {g:"K",num:24,dt:"2026-06-17T22:00",home:"Uzbekistan",    away:"Colombia",           md:1,loc:"Estadio Azteca, Mexico City"},
    {g:"A",num:25,dt:"2026-06-18T12:00",home:"Czechia",       away:"South Africa",       md:2,loc:"Mercedes-Benz Stadium, Atlanta"},
    {g:"B",num:26,dt:"2026-06-18T15:00",home:"Switzerland",   away:"Bosnia-Herzegovina", md:2,loc:"SoFi Stadium, Inglewood"},
    {g:"B",num:27,dt:"2026-06-18T18:00",home:"Canada",        away:"Qatar",              md:2,loc:"BC Place, Vancouver"},
    {g:"A",num:28,dt:"2026-06-18T21:00",home:"Mexico",        away:"South Korea",        md:2,loc:"Estadio Akron, Zapopan"},
    {g:"D",num:29,dt:"2026-06-19T15:00",home:"United States", away:"Australia",          md:2,loc:"Lumen Field, Seattle"},
    {g:"C",num:30,dt:"2026-06-19T18:00",home:"Scotland",      away:"Morocco",            md:2,loc:"Gillette Stadium, Foxborough"},
    {g:"C",num:31,dt:"2026-06-19T21:00",home:"Brazil",        away:"Haiti",              md:2,loc:"Lincoln Financial Field, Philadelphia"},
    {g:"D",num:32,dt:"2026-06-19T23:59",home:"Turkiye",       away:"Paraguay",           md:2,loc:"Levi's Stadium, Santa Clara"},
    {g:"F",num:33,dt:"2026-06-20T13:00",home:"Netherlands",   away:"Sweden",             md:2,loc:"NRG Stadium, Houston"},
    {g:"E",num:34,dt:"2026-06-20T16:00",home:"Germany",       away:"Ivory Coast",        md:2,loc:"BMO Field, Toronto"},
    {g:"E",num:35,dt:"2026-06-20T20:00",home:"Ecuador",       away:"Curacao",            md:2,loc:"Arrowhead Stadium, Kansas City"},
    {g:"F",num:36,dt:"2026-06-20T23:59",home:"Tunisia",       away:"Japan",              md:2,loc:"Estadio BBVA, Guadalupe"},
    {g:"H",num:37,dt:"2026-06-21T12:00",home:"Spain",         away:"Saudi Arabia",       md:2,loc:"Mercedes-Benz Stadium, Atlanta"},
    {g:"G",num:38,dt:"2026-06-21T15:00",home:"Belgium",       away:"Iran",               md:2,loc:"SoFi Stadium, Inglewood"},
    {g:"H",num:39,dt:"2026-06-21T18:00",home:"Uruguay",       away:"Cape Verde",         md:2,loc:"Hard Rock Stadium, Miami Gardens"},
    {g:"G",num:40,dt:"2026-06-21T21:00",home:"New Zealand",   away:"Egypt",              md:2,loc:"BC Place, Vancouver"},
    {g:"J",num:41,dt:"2026-06-22T13:00",home:"Argentina",     away:"Austria",            md:2,loc:"AT&T Stadium, Arlington"},
    {g:"I",num:42,dt:"2026-06-22T17:00",home:"France",        away:"Iraq",               md:2,loc:"Lincoln Financial Field, Philadelphia"},
    {g:"I",num:43,dt:"2026-06-22T20:00",home:"Norway",        away:"Senegal",            md:2,loc:"MetLife Stadium, East Rutherford"},
    {g:"J",num:44,dt:"2026-06-22T23:00",home:"Jordan",        away:"Algeria",            md:2,loc:"Levi's Stadium, Santa Clara"},
    {g:"K",num:45,dt:"2026-06-23T13:00",home:"Portugal",      away:"Uzbekistan",         md:2,loc:"NRG Stadium, Houston"},
    {g:"L",num:46,dt:"2026-06-23T16:00",home:"England",       away:"Ghana",              md:2,loc:"Gillette Stadium, Foxborough"},
    {g:"L",num:47,dt:"2026-06-23T19:00",home:"Panama",        away:"Croatia",            md:2,loc:"BMO Field, Toronto"},
    {g:"K",num:48,dt:"2026-06-23T22:00",home:"Colombia",      away:"Congo DR",           md:2,loc:"Estadio Akron, Zapopan"},
    {g:"B",num:49,dt:"2026-06-24T15:00",home:"Bosnia-Herzegovina",away:"Qatar",          md:3,loc:"Lumen Field, Seattle"},
    {g:"B",num:50,dt:"2026-06-24T15:00",home:"Switzerland",   away:"Canada",             md:3,loc:"BC Place, Vancouver"},
    {g:"C",num:51,dt:"2026-06-24T18:00",home:"Morocco",       away:"Haiti",              md:3,loc:"Mercedes-Benz Stadium, Atlanta"},
    {g:"C",num:52,dt:"2026-06-24T18:00",home:"Scotland",      away:"Brazil",             md:3,loc:"Hard Rock Stadium, Miami Gardens"},
    {g:"A",num:53,dt:"2026-06-24T21:00",home:"Czechia",       away:"Mexico",             md:3,loc:"Estadio Azteca, Mexico City"},
    {g:"A",num:54,dt:"2026-06-24T21:00",home:"South Africa",  away:"South Korea",        md:3,loc:"Estadio BBVA, Guadalupe"},
    {g:"E",num:55,dt:"2026-06-25T16:00",home:"Curacao",       away:"Ivory Coast",        md:3,loc:"Lincoln Financial Field, Philadelphia"},
    {g:"E",num:56,dt:"2026-06-25T16:00",home:"Ecuador",       away:"Germany",            md:3,loc:"MetLife Stadium, East Rutherford"},
    {g:"F",num:57,dt:"2026-06-25T19:00",home:"Japan",         away:"Sweden",             md:3,loc:"AT&T Stadium, Arlington"},
    {g:"F",num:58,dt:"2026-06-25T19:00",home:"Tunisia",       away:"Netherlands",        md:3,loc:"Arrowhead Stadium, Kansas City"},
    {g:"D",num:59,dt:"2026-06-25T22:00",home:"Paraguay",      away:"Australia",          md:3,loc:"Levi's Stadium, Santa Clara"},
    {g:"D",num:60,dt:"2026-06-25T22:00",home:"Turkiye",       away:"United States",      md:3,loc:"SoFi Stadium, Inglewood"},
    {g:"I",num:61,dt:"2026-06-26T15:00",home:"Norway",        away:"France",             md:3,loc:"Gillette Stadium, Foxborough"},
    {g:"I",num:62,dt:"2026-06-26T15:00",home:"Senegal",       away:"Iraq",               md:3,loc:"BMO Field, Toronto"},
    {g:"H",num:63,dt:"2026-06-26T20:00",home:"Cape Verde",    away:"Saudi Arabia",       md:3,loc:"NRG Stadium, Houston"},
    {g:"H",num:64,dt:"2026-06-26T20:00",home:"Uruguay",       away:"Spain",              md:3,loc:"Estadio Akron, Zapopan"},
    {g:"G",num:65,dt:"2026-06-26T23:00",home:"Egypt",         away:"Iran",               md:3,loc:"Lumen Field, Seattle"},
    {g:"G",num:66,dt:"2026-06-26T23:00",home:"New Zealand",   away:"Belgium",            md:3,loc:"BC Place, Vancouver"},
    {g:"L",num:67,dt:"2026-06-27T17:00",home:"Croatia",       away:"Ghana",              md:3,loc:"Lincoln Financial Field, Philadelphia"},
    {g:"L",num:68,dt:"2026-06-27T17:00",home:"Panama",        away:"England",            md:3,loc:"MetLife Stadium, East Rutherford"},
    {g:"K",num:69,dt:"2026-06-27T19:30",home:"Colombia",      away:"Portugal",           md:3,loc:"Hard Rock Stadium, Miami Gardens"},
    {g:"K",num:70,dt:"2026-06-27T19:30",home:"Congo DR",      away:"Uzbekistan",         md:3,loc:"Mercedes-Benz Stadium, Atlanta"},
    {g:"J",num:71,dt:"2026-06-27T22:00",home:"Algeria",       away:"Austria",            md:3,loc:"Arrowhead Stadium, Kansas City"},
    {g:"J",num:72,dt:"2026-06-27T22:00",home:"Jordan",        away:"Argentina",          md:3,loc:"AT&T Stadium, Arlington"},
  ];
  return raw.map(m => {
    const home = _S2A[m.home] || m.home, away = _S2A[m.away] || m.away;
    const g = GROUPS.find(x => x.id === m.g);
    const hi = g.teams.findIndex(t => t[0] === home);
    const ai = g.teams.findIndex(t => t[0] === away);
    const lo = Math.min(hi, ai), hi2 = Math.max(hi, ai);
    return {
      g: m.g, num: m.num, dt: m.dt, md: m.md,
      home, away,                       // tournament home / away (for display)
      matchHome: g.teams[lo][0],        // lower-idx team = "home" in match_id / group_predictions
      matchAway: g.teams[hi2][0],       // higher-idx team = "away" in match_id
      matchId: `${m.g}-${lo}-${hi2}`,
      sf: hi > ai,                      // scoreFlipped: tournament home is match_id "away"
    };
  });
})();
