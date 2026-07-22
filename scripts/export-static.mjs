/**
 * Export all Supabase data to src/static-data.json for the static archive build.
 * Run: node scripts/export-static.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = "https://gscoylhcwyxwnjxqcqdt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzY295bGhjd3l4d25qeHFjcWR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMjU1MTgsImV4cCI6MjA5MzcwMTUxOH0.0PfOrdLPUH2iO5TShgDgyFzRiXxmfQoStdO5MGpYFZE";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function fetchAll(table, columns) {
  const step = 1000;
  let from = 0, all = [], chunk;
  do {
    const { data, error } = await sb.from(table).select(columns).range(from, from + step - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    chunk = data || [];
    all = all.concat(chunk);
    from += chunk.length;
  } while (chunk.length === step);
  return all;
}

console.log("Exporting Supabase data...");

const [
  entries, profiles, groupPredictions, groupResults,
  knockoutPredictions, knockoutResults, tiebreakers,
  fixtures, topScorers, standings,
] = await Promise.all([
  fetchAll("entries",              "id,name,user_id"),
  fetchAll("profiles",             "id,display_name"),
  fetchAll("group_predictions",    "entry_id,match_id,pick"),
  fetchAll("group_results",        "match_id,home_goals,away_goals"),
  fetchAll("knockout_predictions", "entry_id,round,team"),
  fetchAll("knockout_results",     "round,team"),
  fetchAll("tiebreakers",          "entry_id,final_total_goals,top_scoring_team,top_scorer"),
  fetchAll("api_fixtures",         "api_id,match_id,grp,round,kickoff_utc,home_team,away_team,status,elapsed,home_goals,away_goals,is_final"),
  sb.from("top_scorers").select("rank,player,team,goals,assists").order("rank").then(r => r.data || []),
  fetchAll("standings_cache",      "grp,rank,app_team,logo,played,win,draw,lose,gf,ga,gd,points,form"),
]);

const out = {
  entries, profiles, groupPredictions, groupResults,
  knockoutPredictions, knockoutResults, tiebreakers,
  fixtures, topScorers, standings,
  exportedAt: new Date().toISOString(),
};

const path = join(__dir, "../src/static-data.json");
writeFileSync(path, JSON.stringify(out, null, 2));

console.log(`✓ Exported to src/static-data.json`);
console.log(`  entries: ${entries.length}`);
console.log(`  profiles: ${profiles.length}`);
console.log(`  group_predictions: ${groupPredictions.length}`);
console.log(`  group_results: ${groupResults.length}`);
console.log(`  knockout_predictions: ${knockoutPredictions.length}`);
console.log(`  knockout_results: ${knockoutResults.length}`);
console.log(`  tiebreakers: ${tiebreakers.length}`);
console.log(`  fixtures: ${fixtures.length}`);
console.log(`  top_scorers: ${topScorers.length}`);
console.log(`  standings: ${standings.length}`);
