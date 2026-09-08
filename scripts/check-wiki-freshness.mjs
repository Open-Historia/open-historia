/*! Open Historia — wiki freshness check © 2026 Nicholas Krol, MIT. */
// Answers "what in the wiki needs updating?" without anyone re-reading the game.
//
// wiki/provenance.json records the two commits the wiki was last verified against and, per page,
// the source paths whose behaviour that page describes. This diffs those commits against the
// current tips of upstream/main and upstream/beta, maps the changed files onto pages, and prints
// the pages to review — plus the commit subjects behind them, so you can judge which changes
// actually matter rather than re-reading everything.
//
// Run: npm run wiki:check        (add --fetch to update the remote refs first)
//
// The runbook this belongs to is docs/wiki.md.
//
// It exits 0 when the wiki is current and 1 when pages need review, so CI could gate on it, but
// it is written to be read by a person: the useful output is the list, not the exit code.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const provPath = path.join(root, "wiki", "provenance.json");
const REMOTE = "upstream";

if (!existsSync(provPath)) {
  console.error("wiki/provenance.json is missing — it is what records the commits the wiki was checked against.");
  process.exit(1);
}
const prov = JSON.parse(readFileSync(provPath, "utf8"));

const git = (...args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    return { error: String(error.stderr || error.message || error).trim() };
  }
};

if (process.argv.includes("--fetch")) {
  process.stdout.write(`Fetching ${REMOTE}… `);
  const out = git("fetch", REMOTE);
  console.log(out && out.error ? `failed: ${out.error}` : "done");
}

const bold = (s) => `[1m${s}[0m`;
const dim = (s) => `[2m${s}[0m`;

// A page cites a directory as often as a file (src/Editor, mobile), so a changed path counts as
// a hit when it IS the cited path or sits underneath it.
const touches = (changed, cited) => changed === cited || changed.startsWith(cited.endsWith("/") ? cited : cited + "/");

let anyStale = false;
const affected = new Map();   // page -> Set of reasons ("main: src/…")

for (const channel of ["main", "beta"]) {
  const was = prov.verifiedAgainst?.[channel];
  const ref = `${REMOTE}/${channel}`;
  const now = git("rev-parse", ref);

  console.log(`\n${bold(channel)}`);
  if (!was) { console.log("  no recorded commit — add one to wiki/provenance.json"); continue; }
  if (now.error) { console.log(`  cannot read ${ref}: ${now.error}`); continue; }

  if (now === was) {
    console.log(`  up to date at ${was.slice(0, 8)} — nothing has landed since the wiki was checked`);
    continue;
  }
  anyStale = true;

  const log = git("log", "--oneline", `${was}..${now}`);
  const commits = log.error ? [] : log.split("\n").filter(Boolean);
  console.log(`  ${was.slice(0, 8)} → ${now.slice(0, 8)}  (${commits.length} commit${commits.length === 1 ? "" : "s"})`);

  const diff = git("diff", "--name-only", `${was}..${now}`);
  const changed = diff.error ? [] : diff.split("\n").filter(Boolean);
  console.log(`  ${changed.length} file${changed.length === 1 ? "" : "s"} changed`);

  for (const [page, sources] of Object.entries(prov.pages || {})) {
    // A page re-read against a newer commit than the global record is not stale for this
    // channel, even though files it cites changed. That is the whole point of a partial pass:
    // updating five pages should not require re-reading the other twenty-five to clear the list.
    if (prov.pageVerified?.[page]?.[channel] === now) continue;
    const hits = changed.filter((f) => sources.some((s) => touches(f, s)));
    if (hits.length === 0) continue;
    if (!affected.has(page)) affected.set(page, new Set());
    for (const h of hits.slice(0, 6)) affected.get(page).add(`${channel}: ${h}`);
  }

  if (commits.length > 0) {
    console.log(dim("  recent commits:"));
    for (const c of commits.slice(0, 12)) console.log(dim(`    ${c}`));
    if (commits.length > 12) console.log(dim(`    …and ${commits.length - 12} more`));
  }
}

const partial = Object.entries(prov.pageVerified || {}).filter(([page]) => !page.startsWith("_"));
if (partial.length > 0) {
  console.log(`
${bold("Verified ahead of the global record")} ${dim("(pageVerified in provenance.json)")}`);
  for (const [page, refs] of partial) {
    const which = Object.entries(refs).map(([c, sha]) => `${c} ${String(sha).slice(0, 8)}`).join(" · ");
    console.log(`  ${page} ${dim(which)}`);
  }
}

if (affected.size === 0) {
  console.log(anyStale
    ? "\nNothing the wiki cites has changed. Move verifiedAgainst forward and you are done."
    : "\nWiki is current.");
} else {
  console.log(`\n${bold(`${affected.size} page(s) to review`)}`);
  for (const [page, reasons] of [...affected].sort()) {
    console.log(`\n  ${bold(page)}`);
    for (const r of reasons) console.log(`    ${dim(r)}`);
  }
  console.log(`\n  Re-read each page against the changed files, re-take any screenshot the change`);
  console.log(`  affects, then move verifiedAgainst in wiki/provenance.json to the new commits.`);
}

// Staged screenshots are worth re-taking whenever a real campaign is available, whether or not
// anything changed — they show authored state, not played state.
const staged = Object.entries(prov.images || {}).filter(([, v]) => v && v.staged);
if (staged.length > 0) {
  console.log(`\n${bold("Staged screenshots")} ${dim("(authored state — replace from a real campaign when you can)")}`);
  for (const [name, meta] of staged) console.log(`  ${name}${meta.note ? dim(` — ${meta.note}`) : ""}`);
}

if (Array.isArray(prov.knownGaps) && prov.knownGaps.length > 0) {
  console.log(`\n${bold("Known gaps")}`);
  for (const g of prov.knownGaps) console.log(`  · ${g}`);
}

process.exit(affected.size > 0 ? 1 : 0);
