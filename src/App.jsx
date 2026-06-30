import React, { useEffect, useState, useRef } from "react";
import {
  GROUPS, MATCHES, TOTAL_MATCHES, KO, ALL_TEAMS,
  FLAG, TEAM_GROUP, TEAM_CODE, SCHEDULE, poolFor, syncCascade, scoreBreakdown, maxBreakdown, computeQualified, teamGoals, matchWinner, emptyKo,
} from "./data.js";
import {
  isConfigured, supabase, MAX_ENTRIES, signUp, signIn, signOut, sendPasswordReset, updatePassword, ensureProfile, isAdmin,
  getLockAt, loadMyEntries, createEntry, deleteEntry, loadEntryPicks,
  saveGroupPicks, saveKnockoutPicks, saveTiebreakers,
  loadEveryone, loadResults, saveGroupResult, saveKnockoutResults,
  loadSyncHealth, setPollerPaused, loadFixtures, loadStandings, loadTopScorers,
} from "./supabaseClient.js";

const Fl = ({ t }) => FLAG[t] ? <span className={`fl fi fi-${FLAG[t]}`}></span> : null;

function toggleKo(ko, round, team) {
  const r = KO.find((x) => x.key === round);
  const cur = ko[round] || [];
  let next;
  if (cur.includes(team)) next = cur.filter((t) => t !== team);
  else if (r.count === 1) next = [team];
  else if (cur.length < r.count) next = [...cur, team];
  else return ko;
  return syncCascade({ ...ko, [round]: next });
}
function fmtCountdown(ms) {
  if (ms <= 0) return "LOCKED";
  const d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24,
    m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}
// "14s ago" / "3m ago" / "2h ago" — for Admin sync-health timestamps
function relTime(iso) {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 0) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Detect a password-recovery link (captured synchronously before Supabase clears the URL hash)
const isRecoveryUrl =
  typeof window !== "undefined" && window.location.hash.includes("type=recovery");

