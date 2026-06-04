// ---- Real 2026 groups (draw of Dec 5, 2025) --------------------------------
export const GROUPS = [
  { id: "A", teams: [["Mexico", "🇲🇽"], ["South Africa", "🇿🇦"], ["South Korea", "🇰🇷"], ["Czechia", "🇨🇿"]] },
  { id: "B", teams: [["Canada", "🇨🇦"], ["Bosnia & Herz.", "🇧🇦"], ["Qatar", "🇶🇦"], ["Switzerland", "🇨🇭"]] },
  { id: "C", teams: [["Brazil", "🇧🇷"], ["Morocco", "🇲🇦"], ["Haiti", "🇭🇹"], ["Scotland", "🏴󠁧󠁢󠁳󠁣󠁴󠁿"]] },
  { id: "D", teams: [["United States", "🇺🇸"], ["Paraguay", "🇵🇾"], ["Australia", "🇦🇺"], ["Türkiye", "🇹🇷"]] },
  { id: "E", teams: [["Germany", "🇩🇪"], ["Curaçao", "🇨🇼"], ["Côte d'Ivoire", "🇨🇮"], ["Ecuador", "🇪🇨"]] },
  { id: "F", teams: [["Netherlands", "🇳🇱"], ["Japan", "🇯🇵"], ["Sweden", "🇸🇪"], ["Tunisia", "🇹🇳"]] },
  { id: "G", teams: [["Belgium", "🇧🇪"], ["Egypt", "🇪🇬"], ["Iran", "🇮🇷"], ["New Zealand", "🇳🇿"]] },
  { id: "H", teams: [["Spain", "🇪🇸"], ["Cape Verde", "🇨🇻"], ["Saudi Arabia", "🇸🇦"], ["Uruguay", "🇺🇾"]] },
  { id: "I", teams: [["France", "🇫🇷"], ["Senegal", "🇸🇳"], ["Iraq", "🇮🇶"], ["Norway", "🇳🇴"]] },
  { id: "J", teams: [["Argentina", "🇦🇷"], ["Algeria", "🇩🇿"], ["Austria", "🇦🇹"], ["Jordan", "🇯🇴"]] },
  { id: "K", teams: [["Portugal", "🇵🇹"], ["DR Congo", "🇨🇩"], ["Uzbekistan", "🇺🇿"], ["Colombia", "🇨🇴"]] },
  { id: "L", teams: [["England", "🏴󠁧󠁢󠁥󠁮󠁧󠁿"], ["Croatia", "🇭🇷"], ["Ghana", "🇬🇭"], ["Panama", "🇵🇦"]] },
];

export const FLAG = {};
GROUPS.forEach((g) => g.teams.forEach(([n, f]) => (FLAG[n] = f)));

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
  // third-place participants = semifinalists (ro4) not in final (ro2)
  const predPart = (ko.ro4 || []).filter((t) => !(ko.ro2 || []).includes(t));
  const actPart = (koResults.ro4 || []).filter((t) => !(koResults.ro2 || []).includes(t));
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
