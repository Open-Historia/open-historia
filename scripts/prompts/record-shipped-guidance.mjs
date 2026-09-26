/*! Open Historia — records the default guidance the game ships © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Records every default guidance passage this tree ships in
// src/Game/AI/shippedGuidance.js: the English defaults (promptGuidance.js over
// defaultPrompts.json) and every shipped translation of one
// (public/lang/prompts/<code>.json).
//
// The list only grows. A stored prompt pack holds the author's edits alone,
// but "Export all prompts" writes every passage, so a scenario that imported
// such a file stored the defaults of the version that made it as if the author
// had written them. normalizePackGuidance drops any passage recorded here, so
// that scenario, and every game played from it, runs the current defaults
// instead of pinning the old ones. For that, every version has to recognise
// what every other version shipped — alpha's, beta's and main's, old and new:
// run this whenever a default passage or a prompt pack changes
// (promptGuidance.test.js fails until you do), and never remove a line.
//
//   node scripts/prompts/record-shipped-guidance.mjs
//   node scripts/prompts/record-shipped-guidance.mjs --history [<ref> …]
//   node scripts/prompts/record-shipped-guidance.mjs --also passages.json
//
// --history also records every version of the defaults and of the prompt
// packs that the given refs' histories hold (default: alpha, beta and main,
// as origin/<name> where fetched, else the local branch). Run it after
// merging one branch into another — alpha into beta, beta into main — so the
// merged tree recognises the defaults both sides ever shipped. The list is
// one fingerprint per line and .gitattributes merges it with git's union
// driver, so a merge keeps both sides' lines; --history is the repair if a
// conflict was ever resolved by taking one side.
//
// --also records the passages in a JSON array of strings too.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../..");
const LIST_FILE = path.join(ROOT, "src/Game/AI/shippedGuidance.js");
const AI_DIR = "src/Game/AI";

const { buildGuidanceDefaults, guidanceFingerprint } = await import(url.pathToFileURL(path.join(ROOT, AI_DIR, "promptGuidance.js")).href);
const { SHIPPED_GUIDANCE_FINGERPRINTS } = await import(url.pathToFileURL(LIST_FILE).href);

const passages = [];
const walk = (value) => {
  if (typeof value === "string") {
    if (value.trim()) passages.push(value);
  } else if (value && typeof value === "object") Object.values(value).forEach(walk);
};
walk(buildGuidanceDefaults(JSON.parse(fs.readFileSync(path.join(ROOT, AI_DIR, "defaultPrompts.json"), "utf8"))));
const english = passages.length;

const packDir = path.join(ROOT, "public/lang/prompts");
for (const file of fs.existsSync(packDir) ? fs.readdirSync(packDir) : []) {
  if (!file.endsWith(".json") || file === "catalog-en.json") continue;
  walk(JSON.parse(fs.readFileSync(path.join(packDir, file), "utf8")));
}
const translated = passages.length - english;

const args = process.argv.slice(2);
const historyRefs = [];
let history = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--also" && args[i + 1]) walk(JSON.parse(fs.readFileSync(path.resolve(args[(i += 1)]), "utf8")));
  else if (args[i] === "--history") {
    history = true;
    while (args[i + 1] && !args[i + 1].startsWith("--")) historyRefs.push(args[(i += 1)]);
  }
}

// Every version of the defaults and the prompt packs in the refs' histories.
if (history) {
  const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: ROOT, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  const tryGit = (...gitArgs) => { try { return git(...gitArgs); } catch { return null; } };
  const refs = historyRefs.length
    ? historyRefs
    : ["alpha", "beta", "main"].map((name) => (tryGit("rev-parse", "--verify", "--quiet", `origin/${name}`) ? `origin/${name}` : tryGit("rev-parse", "--verify", "--quiet", name) ? name : null)).filter(Boolean);
  if (!refs.length) throw new Error("--history: no alpha, beta or main ref found; name the refs to read");
  const before = passages.length;
  const commits = new Set(git("log", "--format=%H", ...refs, "--", `${AI_DIR}/defaultPrompts.json`, `${AI_DIR}/promptGuidance.js`, `${AI_DIR}/formerTaskKeys.js`).split("\n").filter(Boolean));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "oh-guidance-"));
  let versions = 0;
  try {
    for (const sha of commits) {
      const defaults = tryGit("show", `${sha}:${AI_DIR}/defaultPrompts.json`);
      if (!defaults || tryGit("cat-file", "-e", `${sha}:${AI_DIR}/promptGuidance.js`) === null) continue;
      // The version's promptGuidance.js and the modules it imports, as they were.
      const dir = path.join(scratch, sha, AI_DIR);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(scratch, sha, "package.json"), JSON.stringify({ type: "module" }));
      const queue = ["promptGuidance.js"];
      const copied = new Set();
      let complete = true;
      while (queue.length && complete) {
        const rel = queue.shift();
        if (copied.has(rel)) continue;
        copied.add(rel);
        const code = tryGit("show", `${sha}:${path.posix.join(AI_DIR, rel)}`);
        if (code == null) { complete = false; break; }
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), code);
        for (const m of code.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
          const next = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
          if (next.startsWith("..")) { complete = false; break; }
          queue.push(next);
        }
      }
      if (!complete) {
        console.warn(`  ${sha.slice(0, 10)}: promptGuidance.js imports outside ${AI_DIR}; skipped`);
        continue;
      }
      const mod = await import(url.pathToFileURL(path.join(dir, "promptGuidance.js")).href);
      if (typeof mod.buildGuidanceDefaults !== "function") continue;
      walk(mod.buildGuidanceDefaults(JSON.parse(defaults)));
      versions += 1;
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  const packCommits = new Set(git("log", "--format=%H", ...refs, "--", "public/lang/prompts").split("\n").filter(Boolean));
  for (const sha of packCommits) {
    const listing = (tryGit("ls-tree", "--name-only", `${sha}:public/lang/prompts`) ?? "").split("\n").filter((name) => name.endsWith(".json") && name !== "catalog-en.json");
    for (const file of listing) {
      try {
        const pack = JSON.parse(tryGit("show", `${sha}:public/lang/prompts/${file}`) ?? "null");
        if (pack && typeof pack === "object" && !Array.isArray(pack)) walk(pack);
      } catch { /* not a pack */ }
    }
  }
  console.log(`history of ${refs.join(", ")}: ${versions} versions of the defaults, ${packCommits.size} of the prompt packs, ${passages.length - before} passages`);
}

