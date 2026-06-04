import React, { useEffect, useState } from "react";
import {
  GROUPS, MATCHES, TOTAL_MATCHES, KO, ALL_TEAMS,
  FLAG, poolFor, syncCascade, scoreBreakdown, teamGoals, matchWinner, emptyKo,
} from "./data.js";
import {
  isConfigured, supabase, MAX_ENTRIES, signUp, signIn, signOut, ensureProfile, isAdmin,
  getLockAt, loadMyEntries, createEntry, deleteEntry, loadEntryPicks,
  saveGroupPicks, saveKnockoutPicks, saveTiebreakers,
  loadEveryone, loadResults, saveGroupResult, saveKnockoutResults,
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
      {msg && <p className="note" style={{ marginTop: 12, color: "var(--red)" }}>{msg}</p>}
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
      ) : (
        <div className="chips">{pool.map((t) => { const on = sel.includes(t); const lock = !on && sel.length >= r.count;
          return (<button key={t} className={`chip ${on ? "sel" : ""} ${lock ? "lock" : ""}`} disabled={locked}
            onClick={() => onToggle(round, t)}><Fl t={t} /><span className="cn">{t}</span></button>); })}</div>
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

// ---------------------------------------------------------------- Reveal
function Reveal({ everyone, myUserId, results, locked, showRes, setShowRes }) {
  const [sub, setSub] = useState("groups");
  const gr = results.groupResults, kr = results.koResults;
  if (!locked) {
    return (<div className="fade"><div className="head"><div className="h1">Everyone's Picks</div><div className="pill">Hidden</div></div>
      <div className="lockbar"><span className="ico">👀</span>
        <span className="txt"><b>Hidden until kickoff.</b> Everyone&rsquo;s picks reveal once the opening match starts, so nobody can copy.</span></div></div>);
  }
  const cols = everyone;
  const goals = teamGoals(gr);
  const topGoals = Object.entries(goals).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const wfRounds = [["ko32", "Last 32"], ["ro16", "Last 16"], ["ro8", "Quarterfinalists"],
    ["ro4", "Semifinalists"], ["ro2", "Finalists"], ["third", "3rd Place"], ["champ", "Champion"]];
  return (
    <div className="fade">
      <div className="head"><div className="h1">Everyone's Picks</div><div className="pill">Live</div></div>
      <div className="seg">
        <button className={sub === "groups" ? "on" : ""} onClick={() => setSub("groups")}>Group Stage</button>
        <button className={sub === "ko" ? "on" : ""} onClick={() => setSub("ko")}>Knockouts</button></div>
      <div className="res-row">
        <button className={`res-btn ${showRes ? "on" : ""}`} onClick={() => setShowRes(!showRes)}>{showRes ? "✓ Showing results" : "Show results"}</button>
        <span className="note">Correct picks turn green, wrong ones get crossed out, with a points tally — once results are entered.</span></div>
      {sub === "groups" ? (<>
        {showRes && topGoals.length > 0 && (
          <div className="goalbar"><span className="gb-lab">⚽ Most goals (group stage) — feeds the top-scoring-team tiebreaker</span>
            <div className="gb-chips">{topGoals.map(([t, g]) => (<span className="gb-chip" key={t}><Fl t={t} /><span className="cn">{t}</span><b>{g}</b></span>))}</div></div>)}
        {GROUPS.map((g) => { const ms = MATCHES.filter((m) => m.group === g.id);
          return (<div className="gt-card" key={g.id}><div className="gt-title"><span className="gt-badge">{g.id}</span>Group {g.id}</div>
            <div className="rt-wrap"><table className="gt"><thead><tr><th className="pc">Entry</th>
              {ms.map((m) => { const sc = showRes ? gr[m.id] : null; const w = sc ? matchWinner(m, sc) : null;
                return (<th className="mh" key={m.id}>
                  <span className={`mh-t ${w === "home" ? "win" : ""}`}><Fl t={m.home} /><span className="cn">{m.home}</span>{w === "home" && <span className="wmk">✓</span>}</span>
                  {sc ? <span className="mh-v score">{sc.h}–{sc.a}</span> : <span className="mh-v">vs</span>}
                  <span className={`mh-t ${w === "away" ? "win" : ""}`}><Fl t={m.away} /><span className="cn">{m.away}</span>{w === "away" && <span className="wmk">✓</span>}</span>
                  {w === "draw" && <span className="mh-res">Draw</span>}</th>); })}
            </tr></thead><tbody>
              {cols.map((c) => { let pts = 0;
                const cells = ms.map((m) => { const pk = c.gp[m.id]; const sc = showRes ? gr[m.id] : null; const w = sc ? matchWinner(m, sc) : null;
                  if (sc && pk && pk === w) pts++;
                  if (!pk) return <td key={m.id}><span className="pk none">·</span></td>;
                  const teamPicked = pk === "draw" ? null : pk === "home" ? m.home : m.away;
                  const inner = pk === "draw" ? <span className="cn">Draw</span> : <><Fl t={teamPicked} /><span className="cn">{teamPicked}</span></>;
                  let cls = pk === "draw" ? "pk draw" : "pk"; let mk = null;
                  if (sc && w) { const ok = pk === w; cls += ok ? " correct" : " out"; mk = <span className="mk">{ok ? "✓" : "✕"}</span>; }
                  return <td key={m.id}><span className={cls}>{inner}{mk}</span></td>; });
                return (<tr className={c.ownerId === myUserId ? "me" : ""} key={c.id}>
                  <td className="pc"><div>{c.name}</div><div className="owner">{c.owner}</div>{showRes && <span className="gpts">{pts} pt</span>}</td>{cells}</tr>); })}
            </tbody></table></div></div>); })}
        <div className="legend"><span>Each cell = that entry's predicted winner</span>{showRes ? <span>✓ correct · ✕ wrong — 1 pt per correct</span> : <span>· = no pick yet</span>}</div>
      </>) : (
        cols.map((c) => (<div className="wf-player" key={c.id}>
          <div className="wf-name">{c.name} <span className="owner">· {c.owner}</span></div>
          <div className="wf-cols">{wfRounds.map(([k, lab]) => { const list = c.ko[k] || [];
            return (<div className={`wf-col ${k === "champ" ? "champ" : ""} ${k === "ko32" ? "wide" : ""}`} key={k}>
              <h5>{lab}<b>{list.length}</b></h5><div className="wf-stack">
                {list.length ? list.map((t) => { let cls = "wf-team", mk = null;
                  if (showRes) { const ok = (kr[k] || []).includes(t); cls += ok ? " correct" : " out"; mk = <span className="mk">{ok ? "✓" : "✕"}</span>; }
                  return <div className={cls} key={t}><Fl t={t} /><span className="cn">{t}</span>{mk}</div>; }) : <div className="wf-team empty">—</div>}
              </div></div>); })}</div></div>))
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Leaderboard
function Leaderboard({ everyone, myUserId, results }) {
  const board = everyone.map((c) => ({ id: c.id, name: c.name, owner: c.owner, me: c.ownerId === myUserId,
    ...scoreBreakdown(c.gp, c.ko, results.groupResults, results.koResults) })).sort((a, b) => b.total - a.total);
  const BD = [["GR", "GR"], ["R32", "R32"], ["R16", "R16"], ["QF", "QF"], ["SF", "SF"], ["TH", "3RD"], ["FN", "FIN"]];
  return (
    <div className="fade">
      <div className="head"><div className="h1">Leaderboard</div><div className="pill">Live standings</div></div>
      <div className="card">{board.map((p, i) => (
        <div className={`lb-row ${p.me ? "me" : ""}`} key={p.id}>
          <div className="lb-rank">{i + 1}</div>
          <div className="lb-main"><div className="lb-name">{p.name} <span className="owner">· {p.owner}</span></div>
            <div className="lb-bd">{BD.map(([k, lab]) => <span className="bd" key={k}>{lab} <b>{p[k]}</b></span>)}</div></div>
          <div className="lb-score">{p.total}</div></div>))}
        {board.length === 0 && <p className="note">No entries yet.</p>}</div>
      <p className="note">Breakdown by stage — GR group · R32/R16/QF/SF teams correct each round · 3RD third-place · FIN finalists + champion. Updates from entered results.</p>
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

function Admin({ admin, adminScores, setScore, adminKo, onKoToggle, adminRound, setAdminRound, onSaveKo, onSaveScores }) {
  const [view, setView] = useState("commish");
  if (!admin) return (<div className="fade"><div className="head"><div className="h1">🔒 Admin</div></div>
    <div className="empty" style={{ marginTop: 6 }}>🚫 You don't have access to this page.<br />Only the pool commissioners can enter results.</div></div>);
  return (
    <div className="fade">
      <div className="head"><div className="h1">🔒 Admin · Results</div><div className="pill">Commissioner</div></div>
      <div className="lockbar"><span className="ico">🔒</span>
        <span className="txt"><b>Restricted page.</b> Only commissioners can edit this. Add admins from the Supabase dashboard.</span></div>
      <div className="seg"><button className={view === "commish" ? "on" : ""} onClick={() => setView("commish")}>Group Results</button>
        <button className={view === "ko" ? "on" : ""} onClick={() => setView("ko")}>Knockout Results</button></div>
      {view === "commish" ? (<>
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

// ================================================================ App
export default function App() {
  const [session, setSession] = useState(null);
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
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    if (!session) { setUserId(null); setLoading(false); return; }
    (async () => {
      setLoading(true);
      const user = session.user;
      setUserId(user.id);
      const name = await ensureProfile(user);
      setOwnerName(name);
      const [myEntries, lock, adm, ppl, res] = await Promise.all([
        loadMyEntries(user.id), getLockAt(), isAdmin(user.id), loadEveryone(), loadResults(),
      ]);
      setEntries(myEntries);
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
  async function saveGroups() { await saveGroupPicks(activeId, A.gp); flash("Group picks saved"); }
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
  if (loading) return (<div className="auth"><div className="pitch-deco" /><p className="sub">Loading…</p></div>);
  if (!session) return <AuthScreen />;

  const tabs = [["groups", "Group Stage"], ["knockouts", "Knockouts"], ["reveal", "Everyone's Picks"],
    ["leaderboard", "Leaderboard"], ["rules", "Rules"]];
  if (admin) tabs.push(["admin", "🔒 Admin"]);
  const editing = tab === "groups" || tab === "knockouts";
  const showSave = editing && !locked && activeId;
  const noEntry = editing && !activeId;

  return (
    <>
      <div className="top">
        <div className="top-in"><div className="logo">WC<b>26</b> Pick'Em</div>
          <div className="who">{ownerName} · <a style={{ color: "var(--blue)", cursor: "pointer" }} onClick={() => signOut()}>sign out</a></div></div>
        <div className="tabs">{tabs.map(([k, l]) => (<button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>))}</div>
      </div>

      <div className={"wrap" + (tab === "reveal" ? " wide" : "")}>
        {editing && (<><EntryBar entries={entries} activeId={activeId} setActive={setActiveId}
          onCreate={onCreateEntry} onDelete={onDeleteEntry} locked={locked} />
          <LockBar lockAt={lockAt} now={now} /></>)}
        {noEntry && <div className="empty" style={{ marginTop: 14 }}>Create an entry above to start making picks. You can have up to {MAX_ENTRIES}.</div>}

        {tab === "groups" && activeId && <GroupStage gp={A.gp} onPick={pickMatch} locked={locked} />}
        {tab === "knockouts" && activeId && <KnockoutBoard ko={A.ko} onToggle={toggleTeamPick} round={koRound} setRound={setKoRound} locked={locked} tb={A.tb} setTb={setTb} />}
        {tab === "reveal" && <Reveal everyone={everyone} myUserId={userId} results={results} locked={locked} showRes={showRes} setShowRes={setShowRes} />}
        {tab === "leaderboard" && <Leaderboard everyone={everyone} myUserId={userId} results={results} />}
        {tab === "rules" && <Rules />}
        {tab === "admin" && <Admin admin={admin} adminScores={adminScores} setScore={adminSetScore}
          adminKo={adminKo} onKoToggle={adminToggleKo} adminRound={adminRound} setAdminRound={setAdminRound}
          onSaveKo={adminSaveKo} onSaveScores={adminSaveScores} />}
      </div>

      {showSave && (<div className="savebar"><button className="btn" onClick={tab === "groups" ? saveGroups : saveKnockoutsAll}>
        Save {tab === "groups" ? "Group" : "Knockout"} Picks</button></div>)}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