// ---------------------------------------------------------------- Reset password
function ResetPassword({ onDone }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (pw.length < 6) { setMsg("Use at least 6 characters."); return; }
    if (pw !== pw2) { setMsg("Those two passwords don't match."); return; }
    setBusy(true); setMsg("");
    try {
      const { error } = await updatePassword(pw);
      if (error) { setMsg(error.message); setBusy(false); return; }
      if (window.history.replaceState) window.history.replaceState(null, "", window.location.pathname);
      onDone();
    } catch (e) { setMsg(e.message); setBusy(false); }
  }
  return (
    <div className="auth">
      <div className="pitch-deco" />
      <h1 className="wordmark" style={{ fontSize: 40 }}>Set a new<br /><span>password</span></h1>
      <div className="uline" />
      <p className="sub">Pick a new password for your account — you'll be signed in right after.</p>
      <input className="field" type="password" placeholder="New password" value={pw}
        onChange={(e) => setPw(e.target.value)} />
      <input className="field" type="password" placeholder="Confirm new password" value={pw2}
        onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
      <button className="btn full" disabled={busy} onClick={save}>{busy ? "…" : "Save new password"}</button>
      {msg && <p className="note" style={{ marginTop: 12, color: "var(--red)" }}>{msg}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- Auth screen
function AuthScreen() {
  const [mode, setMode] = useState("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setMsg("");
    try {
      if (mode === "up") {
        if (!name.trim()) { setMsg("Enter your name."); setBusy(false); return; }
        const { error } = await signUp(email.trim(), pw, name.trim());
        setMsg(error ? error.message : "Account created — you can sign in now.");
        if (!error) setMode("in");
      } else {
        const { error } = await signIn(email.trim(), pw);
        if (error) setMsg(error.message);
      }
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  }
  async function forgot() {
    if (!email.trim()) { setMsg("Type your email above first, then tap this."); return; }
    setBusy(true); setMsg("");
    try {
      const { error } = await sendPasswordReset(email.trim());
      setMsg(error ? error.message : "Sent! Check your email for a reset link.");
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  }
  return (
    <div className="auth">
      <div className="pitch-deco" />
      <div className="kicker">🇺🇸 🇲🇽 🇨🇦 &nbsp;Summer 2026</div>
      <h1 className="wordmark">World Cup<br /><span>Pick'Em</span></h1>
      <div className="uline" />
      <p className="sub">Call every group match, predict who survives each knockout round, and battle your friends on one shared leaderboard.</p>
      {mode === "up" && <input className="field" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />}
      <input className="field" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="field" type="password" placeholder="Password" value={pw}
        onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
      <button className="btn full" disabled={busy} onClick={go}>{busy ? "…" : mode === "up" ? "Create account" : "Sign in"}</button>
      {mode === "in" && (
        <p className="note" style={{ marginTop: 10, textAlign: "center" }}>
          <a style={{ color: "var(--blue)", cursor: "pointer", fontWeight: 700 }} onClick={forgot}>Forgot password?</a>
        </p>
      )}
      <p className="note" style={{ marginTop: 14 }}>
        {mode === "up" ? "Already have an account? " : "New here? "}
        <a style={{ color: "var(--blue)", cursor: "pointer", fontWeight: 700 }}
          onClick={() => { setMode(mode === "up" ? "in" : "up"); setMsg(""); }}>{mode === "up" ? "Sign in" : "Create one"}</a>
      </p>
    </div>
  );
}

function LockBar({ lockAt, now }) {
  const locked = lockAt && now >= lockAt.getTime();
  const cd = lockAt ? fmtCountdown(lockAt.getTime() - now) : "—";
  return (
    <div className={`lockbar ${locked ? "locked" : ""}`}>
      <span className="ico">{locked ? "🔒" : "⏳"}</span>
      <span className="txt">{locked
        ? <><b>Picks are locked.</b> The tournament is underway — head to Everyone&rsquo;s Picks.</>
        : <><b>Picks lock at kickoff:</b> Mexico v South Africa · Thu Jun 11, 3:00&nbsp;PM ET</>}</span>
      <span className="cd">{cd}</span>
    </div>
  );
}

// ---------------------------------------------------------------- Entry bar
function EntryBar({ entries, activeId, setActive, onCreate, onDelete, locked }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const canAdd = entries.length < MAX_ENTRIES && !locked;
  function submit() { const n = name.trim(); if (!n) return; onCreate(n); setName(""); setAdding(false); }
  return (
    <div className="entrybar">
      <span className="eb-label">Your entries</span>
      {entries.map((e) => (
        <span key={e.id} className={`echip ${e.id === activeId ? "on" : ""}`} onClick={() => setActive(e.id)}>
          {e.name}
          {e.id === activeId && !locked && entries.length > 1 && (
            <span className="del" title="Delete entry"
              onClick={(ev) => { ev.stopPropagation(); if (confirm(`Delete entry "${e.name}"? This removes its picks.`)) onDelete(e.id); }}>✕</span>
          )}
        </span>
      ))}
      {adding ? (
        <span className="eb-input">
          <input autoFocus placeholder="Entry name" value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} />
          <button className="eb-new" onClick={submit}>Add</button>
        </span>
      ) : canAdd ? (
        <button className="eb-new" onClick={() => setAdding(true)}>+ New entry</button>
      ) : !locked ? (
        <span className="eb-label">max {MAX_ENTRIES}</span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- Group picks
function GroupStage({ gp, onPick, locked }) {
  const done = Object.keys(gp).length;
  return (
    <div className="fade">
      <div className="head"><div className="h1">Group Stage</div>
        <div className="pill">{done}/{TOTAL_MATCHES} picked · 1 pt each</div></div>
      <div className="prog"><i style={{ width: `${(done / TOTAL_MATCHES) * 100}%` }} /></div>
      {GROUPS.map((g) => (
        <div className="grp" key={g.id}>
          <div className="grp-h"><div className="grp-badge">{g.id}</div>
            <div className="teams">{g.teams.map((t) => t[1] + " " + t[0]).join("  ·  ")}</div></div>
          {MATCHES.filter((m) => m.group === g.id).map((m) => {
            const s = gp[m.id];
            const B = (side, label, fl) => (
              <button className={`opt ${side === "draw" ? "draw" : ""} ${s === side ? "sel" : ""}`}
                disabled={locked} onClick={() => onPick(m.id, side)}>{fl && <Fl t={fl} />}<span className="nm">{label}</span></button>
            );
            return (<div className="match" key={m.id}><div className="opt-row">
              {B("home", m.home, m.home)}{B("draw", "DRAW")}{B("away", m.away, m.away)}</div></div>);
          })}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------- Knockout board (picks/admin)
function KnockoutBoard({ ko, onToggle, round, setRound, locked, tb, setTb, mode }) {
  const r = KO.find((x) => x.key === round);
  const pool = poolFor(ko, round);
  const sel = ko[round] || [];
  const pl = { ko32: "all 48 teams", ro16: "your 32 qualifiers", ro8: "your 16 Round-of-32 winners",
    ro4: "your 8 Round-of-16 winners", ro2: "your 4 semifinalists", champ: "your 2 finalists" };
  let pnote;
  if (round === "ko32") pnote = "Pick the 32 teams that advance out of the groups into the Round of 32.";
  else if (round === "third") pnote = "Pick who wins the 3rd-Place Game — played between your two losing semifinalists.";
  else if (round === "champ") pnote = "Pick the Final winner — your champion. Choosing from your 2 finalists.";
  else pnote = `Pick the ${r.count} ${r.label} ${r.adv}. Choosing from ${pl[round] || "the previous round"}.`;
  const thirdReady = (ko.ro4 || []).length === 4 && (ko.ro2 || []).length === 2;
  return (
    <div className="fade">
      <div className="head"><div className="h1">{mode === "admin" ? "Knockout Results" : "Knockouts"}</div>
        <div className="pill">{mode === "admin" ? "Who advanced" : "Pick who survives"}</div></div>
      <div className="ko-rounds">{KO.map((x) => { const n = (ko[x.key] || []).length;
        return (<button key={x.key} className={`rbtn ${round === x.key ? "on" : ""} ${n === x.count ? "done" : ""}`}
          onClick={() => setRound(x.key)}>{x.label}<small>{n}/{x.count} · {x.pts} pt</small></button>); })}</div>
      <div className="ko-bar"><div className="t">{r.label}</div>
        <div className="c">Pick <b>{r.count}</b> · {sel.length} chosen · {r.pts} pt each</div></div>
      <p className="poolnote">{pnote}</p>
      {round === "third" && !thirdReady ? (
        <div className="empty">Finish your Semifinals first — then choose who wins the playoff between the two losing semifinalists.</div>
      ) : pool.length === 0 && round !== "ko32" ? (
        <div className="empty">Make your picks in the earlier round first — then only those teams show up here.</div>
      ) : ["ko32", "ro16", "ro8"].includes(round) ? (
        /* Group Stage / Round of 32 / Round of 16: chips grouped by original group */
        GROUPS.map((g) => {
          const gTeams = g.teams.map((t) => t[0]).filter((t) => pool.includes(t));
          if (!gTeams.length) return null;
          return (
            <div className="ko-group-section" key={g.id}>
              <div className="ko-group-label"><span className="grp-badge">{g.id}</span>{g.teams.map((t) => t[0]).join("  ·  ")}</div>
              <div className="chips">{gTeams.map((t) => { const on = sel.includes(t); const lock = !on && sel.length >= r.count;
                return (<button key={t} className={`chip ${on ? "sel" : ""} ${lock ? "lock" : ""}`} disabled={locked}
                  onClick={() => onToggle(round, t)}><Fl t={t} /><span className="cn">{t}</span><span className="grp-tag">{TEAM_GROUP[t]}</span></button>); })}</div>
            </div>
          );
        })
      ) : (
        /* Quarterfinals onward: flat chip list with group badge */
        <div className="chips">{pool.map((t) => { const on = sel.includes(t); const lock = !on && sel.length >= r.count;
          return (<button key={t} className={`chip ${on ? "sel" : ""} ${lock ? "lock" : ""}`} disabled={locked}
            onClick={() => onToggle(round, t)}><Fl t={t} /><span className="cn">{t}</span><span className="grp-tag">{TEAM_GROUP[t]}</span></button>); })}</div>
      )}
      {mode !== "admin" && round === "champ" && (
        <div className="card tb" style={{ marginTop: 22 }}>
          <h3>★ Last step · Tiebreakers</h3>
          <p className="dim">Filled out once per entry, here on the Final — used in order to break ties.</p>
          <label className="lab">1 · Total goals in the Final (closest wins)</label>
          <input className="field" type="number" min="0" placeholder="e.g. 4" disabled={locked}
            value={tb.final_total_goals ?? ""} onChange={(e) => setTb({ ...tb, final_total_goals: e.target.value === "" ? null : +e.target.value })} />
          <label className="lab">2 · Top-scoring team of the tournament</label>
          <select className="field" disabled={locked} value={tb.top_scoring_team ?? ""}
            onChange={(e) => setTb({ ...tb, top_scoring_team: e.target.value || null })}>
            <option value="">Select a team…</option>{ALL_TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <label className="lab">3 · Tournament top scorer (player)</label>
          <input className="field" placeholder="e.g. Kylian Mbappé" disabled={locked}
            value={tb.top_scorer ?? ""} onChange={(e) => setTb({ ...tb, top_scorer: e.target.value })} />
        </div>
      )}
      {mode !== "admin" && round !== "champ" && <p className="note" style={{ marginTop: 18 }}>Tiebreakers appear on the Final — the last step.</p>}
    </div>
  );
}

// ---- Everyone's Picks: schedule helpers (module-level) ----
const _ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const _fmtDate = s => new Date(s + 'T12:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
const _fmtShort = dt => new Date(dt).toLocaleDateString('en-US', { month:'short', day:'numeric' });

// Live state now comes from api_fixtures, not a kickoff+120 estimate.
const LIVE_ST = new Set(["1H", "HT", "2H", "ET", "P", "BT", "LIVE", "SUSP", "INT"]);
const FINAL_ST = new Set(["FT", "AET", "PEN"]);
// Convert an api_fixtures row (API home/away) into the app's lower-index
// orientation by matching team name, so live scores line up with group_results
// and picks ('home' = matchHome). Orientation-safe; never crosses the two.
function _appScore(fx, m) {
  if (!fx || fx.home_goals == null || fx.away_goals == null) return null;
  if (fx.home_team === m.matchAway) return { h: fx.away_goals, a: fx.home_goals };
  return { h: fx.home_goals, a: fx.away_goals };
}
// Compact "kicks off in" label for the Next-up banner.
function _untilKick(iso, now) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "now";
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}
// Minute/phase label for a live fixture header.
const _liveLabel = (fx) => fx.status === "HT" ? "HT" : fx.status === "SUSP" ? "Suspended" : fx.status === "INT" ? "Interrupted" : fx.elapsed ? `${fx.elapsed}'` : "LIVE";
const _fmtTime = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
// Shared per-match live/final state. Counted truth = group_results (sc); live
// state is provisional and never overrides a locked result.
function _colState(m, fxByMatch, gr) {
  const fx = fxByMatch[m.matchId];
  const sc = gr[m.matchId];
  const isFinalFx = !!fx && (fx.is_final || FINAL_ST.has(fx.status));
  const isFinal = !!sc || isFinalFx;
  const isLive = !!fx && LIVE_ST.has(fx.status) && !isFinal;
  const dsc = sc || (fx ? _appScore(fx, m) : null); // app-oriented score for display/winner
  return { fx, sc, isFinal, isLive, dsc };
}

// ---------------------------------------------------------------- KoReveal (Knockouts · Everyone's Picks)
const KO_ROUNDS = [
  { key: "ko32", label: "Round of 32", size: 32 },
  { key: "ro16", label: "Round of 16", size: 16 },
  { key: "ro8",  label: "Quarters",    size: 8  },
  { key: "ro4",  label: "Semis",       size: 4  },
  { key: "ro2",  label: "Final",       size: 2  },
  { key: "champ",label: "Champion",    size: 1  },
];

// Map API round string to the koResults key the winner advances INTO (frontend version).
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

// Teams eliminated so far: for each completed KO fixture, the team that
// did NOT advance to the next round's results set is out.
function _computeEliminated(fixtures, kr) {
  const out = new Set();
  fixtures.forEach((f) => {
    if (!f.is_final || f.grp) return; // skip non-final or group games
    const dest = _koDestKey(f.round);
    if (!dest) return;
    const winners = new Set(kr[dest] || []);
    if (f.home_team && !winners.has(f.home_team)) out.add(f.home_team);
    if (f.away_team && !winners.has(f.away_team)) out.add(f.away_team);
  });
  return out;
}

function KoReveal({ everyone, myUserId, results, fixtures = [] }) {
  const kr = results.koResults;

  // Source round = deepest round with its full quota of teams (e.g. ko32 needs 32,
  // ro16 needs 16). During R32 with only 1 ro16 team, source stays ko32.
  const sourceRound = [...KO_ROUNDS].reverse().find(r => (kr[r.key] || []).length >= r.size) || null;

  // Eliminated = teams whose completed KO fixture opponent already advanced.
  const eliminatedSet = _computeEliminated(fixtures, kr);

  // aliveSet = source round teams minus any already eliminated.
  const aliveSet = new Set((kr[sourceRound?.key || "ko32"] || []).filter(t => !eliminatedSet.has(t)));

  // Default round = deepest fully-populated round (sourceRound), i.e. the active round.
  const defaultRound = sourceRound ? sourceRound.key : "ko32";
  const [roundKey, setRoundKey] = useState(defaultRound);
  const [view, setView] = useState("person"); // "person" | "team"
  const [expanded, setExpanded] = useState(new Set());

  const round = KO_ROUNDS.find(r => r.key === roundKey);
  const decided = (kr[roundKey] || []).length >= (round?.size ?? Infinity);
  const reachedSet = new Set(kr[roundKey] || []);

  const mine = everyone.filter(c => c.ownerId === myUserId).sort((a, b) => a.name.localeCompare(b.name));
  const others = everyone.filter(c => c.ownerId !== myUserId).sort((a, b) => a.name.localeCompare(b.name));
  const sorted = [...mine, ...others];
  const total = sorted.length;

  function teamState(team) {
    if (decided) return reachedSet.has(team) ? "through" : "out";
    return aliveSet.size > 0 ? (aliveSet.has(team) ? "still" : "out") : "still";
  }

  // Consensus: count how many entries picked each team for this round.
  function buildConsensus() {
    const map = new Map();
    sorted.forEach(c => {
      (c.ko[roundKey] || []).forEach(team => {
        if (!map.has(team)) map.set(team, []);
        map.get(team).push(c);
      });
    });
    // Add bracket-busters (reached but nobody picked) when round is decided.
    if (decided) {
      reachedSet.forEach(team => { if (!map.has(team)) map.set(team, []); });
    }
    return [...map.entries()]
      .map(([team, backers]) => ({ team, backers, surprise: decided && reachedSet.has(team) && backers.length === 0 }))
      .sort((a, b) => (b.surprise ? 1 : 0) - (a.surprise ? 1 : 0) || b.backers.length - a.backers.length || a.team.localeCompare(b.team));
  }

  function toggleExpand(team) {
    setExpanded(prev => { const n = new Set(prev); n.has(team) ? n.delete(team) : n.add(team); return n; });
  }

  const StateBadge = ({ team }) => {
    const st = teamState(team);
    if (st === "through") return <span className="ko-badge through">✓ Through</span>;
    if (st === "out")     return <span className="ko-badge out">✕ Out</span>;
    return <span className="ko-badge still">● Still in</span>;
  };

  // ---- Person view ----
  function PersonView() {
    return (
      <div className="ko-people">
        {sorted.map(c => {
          const isMe = c.ownerId === myUserId;
          const picks = c.ko[roundKey] || [];
          const through = decided ? picks.filter(t => reachedSet.has(t)).length : 0;
          return (
            <div className={`ko-pcard${isMe ? " you" : ""}`} key={c.id}>
              <div className="ko-ph">
                <span className="ko-pname">{c.name}{isMe && <span className="ko-ytag">you</span>}</span>
                <span className="ko-owner">{c.owner}</span>
                {decided && <span className="ko-pscore">{through}/{round.size} through</span>}
              </div>
              <div className="ko-pteams">
                {picks.length ? picks.map(t => {
                  const st = teamState(t);
                  return (
                    <span key={t} className={`ko-pt ${st}`}>
                      <Fl t={t} /> {t}
                    </span>
                  );
                }) : <span className="ko-pt empty">No picks</span>}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ---- Champion podium view ----
  function ChampView() {
    const cons = buildConsensus();
    return (
      <div className="ko-champ">
        {cons.map((row, i) => {
          const st = teamState(row.team);
          const pct = total ? Math.round(row.backers.length / total * 100) : 0;
          return (
            <div className={`ko-ccard${i === 0 ? " lead" : ""}${st === "out" ? " dim" : ""}`} key={row.team}>
              <span className="ko-crank">{i + 1}</span>
              <div className="ko-cflag"><Fl t={row.team} /></div>
              <div className="ko-ctm">{row.team}</div>
              <div className="ko-ccnt"><b>{row.backers.length}</b> of {total}{row.backers.length === 1 ? " · contrarian" : " backers"} <StateBadge team={row.team} /></div>
              <div className="ko-bar"><i style={{ width: `${pct}%` }} /></div>
              <div className="ko-bchips">
                {row.backers.map(c => (
                  <span key={c.id} className={`ko-bchip${c.ownerId === myUserId ? " you" : ""}`}>{c.name}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ---- Consensus rows view ----
  function RowsView() {
    const cons = buildConsensus();
    const anySurprise = cons.some(r => r.surprise);
    return (
      <>
        {anySurprise && (
          <div className="ko-bustbanner">🐴 <b>Bracket-buster:</b> a team reached this round that <b>nobody</b> picked — pinned to the top.</div>
        )}
        <div className="ko-rows">
          {cons.map(row => {
            const st = teamState(row.team);
            const pct = total ? Math.round(row.backers.length / total * 100) : 0;
            const isOpen = expanded.has(row.team);
            const preview = row.backers.slice(0, 5);
            const extra = row.backers.length > 5 ? row.backers.length - 5 : 0;
            if (row.surprise) {
              return (
                <div className="ko-row surprise" key={row.team}>
                  <div className="ko-rowline">
                    <span className="ko-rflag"><Fl t={row.team} /></span>
                    <div className="ko-rleft">
                      <span className="ko-rtm">{row.team}</span>
                      <span className="ko-badge through">✓ Through</span>
                    </div>
                    <div className="ko-rmid"><span className="ko-rn">0/{total}</span><div className="ko-track"><i style={{ width: "0%" }} /></div></div>
                    <span className="ko-nobody">🐴 nobody picked them</span>
                  </div>
                </div>
              );
            }
            return (
              <div className={`ko-row${st === "out" ? " out" : ""}${isOpen ? " open" : ""}`} key={row.team} onClick={() => toggleExpand(row.team)}>
                <div className="ko-rowline">
                  <span className={`ko-rflag${st === "out" ? " dim" : ""}`}><Fl t={row.team} /></span>
                  <div className="ko-rleft">
                    <span className={`ko-rtm${st === "out" ? " struck" : ""}`}>{row.team}</span>
                    <StateBadge team={row.team} />
                  </div>
                  <div className="ko-rmid">
                    <span className="ko-rn">{row.backers.length}/{total}</span>
                    <div className="ko-track"><i style={{ width: `${pct}%` }} /></div>
                  </div>
                  <div className="ko-rprev">
                    {preview.map(c => (
                      <span key={c.id} className={`ko-bchip${c.ownerId === myUserId ? " you" : ""}`}>{c.name}</span>
                    ))}
                    {extra > 0 && <span className="ko-more">+{extra}</span>}
                  </div>
                  <span className="ko-caret">{isOpen ? "▴" : "▾"}</span>
                </div>
                {isOpen && (
                  <div className="ko-exp">
                    {row.backers.map(c => (
                      <span key={c.id} className={`ko-bchip${c.ownerId === myUserId ? " you" : ""}`}>{c.name}</span>
                    ))}
                    {row.backers.length === 0 && <span className="ko-dim">Nobody picked this team for this round.</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <div className="fade">
      {/* Round pills */}
      <div className="ko-rounds-bar">
        {KO_ROUNDS.map(r => {
          const isLive = r.key === defaultRound && !!sourceRound;
          return (
            <button key={r.key} className={`ko-rpill${roundKey === r.key ? " on" : ""}`} onClick={() => { setRoundKey(r.key); setExpanded(new Set()); }}>
              {isLive && <span className="ev-livedot" />}{r.label} <span className="ko-rcount">{r.size}</span>
            </button>
          );
        })}
      </div>

      {/* View toggle */}
      <div className="ko-vtog">
        <button className={view === "person" ? "on" : ""} onClick={() => setView("person")}>By person</button>
        <button className={view === "team" ? "on" : ""} onClick={() => setView("team")}>Compare by team</button>
      </div>
      <p className="note" style={{ margin: "2px 0 12px" }}>
        {view === "person" ? "Each entry's picks for this round." : roundKey === "champ" ? "Who's winning it all? Most-backed first." : "Most-backed first · ✓/✕ once decided · tap a row to see all backers."}
      </p>

      {/* Content */}
      {view === "person"
        ? <PersonView />
        : roundKey === "champ" ? <ChampView /> : <RowsView />}

      {/* Legend */}
      <div className="ko-legend">
        <span><span className="ko-sw you" />  <b>You</b> — your picks</span>
        <span><span className="ko-sw ok" /> <b>✓ Through</b> — reached this round</span>
        <span><span className="ko-sw no" /> <b>✕ Out</b> — eliminated</span>
        <span>● Still in — alive, round not decided</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Reveal
function Reveal({ everyone, myUserId, results, locked, showRes, setShowRes, fixtures = [], topScorers = [] }) {
  const [sub, setSub] = useState("ko");
  const gr = results.groupResults, kr = results.koResults;
  // Live fixtures keyed by app match_id (group games only carry one).
  const fxByMatch = {};
  fixtures.forEach(f => { if (f.match_id) fxByMatch[f.match_id] = f; });
  const colInfo = (m) => _colState(m, fxByMatch, gr);

  // Filter state — default to Date=today (or next game day)
  const SDATES = [...new Set(SCHEDULE.map(m => m.dt.slice(0,10)))].sort();
  const SGROUPS = [...new Set(SCHEDULE.map(m => m.g))].sort();
  const STEAMS = [...new Set(SCHEDULE.flatMap(m => [m.home, m.away]))].sort();
  const todayStr = _ymd(new Date());
  const defDate = SDATES.includes(todayStr) ? todayStr : (SDATES.find(d => d >= todayStr) || SDATES[SDATES.length-1]);
  const [filterBy, setFilterBy] = useState("Date");
  const [filterSub, setFilterSub] = useState(defDate);
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setLiveTick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  if (!locked) {
    return (<div className="fade"><div className="head"><div className="h1">Everyone's Picks</div><div className="pill">Hidden</div></div>
      <div className="lockbar"><span className="ico">👀</span>
        <span className="txt"><b>Hidden until kickoff.</b> Everyone&rsquo;s picks reveal once the opening match starts, so nobody can copy.</span></div></div>);
  }

  // Entries: own entries first (A→Z), then everyone else (A→Z)
  const mine = everyone.filter(c => c.ownerId === myUserId).sort((a, b) => a.name.localeCompare(b.name));
  const others = everyone.filter(c => c.ownerId !== myUserId).sort((a, b) => a.name.localeCompare(b.name));
  const sorted = [...mine, ...others];

  // Filter controls
  function subOpts(by) {
    if (by === "Group") return SGROUPS.map(g => [g, `Group ${g}`]);
    if (by === "Date") return SDATES.map(d => [d, _fmtDate(d)]);
    if (by === "Country") return STEAMS.map(t => [t, t]);
    return [];
  }
  function onFilterBy(v) {
    setFilterBy(v);
    setFilterSub(v === "Date" ? defDate : subOpts(v)[0]?.[0] ?? "");
  }

  const visMat = (() => {
    let ms = SCHEDULE.slice();
    if (filterBy === "Group") ms = ms.filter(m => m.g === filterSub);
    else if (filterBy === "Date") ms = ms.filter(m => m.dt.slice(0,10) === filterSub);
    else if (filterBy === "Country") ms = ms.filter(m => m.home === filterSub || m.away === filterSub);
    return ms.sort((a, b) => a.num - b.num);
  })();

  // Three-state banner (§3.1), all from api_fixtures: live now → next up → last
  // result. liveTick re-renders so the device-clock countdown stays fresh.
  const myFirst = mine[0];
  const nowMs = Date.now();
  // Your-pick chip for a fixture, resolved to a team name (orientation-safe).
  const pickChip = (fx, { mark } = {}) => {
    if (!fx?.match_id || !myFirst) return null;
    const m = SCHEDULE.find(s => s.matchId === fx.match_id);
    const pick = m && myFirst.gp[fx.match_id];
    if (!m || !pick) return null;
    const t = pick === "draw" ? null : pick === "home" ? m.matchHome : m.matchAway;
    let okEl = null;
    if (mark) { // last-result ✓/✕ vs the counted/api result
      const w = matchWinner(m, gr[fx.match_id] || _appScore(fx, m));
      if (w) okEl = pick === w ? <span className="ev-bok">✓</span> : <span className="ev-bno">✕</span>;
    }
    return <span className="ev-bpick"><span className="ev-blbl">Your pick</span>{t ? <><Fl t={t} /> {t}</> : "Draw"}{okEl}</span>;
  };
  const matchup = (fx, sep) => (
    <span className="ev-bg"><Fl t={fx.home_team} /> <b>{fx.home_team}</b>{sep}<b>{fx.away_team}</b> <Fl t={fx.away_team} /></span>
  );

  const liveFx = fixtures.filter(f => LIVE_ST.has(f.status) && !f.is_final)
    .sort((a, b) => (myFirst?.gp[b.match_id] ? 1 : 0) - (myFirst?.gp[a.match_id] ? 1 : 0))[0];
  const nextFx = fixtures.filter(f => !f.is_final && !LIVE_ST.has(f.status) && f.kickoff_utc && new Date(f.kickoff_utc).getTime() > nowMs)
    .sort((a, b) => new Date(a.kickoff_utc) - new Date(b.kickoff_utc))[0];
  const lastFx = fixtures.filter(f => f.is_final || FINAL_ST.has(f.status))
    .sort((a, b) => new Date(b.kickoff_utc) - new Date(a.kickoff_utc))[0];

  let bannerEl;
  if (liveFx) {
    bannerEl = (
      <div className="ev-banner live">
        <span className="ev-blab"><span className="ev-dot" /> LIVE NOW</span>
        {matchup(liveFx, <span className="ev-score"> {liveFx.home_goals ?? 0}–{liveFx.away_goals ?? 0} </span>)}
        <span className="ev-bmin">{_liveLabel(liveFx)}</span>
        {pickChip(liveFx)}
      </div>
    );
  } else if (nextFx) {
    bannerEl = (
      <div className="ev-banner next">
        <span className="ev-blab calm">⏱ NEXT UP</span>
        {matchup(nextFx, <span className="ev-vs"> vs </span>)}
        <span className="ev-bmin">kicks off in {_untilKick(nextFx.kickoff_utc, nowMs)}</span>
        {pickChip(nextFx)}
      </div>
    );
  } else if (lastFx) {
    bannerEl = (
      <div className="ev-banner last">
        <span className="ev-blab done">✓ LAST RESULT</span>
        {matchup(lastFx, <span className="ev-score"> {lastFx.home_goals ?? 0}–{lastFx.away_goals ?? 0} </span>)}
        {pickChip(lastFx, { mark: true })}
      </div>
    );
  } else {
    bannerEl = <div className="ev-banner calm">😌 No games on right now — time to relax. Go touch some grass.</div>;
  }

  const goals = teamGoals(gr);
  const topGoals = Object.entries(goals).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const wfRounds = [["ko32","Last 32"],["ro16","Last 16"],["ro8","Quarterfinalists"],
    ["ro4","Semifinalists"],["ro2","Finalists"],["third","3rd Place"],["champ","Champion"]];

  return (
    <div className="fade">
      <div className="head"><div className="h1">Everyone's Picks</div><div className="pill">Live</div></div>
      <div className="seg">
        <button className={sub === "groups" ? "on" : ""} onClick={() => setSub("groups")}>Group Stage</button>
        <button className={sub === "ko" ? "on" : ""} onClick={() => setSub("ko")}>Knockouts</button>
      </div>

      {sub === "groups" ? (<>
        {/* Two-step filter */}
        <div className="ev-filters">
          <span className="ev-fl">Filter by</span>
          <select className="ev-sel" value={filterBy} onChange={e => onFilterBy(e.target.value)}>
            <option value="Group">Group</option>
            <option value="Date">Date</option>
            <option value="Country">Country</option>
          </select>
          <select className="ev-sel" value={filterSub} onChange={e => setFilterSub(e.target.value)}>
            {subOpts(filterBy).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {/* Live banner — liveTick causes re-render so banner re-evaluates device clock */}
        <div data-tick={liveTick}>{bannerEl}</div>

        {/* Table: rows = entries, columns = filtered matches */}
        <div className="ev-outer">
          <div className="ev-scroll">
            <table className="ev-tbl">
              <thead>
                <tr>
                  <th className="ev-th-e">Entry</th>
                  {visMat.map(m => {
                    const { fx, isFinal, isLive, dsc } = colInfo(m);
                    const w = isFinal && dsc ? matchWinner(m, dsc) : null; // bold winner only when final
                    // sf=true means tournament home is match_id "away"; flip score display accordingly
                    const hg = dsc ? (m.sf ? dsc.a : dsc.h) : null;
                    const ag = dsc ? (m.sf ? dsc.h : dsc.a) : null;
                    const homeWon = w && !m.sf ? w === "home" : w && m.sf ? w === "away" : false;
                    const awayWon = w && !m.sf ? w === "away" : w && m.sf ? w === "home" : false;
                    return (
                      <th key={m.matchId} className={`ev-th-m${isLive ? " live" : ""}`}>
                        <div className="ev-mh">
                          <div className="ev-mh-top">
                            <span className="ev-gtag">{m.g}</span>
                            {isLive ? <span className="ev-mst live"><span className="ev-dot" />{_liveLabel(fx)}</span>
                              : isFinal ? <span className="ev-mst ft">FT</span>
                              : <span className="ev-mst sched">{_fmtShort(m.dt)}</span>}
                          </div>
                          <div className={`ev-tl${homeWon ? " win" : ""}`}>
                            <Fl t={m.home} /><span className="ev-tn">{m.home}</span><span className="ev-cd">{TEAM_CODE[m.home] || m.home}</span>
                            {hg != null && <span className="ev-gg">{hg}</span>}
                          </div>
                          <div className={`ev-tl${awayWon ? " win" : ""}`}>
                            <Fl t={m.away} /><span className="ev-tn">{m.away}</span><span className="ev-cd">{TEAM_CODE[m.away] || m.away}</span>
                            {ag != null && <span className="ev-gg">{ag}</span>}
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map(c => {
                  const isMe = c.ownerId === myUserId;
                  return (
                    <tr key={c.id} className={isMe ? "ev-mine" : ""}>
                      <td className="ev-td-e">
                        <div className="ev-ename">{c.name}{isMe && <span className="ev-you">you</span>}</div>
                        <div className="ev-eown">{c.owner}</div>
                      </td>
                      {visMat.map(m => {
                        const pick = c.gp[m.matchId];
                        if (!pick) {
                          const { isLive } = colInfo(m);
                          return <td key={m.matchId} className={`ev-td-k${isLive ? " live" : ""}`}><span className="ev-none">·</span></td>;
                        }
                        const { isFinal, isLive, dsc } = colInfo(m);
                        const isDraw = pick === "draw";
                        const pickedTeam = isDraw ? null : pick === "home" ? m.matchHome : m.matchAway;
                        // Solid ✓/✕ only when final (counted). Live + currently-correct = glow.
                        const finalW = isFinal && dsc ? matchWinner(m, dsc) : null;
                        const liveW = isLive && dsc ? matchWinner(m, dsc) : null;
                        let state;
                        if (finalW) state = pick === finalW ? "ok" : "no";
                        else if (isLive) state = liveW && pick === liveW ? "glow" : "livepend";
                        else state = "pend";
                        const marker = state === "ok" ? <span className="ev-ic ok">✓</span>
                          : state === "no" ? <span className="ev-ic no">✕</span>
                          : state === "glow" ? <span className="ev-livedot" /> : null;
                        const tdCls = `ev-td-k${isLive ? " live" : ""}`
                          + (state === "ok" ? " ok" : state === "no" ? " no" : state === "glow" ? " glow" : "");
                        return (
                          <td key={m.matchId} className={tdCls}>
                            <span className={`ev-chip${isDraw ? " draw" : ""}${state === "glow" ? " glow" : ""}`}>
                              {marker}
                              {isDraw ? <span className="ev-dr">Draw</span> : <><Fl t={pickedTeam} /><span className="ev-tn">{pickedTeam}</span></>}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {topGoals.length > 0 && (
          <div className="goalbar" style={{ marginTop: 14 }}>
            <span className="gb-lab">⚽ Most goals by country (group stage) — feeds the top-scoring-team tiebreaker</span>
            <div className="gb-chips">{topGoals.map(([t, g]) => <span className="gb-chip" key={t}><Fl t={t} /><span className="cn">{t}</span><b>{g}</b></span>)}</div>
          </div>
        )}
        {topScorers.length > 0 && (
          <div className="goalbar" style={{ marginTop: 14, borderLeftColor: "var(--gold)" }}>
            <span className="gb-lab">👟 Top scorers (players) — most goals so far · feeds the top-scorer tiebreaker</span>
            <div className="gb-chips">{topScorers.slice(0, 6).map((p) => (
              <span className="gb-chip" key={`${p.player}-${p.team}`}>{p.team && <Fl t={p.team} />}<span className="cn">{p.player}</span><b>{p.goals}</b></span>
            ))}</div>
          </div>
        )}
      </>) : (
        <KoReveal everyone={everyone} myUserId={myUserId} results={results} fixtures={fixtures} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Matchday dashboard
// Group stage: reads SCHEDULE + group_predictions for ✓/✕/live cards.
// Knockout stage (post group stage): reads api_fixtures for that day's KO games,
// shows live scores and cross-references the entry's knockout_predictions so users
// can see which teams they backed in each round.
function MatchdayDashboard({ gp = {}, ko = {}, fixtures = [], results }) {
  const gr = results.groupResults;
  const fxByMatch = {};
  fixtures.forEach((f) => { if (f.match_id) fxByMatch[f.match_id] = f; });

  // All unique dates from group schedule.
  const SDATES = [...new Set(SCHEDULE.map((m) => m.dt.slice(0, 10)))].sort();
  const lastGroupDate = SDATES[SDATES.length - 1];
  const todayStr = _ymd(new Date());

  // KO fixture dates from api_fixtures — convert UTC to local date so that
  // e.g. a 9pm ET game (1am UTC next day) lands on the correct local date.
  const koFxDates = [...new Set(
    fixtures
      .filter((f) => !f.grp && f.kickoff_utc)
      .map((f) => _ymd(new Date(f.kickoff_utc)))
  )].sort();

  // Combined navigable date list: group dates + KO dates (deduped, sorted).
  const ALL_DATES = [...new Set([...SDATES, ...koFxDates])].sort();

  // Default to today if it has games, else nearest upcoming, else last group date.
  const defaultDate = ALL_DATES.includes(todayStr)
    ? todayStr
    : (ALL_DATES.find((d) => d >= todayStr) || lastGroupDate);

  const [targetDate, setTargetDate] = useState(defaultDate);

  const idx = ALL_DATES.indexOf(targetDate);
  const hasPrev = idx > 0;
  const hasNext = idx < ALL_DATES.length - 1;
  const isToday = targetDate === todayStr;
  const dayLabel = isToday ? "Today" : targetDate < todayStr ? _fmtDate(targetDate) : "Next up";

  // Determine whether this date is a group-stage day or a KO day.
  const isGroupDay = SDATES.includes(targetDate);
  const groupGames = isGroupDay
    ? SCHEDULE.filter((m) => m.dt.slice(0, 10) === targetDate).sort((a, b) => a.num - b.num)
    : [];
  const koGames = !isGroupDay
    ? fixtures
        .filter((f) => !f.grp && f.kickoff_utc && _ymd(new Date(f.kickoff_utc)) === targetDate)
        .sort((a, b) => new Date(a.kickoff_utc) - new Date(b.kickoff_utc))
    : [];

  // ---- Group stage card logic ----
  const pickTeam = (m, pick) => pick === "draw" ? "Draw" : pick === "home" ? m.matchHome : m.matchAway;
  let correct = 0, wrong = 0, liveN = 0, upcoming = 0, pts = 0, livePend = 0;
  const groupCards = groupGames.map((m) => {
    const pick = gp[m.matchId];
    const { fx, isFinal, isLive, dsc } = _colState(m, fxByMatch, gr);
    const finalW = isFinal && dsc ? matchWinner(m, dsc) : null;
    const liveW = isLive && dsc ? matchWinner(m, dsc) : null;
    const onTrack = isLive && pick && liveW && pick === liveW;
    let state;
    if (finalW) state = pick ? (pick === finalW ? "correct" : "wrong") : "final";
    else if (isLive) state = "live";
    else state = "upcoming";
    if (state === "correct") { correct++; pts++; }
    else if (state === "wrong") wrong++;
    else if (state === "live") { liveN++; if (onTrack) livePend++; }
    else if (state === "upcoming") upcoming++;
    return { m, pick, fx, dsc, finalW, liveW, onTrack, state };
  });

  // ---- KO round label from api_fixtures round string ----
  // e.g. "Round of 32 - 1/16" -> "Round of 32"
  const koRoundLabel = (round) => {
    if (!round) return "Knockout";
    const r = round.toLowerCase();
    if (r.includes("final") && r.includes("3rd")) return "3rd Place";
    if (r.includes("final")) return r.includes("semi") ? "Semi-final" : "Final";
    if (r.includes("quarter")) return "Quarter-final";
    if (r.includes("round of 16") || r.includes("1/8")) return "Round of 16";
    if (r.includes("round of 32") || r.includes("1/16")) return "Round of 32";
    return round;
  };

  // For a KO fixture, find which KO round key maps to it and whether the user
  // picked either team to reach that round.
  const koPickContext = (f) => {
    const r = (f.round || "").toLowerCase();
    let roundKey = null;
    if (r.includes("round of 32") || r.includes("1/16")) roundKey = "ko32";
    else if (r.includes("round of 16") || r.includes("1/8")) roundKey = "ro16";
    else if (r.includes("quarter")) roundKey = "ro8";
    else if (r.includes("semi")) roundKey = "ro4";
    else if (r.includes("3rd")) roundKey = "third";
    else if (r.includes("final")) roundKey = "ro2";
    if (!roundKey) return null;
    const myPicks = new Set(ko[roundKey] || []);
    const pickedHome = myPicks.has(f.home_team);
    const pickedAway = myPicks.has(f.away_team);
    return { roundKey, pickedHome, pickedAway };
  };

  return (
    <div className="fade">
      <div className="head"><div className="h1">Matchday</div>
        <div className="md-nav">
          <button className="md-nav-btn" onClick={() => setTargetDate(ALL_DATES[idx - 1])} disabled={!hasPrev}>&#8249;</button>
          <span className="pill">{dayLabel} · {_fmtDate(targetDate)}</span>
          <button className="md-nav-btn" onClick={() => setTargetDate(ALL_DATES[idx + 1])} disabled={!hasNext}>&#8250;</button>
          {!isToday && <button className="md-nav-today" onClick={() => setTargetDate(defaultDate)}>Today</button>}
        </div></div>

      <div className="dash">
        {/* Group stage summary chips */}
        {isGroupDay && (
          <div className="counts">
            {correct > 0 && <span className="ct ok">&#10003; {correct} correct</span>}
            {wrong > 0 && <span className="ct no">&#10005; {wrong} wrong</span>}
            {liveN > 0 && <span className="ct live"><span className="ev-livedot" />{liveN} live</span>}
            {upcoming > 0 && <span className="ct soon">{upcoming} upcoming</span>}
            <span className="ct tot">+{pts} today{livePend > 0 ? ` · +${livePend} live pending` : ""}</span>
          </div>
        )}

        <div className="cards">
          {/* Group stage cards */}
          {groupCards.map(({ m, pick, dsc, onTrack, state }) => {
            const hg = dsc ? (m.sf ? dsc.a : dsc.h) : null;
            const ag = dsc ? (m.sf ? dsc.h : dsc.a) : null;
            const cardCls = state === "correct" ? "okc" : state === "wrong" ? "noc" : state === "live" ? "livec" : "";
            const koTime = fxByMatch[m.matchId]?.kickoff_utc || m.dt;
            let sub, res;
            if (state === "live") {
              sub = <b style={{ color: "var(--red)" }}>{_liveLabel(fxByMatch[m.matchId])} LIVE</b>;
              res = (<><span className="pill live"><span className="ev-livedot" />You: {pick ? pickTeam(m, pick) : "—"}</span>
                <span className={onTrack ? "dash-on" : "dash-off"}>{!pick ? "no pick" : onTrack ? "on track (+1)" : "trailing"}</span></>);
            } else if (state === "correct") {
              sub = "Full time";
              res = (<><span className="pill ok"><span className="ev-ic ok">&#10003;</span>You: {pickTeam(m, pick)}</span><span className="dash-on">+1</span></>);
            } else if (state === "wrong") {
              sub = "Full time";
              res = (<><span className="pill no"><span className="ev-ic no">&#10005;</span>You: {pickTeam(m, pick)}</span><span className="dash-off">+0</span></>);
            } else if (state === "final") {
              sub = "Full time";
              res = <span className="pill soon">No pick</span>;
            } else {
              sub = _fmtTime(koTime);
              res = (<><span className="pill soon">You: {pick ? pickTeam(m, pick) : "—"}</span><span className="dash-dim">not started</span></>);
            }
            return (
              <div className={`gcard ${cardCls}`} key={m.matchId}>
                <div className="fx">
                  <span className="fx-top"><Fl t={m.home} /> <b>{m.home}</b>
                    {dsc ? <span className="fx-sc"> {hg}–{ag} </span> : <span className="fx-vs"> vs </span>}
                    <b>{m.away}</b> <Fl t={m.away} /></span>
                  <span className="sub">Group {m.g} · {sub}</span>
                </div>
                <div className="res">{res}</div>
              </div>
            );
          })}

          {/* Knockout stage cards */}
          {koGames.map((f) => {
            const isLive = LIVE_ST.has(f.status) && !f.is_final;
            const isFinal = f.is_final || FINAL_ST.has(f.status);
            const cardCls = isLive ? "livec" : "";
            const ctx = koPickContext(f);
            const pickedHome = ctx?.pickedHome;
            const pickedAway = ctx?.pickedAway;
            let sub, res;
            if (isLive) {
              sub = <b style={{ color: "var(--red)" }}>{_liveLabel(f)} LIVE</b>;
            } else if (isFinal) {
              sub = "Full time";
            } else {
              sub = _fmtTime(f.kickoff_utc);
            }
            // Show which team(s) the user backed to reach this round.
            if (pickedHome || pickedAway) {
              const picked = [pickedHome && f.home_team, pickedAway && f.away_team].filter(Boolean).join(" & ");
              res = <span className="pill soon">You backed: {picked}</span>;
            } else if (ctx) {
              res = <span className="dash-dim">No pick this round</span>;
            }
            return (
              <div className={`gcard ${cardCls}`} key={f.api_id}>
                <div className="fx">
                  <span className="fx-top">
                    <Fl t={f.home_team} /> <b>{f.home_team}</b>
                    {(isLive || isFinal) && f.home_goals != null
                      ? <span className="fx-sc"> {f.home_goals}–{f.away_goals} </span>
                      : <span className="fx-vs"> vs </span>}
                    <b>{f.away_team}</b> <Fl t={f.away_team} />
                  </span>
                  <span className="sub">{koRoundLabel(f.round)} · {sub}</span>
                </div>
                {res && <div className="res">{res}</div>}
              </div>
            );
          })}
        </div>

        {groupGames.length === 0 && koGames.length === 0 && (
          <div className="empty">No games scheduled for this day.</div>
        )}
        <p className="note" style={{ marginTop: 12 }}>See all your picks any time under <b>Everyone's Picks</b>.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Leaderboard
function Leaderboard({ everyone, myUserId, results, fixtures = [], topScorers = [] }) {
  const BD = [["GR", "GR"], ["R32", "R32"], ["R16", "R16"], ["QF", "QF"], ["SF", "SF"], ["TH", "3RD"], ["FN", "FIN"]];

  // Provisional results from currently-live group matches (app-oriented).
  // Never persisted — recomputed each render from api_fixtures.
  const liveResults = {};
  fixtures.forEach((f) => {
    if (!f.match_id || f.is_final || !LIVE_ST.has(f.status)) return;
    // Counted result wins: never let a still-"live" fixture shadow a locked
    // group_results row (e.g. an admin-entered final the poller hasn't FT'd yet).
    if (results.groupResults[f.match_id]) return;
    const m = SCHEDULE.find((s) => s.matchId === f.match_id);
    const sc = m && _appScore(f, m);
    if (sc) liveResults[f.match_id] = sc;
  });
  const liveIds = Object.keys(liveResults);
  const live = liveIds.length > 0;
  const projResults = live ? { ...results.groupResults, ...liveResults } : results.groupResults;

  // ---- Tiebreaker actuals, auto-graded from live data ----
  // 1) Final total goals (from the Final fixture), 2) top-scoring team (goals
  // across all completed matches), 3) tournament top scorer (top_scorers cache).
  const norm = (s) => String(s || "").trim().toLowerCase();
  const teamGoalsAll = {};
  let finalTotal = null;
  fixtures.forEach((f) => {
    if (!(f.is_final || FINAL_ST.has(f.status))) return;
    if (f.home_goals != null) teamGoalsAll[f.home_team] = (teamGoalsAll[f.home_team] || 0) + f.home_goals;
    if (f.away_goals != null) teamGoalsAll[f.away_team] = (teamGoalsAll[f.away_team] || 0) + f.away_goals;
    if (f.round && norm(f.round) === "final") finalTotal = (f.home_goals || 0) + (f.away_goals || 0);
  });
  const scorerVal = (name) => {
    const n = norm(name); if (!n) return 0;
    const hit = topScorers.find((p) => norm(p.player) === n) || topScorers.find((p) => { const pn = norm(p.player); return pn.includes(n) || n.includes(pn); });
    return hit ? hit.goals : 0;
  };
  const topScorerActual = topScorers[0] || null;
  const topTeamActual = Object.entries(teamGoalsAll).sort((a, b) => b[1] - a[1])[0] || null;
  const finalKnown = finalTotal != null;
  const tbActive = !!topScorerActual || !!topTeamActual || finalKnown;

  const { qualified, provisional } = computeQualified(fixtures, results.groupResults);

  const rows = everyone.map((c) => {
    const locked = scoreBreakdown(c.gp, c.ko, results.groupResults, results.koResults);
    const projTotal = live ? scoreBreakdown(c.gp, c.ko, projResults, results.koResults).total : locked.total;
    const max = maxBreakdown(c.gp, c.ko, results.koResults, qualified, results.groupResults, fixtures);
    const grPicksMade = MATCHES.filter((m) => c.gp[m.id]).length;
    const tb = c.tb || {};
    return {
      id: c.id, name: c.name, owner: c.owner, me: c.ownerId === myUserId, ...locked,
      lockedTotal: locked.total, projTotal, swing: projTotal - locked.total, max, grPicksMade,
      hasLivePick: live && liveIds.some((mid) => c.gp[mid]),
      // tiebreak metrics: final = abs diff (smaller better); team/scorer = goals (higher better)
      tFinal: (finalKnown && tb.final_total_goals != null) ? Math.abs(tb.final_total_goals - finalTotal) : null,
      tTeam: tb.top_scoring_team ? (teamGoalsAll[tb.top_scoring_team] || 0) : 0,
      tScorer: scorerVal(tb.top_scorer),
    };
  });
  // Competition ranking (ties share a rank), computed for locked and projected.
  const rankBy = (r, key) => 1 + rows.filter((x) => x[key] > r[key]).length;
  rows.forEach((r) => { r.move = rankBy(r, "lockedTotal") - rankBy(r, "projTotal"); });
  // Sort: points, then tiebreakers in order (final goals → top team → top scorer), then name.
  const cmpFinal = (a, b) => { if (!finalKnown) return 0; const av = a.tFinal ?? Infinity, bv = b.tFinal ?? Infinity; return av === bv ? 0 : av - bv; };
  rows.sort((a, b) => b.projTotal - a.projTotal || b.lockedTotal - a.lockedTotal
    || cmpFinal(a, b) || (b.tTeam - a.tTeam) || (b.tScorer - a.tScorer) || a.name.localeCompare(b.name));
  // Flag rows level on points with a neighbour (i.e. order decided by tiebreakers).
  rows.forEach((r, i) => { r.tied = tbActive && ((i > 0 && rows[i - 1].projTotal === r.projTotal) || (i < rows.length - 1 && rows[i + 1].projTotal === r.projTotal)); });

  return (
    <div className="fade">
      <div className="head"><div className="h1">Leaderboard</div>
        <div className="pill">{live ? `Live · ${liveIds.length} match${liveIds.length > 1 ? "es" : ""} on` : "Standings"}</div></div>
      {live && (
        <div className="lb-prov-note"><span className="i">i</span>
          <span><b>Live scoring is provisional.</b> Points and ranks update as goals go in and only lock at full time —
            a late goal or a VAR call can still change them.</span></div>
      )}
      <div className="card">{rows.map((p, i) => (
        <div className={`lb-row ${p.me ? "me" : ""}`} key={p.id}>
          <div className="lb-rank">{i + 1}
            {live && <span className={`lb-mv ${p.move > 0 ? "up" : p.move < 0 ? "dn" : "eq"}`}>
              {p.move > 0 ? `▲${p.move}` : p.move < 0 ? `▼${-p.move}` : "—"}</span>}
          </div>
          <div className="lb-main"><div className="lb-name">{p.name} <span className="owner">· {p.owner}</span></div>
<div className="lb-bd">{BD.map(([k, lab]) => {
              const cur = p[k];
              const mx = p.max[k];
              const showMax = mx > 0 || cur > 0;
              return (
                <span className="bd" key={k}>{lab} <b>{cur}</b>{showMax && <span className="bd-max">/{provisional && k !== "GR" ? "~" : ""}{cur + mx}</span>}</span>
              );
            })}
              {live && (p.swing > 0
                ? <span className="lb-live up">&#9650; +{p.swing} live</span>
                : p.hasLivePick
                  ? <span className="lb-live flat">live · no points yet</span>
                  : <span className="lb-live flat">— no live pick</span>)}
            </div></div>
          <div className="lb-score">
            <div>{live ? p.projTotal : p.lockedTotal}</div>
            <div className="lb-score-max">{provisional ? "~" : ""}{(live ? p.projTotal : p.lockedTotal) + p.max.total} max</div>
            {live && p.swing > 0 && <span className="lb-from">was {p.lockedTotal}</span>}
          </div>
        </div>))}
        {rows.length === 0 && <p className="note">No entries yet.</p>}</div>

      {tbActive && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3>Tiebreakers <span className="tb-auto">auto-graded</span></h3>
          <p className="dim">Applied in order whenever entries are level on points — pulled live from the data, no manual entry.</p>
          <div className="rule"><span>1 · Total goals in the Final</span><b>{finalKnown ? finalTotal : "—"}</b></div>
          <div className="rule"><span>2 · Top-scoring team</span><b>{topTeamActual ? `${topTeamActual[0]} · ${topTeamActual[1]}` : "—"}</b></div>
          <div className="rule"><span>3 · Tournament top scorer</span><b>{topScorerActual ? `${topScorerActual.player} · ${topScorerActual.goals}` : "—"}</b></div>
        </div>
      )}

      <p className="note">Breakdown by stage — GR group · R32/R16/QF/SF teams correct each round · 3RD third-place · FIN finalists + champion.
        {live ? " Live points come from in-progress group matches and are not yet counted." : " Updates from entered results."}</p>
    </div>
  );
}

// ---------------------------------------------------------------- Standings
const _formChips = (form) => {
  if (!form) return null;
  return String(form).replace(/[^WDL]/gi, "").toUpperCase().slice(-5).split("").map((c, i) =>
    <span key={i} className={c === "W" ? "w" : c === "L" ? "l" : "d"}>{c}</span>);
};
function Standings({ standings = [], fixtures = [], results, entries = [], picks = {}, defaultEntryId = null }) {
  const [selId, setSelId] = useState(defaultEntryId);
  const activePicks = picks[selId] || { gp: {}, ko: {}, tb: {} };
  const myKo32 = activePicks.ko?.ko32 || [];
  const entryName = entries.find((e) => e.id === selId)?.name || "";

  const gr = results.groupResults;
  // Teams currently playing (for the LIVE chip).
  const liveTeams = new Set();
  fixtures.forEach((f) => { if (LIVE_ST.has(f.status) && !f.is_final) { liveTeams.add(f.home_team); liveTeams.add(f.away_team); } });
  const byGroup = {};
  standings.forEach((r) => { (byGroup[r.grp] ||= []).push(r); });
  const ko32 = new Set(myKo32);

  // Compute a group table from our counted results (written at FT, always fresh).
  // Ranks by points → GD → GF (head-to-head not modelled; rare to differ early).
  const computeTable = (g) => {
    const stat = {};
    g.teams.forEach(([t]) => (stat[t] = { team: t, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, Pts: 0, form: "" }));
    SCHEDULE.filter((s) => s.g === g.id).sort((a, b) => a.num - b.num).forEach((m) => {
      const sc = gr[m.matchId];
      if (!sc || sc.h == null || sc.a == null) return; // sc oriented to matchHome (lower index)
      const H = stat[m.matchHome], A = stat[m.matchAway];
      H.P++; A.P++; H.GF += sc.h; H.GA += sc.a; A.GF += sc.a; A.GA += sc.h;
      if (sc.h > sc.a) { H.W++; H.Pts += 3; A.L++; H.form += "W"; A.form += "L"; }
      else if (sc.a > sc.h) { A.W++; A.Pts += 3; H.L++; A.form += "W"; H.form += "L"; }
      else { H.D++; A.D++; H.Pts++; A.Pts++; H.form += "D"; A.form += "D"; }
    });
    const rows = Object.values(stat).map((s) => ({ ...s, GD: s.GF - s.GA }));
    rows.sort((a, b) => b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || a.team.localeCompare(b.team));
    rows.forEach((r, i) => (r.rank = i + 1));
    return rows;
  };
  const cacheTable = (g) => (byGroup[g.id] || []).slice().sort((a, b) => a.rank - b.rank)
    .map((r) => ({ team: r.app_team, rank: r.rank, P: r.played, W: r.win, D: r.draw, L: r.lose, GF: r.gf, GA: r.ga, GD: r.gd, Pts: r.points, form: r.form }));

  // Prefer whichever source knows about more games. group_results is FT-fresh,
  // so this self-heals when API-Football's /standings lags behind the results.
  const tableFor = (g) => {
    const comp = computeTable(g), cache = cacheTable(g);
    const compP = comp.reduce((s, r) => s + r.P, 0), cacheP = cache.reduce((s, r) => s + r.P, 0);
    if (compP > cacheP) return { rows: comp, played: compP };
    if (cache.length) return { rows: cache, played: cacheP };
    return { rows: comp, played: compP };
  };

  const hasAny = Object.keys(gr).length > 0 || standings.length > 0;

  return (
    <div className="fade">
      <div className="head"><div className="h1">Standings</div>
        <div className="pill">{hasAny ? "Live tables" : "Group tables"}</div></div>
      {!hasAny && (
        <div className="lockbar"><span className="ico">📊</span>
          <span className="txt"><b>Tables fill in once matches kick off.</b> They update within a minute of each final whistle.</span></div>
      )}
      {entries.length > 1 && (
        <div className={'st-entry-bar'}>
          {entries.map((e) => (
            <button key={e.id} className={'st-entry-btn' + (selId === e.id ? ' on' : '')} onClick={() => setSelId(e.id)}>{e.name}</button>
          ))}
        </div>
      )}
      {ko32.size > 0 && (
        <p className={'poolnote'}>&#8220;If it holds&#8221; notes below cross-reference your Round-of-32 picks{entryName ? ' for ' + entryName : ''}.</p>
      )}
      {GROUPS.map((g) => {
        const { rows, played } = tableFor(g);
        const myHere = g.teams.map((t) => t[0]).filter((t) => ko32.has(t));
        return (
          <div className="st-card" key={g.id}>
            <table className="st">
              <thead><tr><th>Group {g.id}</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th><th>Form</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const qual = r.rank <= 2 ? "q" : r.rank === 3 ? "qt" : "";
                  return (
                    <tr key={r.team} className={qual}>
                      <td><span className="st-team"><span className="st-rk">{r.rank}</span><Fl t={r.team} />
                        <span className="st-tn">{r.team}</span>
                        {ko32.has(r.team) && <span className="st-mine">pick</span>}
                        {liveTeams.has(r.team) && <span className="ev-mst live"><span className="ev-dot" />LIVE</span>}</span></td>
                      <td>{r.P}</td><td>{r.W}</td><td>{r.D}</td><td>{r.L}</td>
                      <td>{r.GD > 0 ? `+${r.GD}` : r.GD}</td><td className="st-pts">{r.Pts}</td>
                      <td className="form">{_formChips(r.form)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {played > 0 && ko32.size > 0 && (
              <div className="koimp"><span className="ph">Your picks</span>
                <div>
                  <span className="ki-lead">How <b>your</b> Round-of-32 picks would fare if this group ended at the current standings:</span>
                  {myHere.length === 0
                  ? <span className="ki-dim">You didn't pick any team from this group to reach the Round of 32.</span>
                  : myHere.map((t) => {
                      const r = rows.find((x) => x.team === t);
                      const cls = r.rank <= 2 ? "adv" : r.rank === 3 ? "third" : "out";
                      const mk = r.rank <= 2 ? "✓ your pick advances" : r.rank === 3 ? "3rd · in the running" : "✕ your pick goes out";
                      return <span className={`ki-chip ${cls}`} key={t}><Fl t={t} /> {t} <b>{mk}</b></span>;
                    })}
                  <span className="ki-dim">Top 2 qualify; 3rd place competes for the 8 best-third-placed spots.</span>
                </div></div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Rules() {
  return (
    <div className="fade">
      <div className="head"><div className="h1">How Scoring Works</div></div>
      <div className="card"><h3>Group Stage</h3><p className="dim">Predict a winner or a draw for all 72 matches.</p>
        <div className="rule"><span>Each correct result (incl. correct draws)</span><b>1 pt</b></div>
        <div className="rule"><span>Wrong pick</span><b>0 pt</b></div></div>
      <div className="card"><h3>Knockout Stage</h3><p className="dim">Each round is played, and you pick the winners who advance. Each round only offers the teams you advanced from the round before.</p>
        <div className="rule"><span>Each team that reaches the Round of 32 (×32)</span><b>1 pt</b></div>
        <div className="rule"><span>Each correct Round of 32 winner (×16)</span><b>2 pt</b></div>
        <div className="rule"><span>Each correct Round of 16 winner (×8)</span><b>4 pt</b></div>
        <div className="rule"><span>Each correct Quarterfinals winner (×4)</span><b>8 pt</b></div>
        <div className="rule"><span>Each correct Semifinals winner (×2)</span><b>24 pt</b></div>
        <div className="rule"><span>Each correct 3rd-Place Game team (×2, automatic)</span><b>12 pt</b></div>
        <div className="rule"><span>Correct 3rd-Place Game winner</span><b>16 pt</b></div>
        <div className="rule"><span>Correct champion</span><b>32 pt</b></div></div>
      <div className="card tb"><h3>Tiebreakers</h3>
        <div className="rule"><span>1 · Closest to total goals in the Final</span><b>·</b></div>
        <div className="rule"><span>2 · Closest pick of top-scoring team</span><b>·</b></div>
        <div className="rule"><span>3 · Closest pick of tournament top scorer</span><b>·</b></div></div>
    </div>
  );
}

// ---------------------------------------------------------------- Admin: API sync health
// Self-contained: reads sync_state + unmapped_teams on its own, refreshes silently
// every 20s, and offers the poller kill-switch. Read-only otherwise — the manual
// score-entry path stays the fallback if the feed hiccups.
function AdminHealth() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0); // re-render so "Xs ago" stays current

  async function load(silent) {
    if (!silent) setLoading(true);
    try { setData(await loadSyncHealth()); setErr(""); }
    catch (e) { setErr(e.message || "Could not read sync health."); }
    if (!silent) setLoading(false);
  }
  useEffect(() => {
    load(false);
    const data = setInterval(() => load(true), 20000); // refresh data
    const clock = setInterval(() => setTick((n) => n + 1), 5000); // tick rel-times
    return () => { clearInterval(data); clearInterval(clock); };
  }, []);

  const ss = data?.sync;
  const unmapped = data?.unmapped || [];
  const paused = !!ss?.poller_paused;
  const codeOk = ss?.last_status_code == null || ss.last_status_code === 200;

  async function togglePause() {
    if (!ss) return;
    const next = !paused;
    if (next && !confirm("Pause the live poller? Live scores stop updating until you resume.")) return;
    setBusy(true);
    try { await setPollerPaused(next); await load(true); }
    catch (e) { setErr(e.message || "Couldn't change the poller (RLS may block writes from the browser)."); }
    setBusy(false);
  }

  // Headline status. The poller self-gates (it only calls the API inside a live
  // window), so a stale last-success is normal between matches and isn't an error.
  let status;
  if (loading && !ss) status = { dot: "", label: "Checking…" };
  else if (!ss) status = { dot: "warn", label: "No sync_state row" };
  else if (paused) status = { dot: "warn", label: "Paused" };
  else if (!codeOk) status = { dot: "bad", label: `API error (${ss.last_status_code})` };
  else status = { dot: "ok", label: "Healthy" };

  return (
    <div className="ah-wrap">
      <div className="ah-head">
        <p className="poolnote" style={{ margin: 0 }}>
          Live feed health, read from <code>sync_state</code> and <code>unmapped_teams</code>. The
          unmapped-teams alarm is the one that quietly stops results from scoring — clear it first.
        </p>
        <button className="ah-btn" disabled={loading} onClick={() => load(false)}>
          {loading ? "…" : "↻ Refresh"}
        </button>
      </div>

      {err && <div className="ah-err">⚠ {err}</div>}

      <div className="ah-grid">
        <div className="ah-card">
          <h4>Sync status</h4>
          <div className="ah-row"><span className="k">Feed</span>
            <span className="v"><span className={`ah-dot ${status.dot}`} />{status.label}</span></div>
          <div className="ah-row"><span className="k">Last poll</span>
            <span className="v">{relTime(ss?.last_poll_at)}</span></div>
          <div className="ah-row"><span className="k">Last 200 OK</span>
            <span className="v">{relTime(ss?.last_success_at)}</span></div>
          <div className="ah-row"><span className="k">Last status code</span>
            <span className="v">{ss?.last_status_code ?? "—"}</span></div>
          <div className="ah-row"><span className="k">Live window</span>
            <span className="v"><span className={`ah-dot ${ss?.live_window_open ? "ok" : ""}`} />
              {ss?.live_window_open ? "Open" : "Closed"}</span></div>
          <div className="ah-row"><span className="k">Last FT written</span>
            <span className="v">{ss?.last_ft_written || "—"}</span></div>
          <div className="ah-row"><span className="k">Requests today</span>
            <span className="v">{ss?.requests_today ?? 0}</span></div>
        </div>

        <div className="ah-card">
          <h4>Attention</h4>
          {unmapped.length === 0 ? (
            <div className="ah-oknote">✓ All teams mapped — nothing to fix.</div>
          ) : (
            unmapped.map((t) => (
              <div className="ah-warn" key={t.api_team_id}>⚠
                <div><b>Unmapped team</b> — "{t.api_name}" (api id {t.api_team_id}) isn't in{" "}
                  <code>team_map</code>. Its results won't score until mapped in the database.</div>
              </div>
            ))
          )}

          <h4 style={{ marginTop: 18 }}>Poller</h4>
          <p className="ah-sub">
            {paused
              ? "The live poller is paused — no live scores will update."
              : "The live poller runs every minute and self-gates around match windows."}
          </p>
          <button className={`ah-btn ${paused ? "go" : "red"}`} disabled={busy || !ss} onClick={togglePause}>
            {busy ? "…" : paused ? "▶ Resume poller" : "⏸ Pause poller"}
          </button>
          <p className="ah-fineprint">
            Manual score entry under <b>Group Results</b> / <b>Knockout Results</b> stays available as a
            fallback if the feed is down.
          </p>
        </div>
      </div>
    </div>
  );
}

function Admin({ admin, adminScores, setScore, adminKo, onKoToggle, adminRound, setAdminRound, onSaveKo, onSaveScores }) {
  const [view, setView] = useState("commish");
  if (!admin) return (<div className="fade"><div className="head"><div className="h1">🔒 Admin</div></div>
    <div className="empty" style={{ marginTop: 6 }}>🚫 You don't have access to this page.<br />Only the pool commissioners can enter results.</div></div>);
  return (
    <div className="fade">
      <div className="head"><div className="h1">🔒 Admin · Results</div><div className="pill">Commissioner</div></div>
      <div className="lockbar"><span className="ico">🔒</span>
        <span className="txt"><b>Restricted page.</b> Only commissioners can edit this. Add admins from the Supabase dashboard.</span></div>
      <div className="seg"><button className={view === "health" ? "on" : ""} onClick={() => setView("health")}>API Health</button>
        <button className={view === "commish" ? "on" : ""} onClick={() => setView("commish")}>Group Results</button>
        <button className={view === "ko" ? "on" : ""} onClick={() => setView("ko")}>Knockout Results</button></div>
      {view === "health" ? <AdminHealth /> : view === "commish" ? (<>
        <p className="poolnote">Enter the final score for each match as games finish. Winner, points, and goal totals update automatically.</p>
        {GROUPS.map((g) => (<div className="gt-card" key={g.id}>
          <div className="gt-title"><span className="gt-badge">{g.id}</span>Group {g.id}</div>
          {MATCHES.filter((m) => m.group === g.id).map((m) => { const sc = adminScores[m.id] || {};
            let der = "—", dcls = ""; if (sc.h != null && sc.a != null) { const w = sc.h > sc.a ? m.home : sc.a > sc.h ? m.away : "Draw"; der = w === "Draw" ? "Draw" : w + " win"; dcls = "set"; }
            return (<div className="arow" key={m.id}>
              <span className="ateam home"><span className="cn">{m.home}</span><Fl t={m.home} /></span>
              <span className="ascore">
                <input className="sin" type="number" min="0" value={sc.h ?? ""} onChange={(e) => setScore(m.id, "h", e.target.value)} onBlur={onSaveScores} /><b>–</b>
                <input className="sin" type="number" min="0" value={sc.a ?? ""} onChange={(e) => setScore(m.id, "a", e.target.value)} onBlur={onSaveScores} /></span>
              <span className="ateam away"><Fl t={m.away} /><span className="cn">{m.away}</span></span>
              <span className={`ares ${dcls}`}>{der}</span></div>); })}
        </div>))}
      </>) : (<>
        <p className="poolnote">Mark which teams actually advanced to each round. Each round only offers the teams from the previous one, so the bracket fills forward as you go.</p>
        <KnockoutBoard ko={adminKo} onToggle={onKoToggle} round={adminRound} setRound={setAdminRound} locked={false} mode="admin" />
        <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}><button className="btn" onClick={onSaveKo}>Save Knockout Results</button></div>
      </>)}
    </div>
  );
}

// ---------------------------------------------------------------- Notifications (client-side, §3.8)
const _ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const _ncAgo = (ts) => { const s = Math.floor((Date.now() - ts) / 1000); if (s < 60) return "now"; const m = Math.floor(s / 60); if (m < 60) return `${m}m`; const h = Math.floor(m / 60); if (h < 24) return `${h}h`; return `${Math.floor(h / 24)}d`; };

// Derives kickoff / full-time / rank-movement alerts client-side by diffing the
// polled fixtures+results between renders. Surfaces them in an in-app feed and
// (if the user opts in) fires Web Notifications. Server push can replace this
// later via the notifications table; nothing here is persisted.
function NotificationCenter({ fixtures = [], results, everyone = [], userId, locked }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [perm, setPerm] = useState(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  const seen = useRef(new Set());     // dedupe kickoff/FT events by fixture id
  const lastRank = useRef(null);      // last projected rank (movement alerts)
  const inited = useRef(false);       // skip firing for state already present on load

  useEffect(() => {
    if (!locked) return;
    const now = Date.now();
    const gr = results.groupResults;
    const mine = everyone.filter((c) => c.ownerId === userId).sort((a, b) => a.name.localeCompare(b.name));
    const primary = mine[0];
    const gp = primary?.gp || {};
    const fresh = [];
    const push = (key, type, title, body) => { if (seen.current.has(key)) return; seen.current.add(key); fresh.push({ key, type, title, body, ts: now }); };

    const groupCtx = (f) => {
      const m = f.match_id && SCHEDULE.find((s) => s.matchId === f.match_id);
      if (!m) return {};
      const pick = gp[m.matchId];
      const pickTeam = pick ? (pick === "draw" ? "Draw" : pick === "home" ? m.matchHome : m.matchAway) : null;
      const sc = gr[m.matchId] || _appScore(f, m);
      const w = sc ? matchWinner(m, sc) : null;
      return { pickTeam, correct: pick && w ? pick === w : null };
    };

    fixtures.forEach((f) => {
      if (f.status === "NS" && f.kickoff_utc) {
        const mins = Math.round((new Date(f.kickoff_utc).getTime() - now) / 60000);
        if (mins > 0 && mins <= 15) {
          const { pickTeam } = groupCtx(f);
          push(`kick-${f.api_id}`, "kick", `${f.home_team} v ${f.away_team} kicks off soon`,
            `Kicks off in ~${mins} min.${pickTeam ? ` You picked ${pickTeam}.` : ""}`);
        }
      }
      if (f.is_final || FINAL_ST.has(f.status)) {
        const { pickTeam, correct } = groupCtx(f);
        const body = pickTeam == null ? "Result is in."
          : correct ? `Your pick ${pickTeam} was right — +1, now locked.`
          : `Your pick ${pickTeam} didn't land this time.`;
        push(`ft-${f.api_id}`, "ft", `Full time: ${f.home_team} ${f.home_goals ?? 0}–${f.away_goals ?? 0} ${f.away_team}`, body);
      }
    });

    // Rank movement — only on improvement, only while a match is live (provisional).
    if (primary) {
      const liveResults = {};
      fixtures.forEach((f) => {
        if (!f.match_id || f.is_final || !LIVE_ST.has(f.status) || gr[f.match_id]) return;
        const m = SCHEDULE.find((s) => s.matchId === f.match_id);
        const sc = m && _appScore(f, m);
        if (sc) liveResults[f.match_id] = sc;
      });
      const anyLive = Object.keys(liveResults).length > 0;
      const proj = (c) => scoreBreakdown(c.gp, c.ko, { ...gr, ...liveResults }, results.koResults).total;
      const myTotal = proj(primary);
      const rank = 1 + everyone.filter((c) => proj(c) > myTotal).length;
      if (inited.current && anyLive && lastRank.current != null && rank < lastRank.current) {
        push(`move-${rank}-${now}`, "move", `You moved up to ${_ordinal(rank)} (provisional)`,
          `${primary.name} is ${_ordinal(rank)} if live scores hold.`);
      }
      lastRank.current = rank;
    }

    if (!inited.current) { inited.current = true; return; } // seed only; don't surface pre-existing state
    if (fresh.length) {
      setItems((prev) => [...fresh.reverse(), ...prev].slice(0, 30));
      setUnread((u) => u + fresh.length);
      if (perm === "granted") fresh.forEach((n) => { try { new Notification(n.title, { body: n.body, tag: n.key }); } catch { /* ignore */ } });
    }
  }, [fixtures, results, everyone, userId, locked, perm]);

  async function enable() { try { setPerm(await Notification.requestPermission()); } catch { /* ignore */ } }

  return (
    <div className="nc">
      <button className="nc-bell" onClick={() => { setOpen((o) => !o); setUnread(0); }} title="Notifications">
        🔔{unread > 0 && <span className="nc-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (<>
        <div className="nc-backdrop" onClick={() => setOpen(false)} />
        <div className="nc-panel">
          <div className="nc-top"><span>Notifications</span>
            {perm === "default" && <button className="nc-enable" onClick={enable}>Enable browser alerts</button>}
            {perm === "granted" && <span className="nc-state on">Alerts on</span>}
            {perm === "denied" && <span className="nc-state off">Blocked in browser</span>}
          </div>
          <div className="nc-list">
            {items.length === 0
              ? <div className="nc-empty">No alerts yet. Kickoffs, full-time results, and rank moves show up here.</div>
              : items.map((n) => (
                <div className="nt" key={n.key}>
                  <div className={`nc-ico ${n.type}`}>{n.type === "kick" ? "⏰" : n.type === "ft" ? "✅" : "📈"}</div>
                  <div className="tx"><div className="t">{n.title}</div><div className="s">{n.body}</div></div>
                  <span className="ago">{_ncAgo(n.ts)}</span>
                </div>
              ))}
          </div>
        </div>
      </>)}
    </div>
  );
}

// ================================================================ App
export default function App() {
  const [session, setSession] = useState(null);
  const [recovery, setRecovery] = useState(isRecoveryUrl);
  const [ownerName, setOwnerName] = useState("");
  const [userId, setUserId] = useState(null);
  const [admin, setAdmin] = useState(false);
  const [lockAt, setLockAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState("groups");
  const [entries, setEntries] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [picks, setPicks] = useState({}); // { entryId: {gp, ko, tb} }
  const [koRound, setKoRound] = useState("ko32");
  const [everyone, setEveryone] = useState([]);
  const [results, setResults] = useState({ groupResults: {}, koResults: {} });
  const [fixtures, setFixtures] = useState([]);
  const [standings, setStandings] = useState([]);
  const [topScorers, setTopScorers] = useState([]);
  const [adminScores, setAdminScores] = useState({});
  const [adminKo, setAdminKo] = useState(emptyKo());
  const [adminRound, setAdminRound] = useState("ko32");
  const [showRes, setShowRes] = useState(false);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 1600); };
  const locked = lockAt && now >= lockAt.getTime();
  const A = (activeId && picks[activeId]) || { gp: {}, ko: emptyKo(), tb: {} };

  useEffect(() => {
    if (!isConfigured) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  // Live poll: once picks lock (tournament underway), refresh fixtures + results
  // every 30s so the banner, glow, and final ✓/✕ stay current without a reload.
  useEffect(() => {
    if (!session || !locked) return;
    let alive = true;
    const tick = async () => {
      try {
        const [fx, res, stnd, ts] = await Promise.all([
          loadFixtures(), loadResults(), loadStandings(), loadTopScorers().catch(() => topScorers),
        ]);
        if (alive) { setFixtures(fx); setResults(res); setStandings(stnd); setTopScorers(ts); }
      } catch { /* transient — keep last good data */ }
    };
    const t = setInterval(tick, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [session, locked]);

  useEffect(() => {
    if (!session) { setUserId(null); setLoading(false); return; }
    (async () => {
      setLoading(true);
      const user = session.user;
      setUserId(user.id);
      const name = await ensureProfile(user);
      setOwnerName(name);
      const [myEntries, lock, adm, ppl, res, fx, stnd, ts] = await Promise.all([
        loadMyEntries(user.id), getLockAt(), isAdmin(user.id), loadEveryone(), loadResults(),
        loadFixtures().catch(() => []), loadStandings().catch(() => []), loadTopScorers().catch(() => []),
      ]);
      setEntries(myEntries);
      setFixtures(fx);
      setStandings(stnd);
      setTopScorers(ts);
      const map = {};
      await Promise.all(myEntries.map(async (e) => { map[e.id] = await loadEntryPicks(e.id); }));
      Object.keys(map).forEach((id) => { map[id].ko = { ...emptyKo(), ...map[id].ko }; });
      setPicks(map);
      setActiveId(myEntries[0]?.id || null);
      setLockAt(lock); setAdmin(adm); setEveryone(ppl); setResults(res);
      const gs = {}; Object.entries(res.groupResults).forEach(([id, s]) => (gs[id] = { h: s.h, a: s.a }));
      setAdminScores(gs); setAdminKo({ ...emptyKo(), ...res.koResults });
      setLoading(false);
    })();
  }, [session]);

  function pickMatch(id, side) {
    if (locked || !activeId) return;
    setPicks((p) => ({ ...p, [activeId]: { ...p[activeId], gp: { ...p[activeId].gp, [id]: side } } }));
  }
  function toggleTeamPick(round, team) {
    if (locked || !activeId) return;
    setPicks((p) => ({ ...p, [activeId]: { ...p[activeId], ko: toggleKo(p[activeId].ko, round, team) } }));
  }
  function setTb(newTb) { setPicks((p) => ({ ...p, [activeId]: { ...p[activeId], tb: newTb } })); }

  async function refreshEveryone() { setEveryone(await loadEveryone()); }
  async function saveGroups() { await saveGroupPicks(activeId, A.gp); setToast("group-saved"); setTimeout(() => setToast(""), 5000); }
  async function saveKnockoutsAll() { await saveKnockoutPicks(activeId, A.ko); await saveTiebreakers(activeId, A.tb); flash("Knockout picks saved"); }

  async function onCreateEntry(name) {
    try {
      const e = await createEntry(userId, name);
      setEntries((arr) => [...arr, e]);
      setPicks((p) => ({ ...p, [e.id]: { gp: {}, ko: emptyKo(), tb: {} } }));
      setActiveId(e.id);
      refreshEveryone();
    } catch (err) { flash(err.message || "Could not create entry"); }
  }
  async function onDeleteEntry(id) {
    await deleteEntry(id);
    setEntries((arr) => arr.filter((e) => e.id !== id));
    setPicks((p) => { const c = { ...p }; delete c[id]; return c; });
    setActiveId((cur) => (cur === id ? (entries.find((e) => e.id !== id)?.id || null) : cur));
    refreshEveryone();
  }

  function adminSetScore(id, side, val) {
    setAdminScores((s) => { const cur = { ...(s[id] || {}) }; cur[side] = val === "" ? null : Math.max(0, parseInt(val, 10) || 0); return { ...s, [id]: cur }; });
  }
  async function adminSaveScores() {
    const tasks = [];
    Object.entries(adminScores).forEach(([id, s]) => { if (s && s.h != null && s.a != null) tasks.push(saveGroupResult(id, s.h, s.a)); });
    await Promise.all(tasks); setResults(await loadResults()); flash("Results saved");
  }
  function adminToggleKo(round, team) { setAdminKo((k) => toggleKo(k, round, team)); }
  async function adminSaveKo() { await saveKnockoutResults(adminKo); setResults(await loadResults()); flash("Knockout results saved"); }

  if (!isConfigured) return (<div className="auth"><div className="pitch-deco" />
    <h1 className="wordmark" style={{ fontSize: 40 }}>Setup needed</h1>
    <p className="sub">Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see README) and reload.</p></div>);
  if (recovery) return <ResetPassword onDone={() => setRecovery(false)} />;
  if (loading) return (<div className="auth"><div className="pitch-deco" /><p className="sub">Loading…</p></div>);
  if (!session) return <AuthScreen />;

  const tabs = [["groups", "Matchday"], ["knockouts", "Knockouts"], ["reveal", "Everyone's Picks"],
    ["leaderboard", "Leaderboard"], ["standings", "Standings"], ["rules", "Rules"]];
  if (admin) tabs.push(["admin", "🔒 Admin"]);
  const editing = tab === "groups" || tab === "knockouts";
  const showSave = editing && !locked && activeId;
  const noEntry = editing && !activeId;

  return (
    <>
      <div className="top">
        <div className="top-in"><div className="logo">WC<b>26</b> Pick'Em</div>
          <div className="top-right">
            <NotificationCenter fixtures={fixtures} results={results} everyone={everyone} userId={userId} locked={locked} />
            <div className="who">{ownerName} · <a style={{ color: "var(--blue)", cursor: "pointer" }} onClick={() => signOut()}>sign out</a></div>
          </div></div>
        <div className="tabs">{tabs.map(([k, l]) => (<button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>))}</div>
      </div>

      <div className={"wrap" + (tab === "reveal" ? " wide" : "")}>
        {editing && (<><EntryBar entries={entries} activeId={activeId} setActive={setActiveId}
          onCreate={onCreateEntry} onDelete={onDeleteEntry} locked={locked} />
          <LockBar lockAt={lockAt} now={now} /></>)}
        {noEntry && <div className="empty" style={{ marginTop: 14 }}>Create an entry above to start making picks. You can have up to {MAX_ENTRIES}.</div>}

        {tab === "groups" && activeId && (locked
          ? <MatchdayDashboard gp={A.gp} ko={A.ko} fixtures={fixtures} results={results} />
          : <GroupStage gp={A.gp} onPick={pickMatch} locked={locked} />)}
        {tab === "knockouts" && activeId && <KnockoutBoard ko={A.ko} onToggle={toggleTeamPick} round={koRound} setRound={setKoRound} locked={locked} tb={A.tb} setTb={setTb} />}
        {tab === "reveal" && <Reveal everyone={everyone} myUserId={userId} results={results} locked={locked} showRes={showRes} setShowRes={setShowRes} fixtures={fixtures} topScorers={topScorers} />}
        {tab === "leaderboard" && <Leaderboard everyone={everyone} myUserId={userId} results={results} fixtures={fixtures} topScorers={topScorers} />}
        {tab === "standings" && <Standings standings={standings} fixtures={fixtures} results={results} entries={entries} picks={picks} defaultEntryId={activeId} />}
        {tab === "rules" && <Rules />}
        {tab === "admin" && <Admin admin={admin} adminScores={adminScores} setScore={adminSetScore}
          adminKo={adminKo} onKoToggle={adminToggleKo} adminRound={adminRound} setAdminRound={setAdminRound}
          onSaveKo={adminSaveKo} onSaveScores={adminSaveScores} />}
      </div>

      {showSave && (<div className="savebar"><button className="btn" onClick={tab === "groups" ? saveGroups : saveKnockoutsAll}>
        Save {tab === "groups" ? "Group" : "Knockout"} Picks</button></div>)}
      {toast === "group-saved" && (
        <div className="toast toast-rich">
          <span className="toast-icon">✅</span>
          <div className="toast-body">
            <strong>Group picks saved!</strong>
            <span>Don't forget to pick your Round of 32 teams in Knockouts.</span>
          </div>
          <button className="toast-cta" onClick={() => { setTab("knockouts"); setToast(""); }}>Go →</button>
        </div>
      )}
      {toast && toast !== "group-saved" && <div className="toast">{toast}</div>}
    </>
  );
}