const before = SHIPPED_GUIDANCE_FINGERPRINTS.size;
const all = [...new Set([...SHIPPED_GUIDANCE_FINGERPRINTS, ...passages.map(guidanceFingerprint)])].sort();

const header = `/*! Open Historia — every default guidance passage the game has shipped © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Written by scripts/prompts/record-shipped-guidance.mjs; do not edit by hand,
// and never remove an entry. The fingerprints (guidanceFingerprint in
// promptGuidance.js) of every default guidance passage any version of the game
// has shipped, on alpha, beta and main, in English and in each shipped
// translation. A stored pack's passage that matches one is a copied default,
// not the author's writing, and gives way to the current default
// (normalizePackGuidance). One fingerprint per line: .gitattributes merges
// this file with git's union driver, so merging one branch into another keeps
// both sides' entries.
`;
fs.writeFileSync(
  LIST_FILE,
  `${header}const FINGERPRINTS = [\n${all.map((fingerprint) => `  "${fingerprint}",`).join("\n")}\n];\n\nexport const SHIPPED_GUIDANCE_FINGERPRINTS = new Set(FINGERPRINTS);\n`.replace(/\n/g, "\r\n"),
);
console.log(`${english} English and ${translated} translated passages in this tree; ${all.length - before} new; ${all.length} recorded`);
