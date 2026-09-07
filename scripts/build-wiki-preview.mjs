/*! Open Historia — relocatable wiki preview © 2026 Nicholas Krol, MIT. */
// Builds dist-wiki-preview/: the wiki as a self-contained folder that works from ANY location —
// a domain root, a GitHub Pages subpath, a shared drive, even opened straight off disk.
//
// Why this exists: the real wiki is served from the site root, so it addresses everything
// absolutely (/wiki.css, /wiki/espionage/, /wiki/img/…) — about 1,500 references. Put that on
// seventhdread.github.io/open-historia/ and every one of them resolves to the wrong place. This
// rewrites them to relative paths so the same pages can be hosted anywhere without touching the
// real site or needing access to its Cloudflare project.
//
// Links that belong to the GAME rather than the wiki (/, /play/, the landing-page anchors) are
// pointed at openhistoria.com instead, so they still go somewhere useful from a preview.
//
// Run: npm run wiki:preview        (runs build:wiki first)
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync, cpSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const wikiOut = path.join(root, "public", "wiki");
const cssFile = path.join(root, "public", "wiki.css");
const logoFile = path.join(root, "public", "logo.png");
const outDir = path.join(root, "dist-wiki-preview");
const LIVE = "https://openhistoria.com";

if (!existsSync(wikiOut)) {
  console.error("public/wiki/ is missing — run `npm run build:wiki` first.");
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(wikiOut, outDir, { recursive: true });
if (existsSync(cssFile)) cpSync(cssFile, path.join(outDir, "wiki.css"));
if (existsSync(logoFile)) cpSync(logoFile, path.join(outDir, "logo.png"));

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});

const pages = walk(outDir).filter((f) => f.endsWith(".html"));
let rewritten = 0;

for (const file of pages) {
  // How far this page sits below the bundle root: "" at the top, "../" one level down.
  const depth = path.relative(outDir, path.dirname(file)).split(path.sep).filter(Boolean).length;
  const up = depth === 0 ? "" : "../".repeat(depth);

  let html = readFileSync(file, "utf8");
  const before = html;

  html = html
    // Wiki-internal targets become relative to this page.
    .replace(/(href|src)="\/wiki\/img\//g, `$1="${up}img/`)
    .replace(/(href|src)="\/wiki\/([a-z0-9-]+)\//g, `$1="${up}$2/`)
    .replace(/(href|src)="\/wiki\/"/g, `$1="${up}index.html"`)
    .replace(/(href|src)="\/wiki\.css"/g, `$1="${up}wiki.css"`)
    .replace(/(href|src)="\/logo\.png"/g, `$1="${up}logo.png"`)
    // Anything still absolute belongs to the live site, not to this bundle.
    .replace(/(href|src)="\/(#[^"]*)"/g, `$1="${LIVE}/$2"`)
    .replace(/(href|src)="\/"/g, `$1="${LIVE}/"`)
    .replace(/(href|src)="\/([^"]+)"/g, `$1="${LIVE}/$2"`);

  // The search index is fetched by absolute path at runtime; make that relative too.
  html = html.replace(/fetch\("\/wiki\/search-index\.json"\)/g, `fetch("${up}search-index.json")`);

  // Strip analytics. Every page carries the project's live GA property, and a preview hosted
  // anywhere else would report its traffic into the real site's statistics — inventing pageviews
  // for a domain that is not openhistoria.com. A review copy must not touch production numbers.
  html = html.replace(/\s*<!-- Google tag \(gtag\.js\) -->[\s\S]*?gtag\('config'[^<]*<\/script>/g, "");

  // Say what this is, on every page. A preview that looks exactly like the live site is one
  // screenshot away from someone quoting it as though it were published.
  html = html.replace(/<body>/,
    `<body>
<div style="background:#8a2331;color:#fbf3dc;font:600 0.85rem/1.4 system-ui,sans-serif;padding:0.5rem 1rem;text-align:center">` +
    `Preview build — not the live site. The published wiki is at ` +
    `<a href="${LIVE}/wiki/" style="color:#ffe9b8">openhistoria.com/wiki/</a>.</div>`);

  if (html !== before) rewritten += 1;
  writeFileSync(file, html, "utf8");
}

// A short note for whoever is handed the folder, so nobody mistakes it for the real site.
writeFileSync(path.join(outDir, "README.txt"),
`Open Historia — wiki preview
============================

A self-contained copy of the player wiki, for review. It is NOT the live site and
publishing it does not touch openhistoria.com.

To look at it:
  * Open index.html directly, or
  * serve this folder with any static host — it works from a domain root or a
    subpath, because every internal link is relative.

Links to the game itself (Play, Download, the landing page) point at the live
openhistoria.com, since those are not part of this bundle.

Built from wiki/ in the repo. The real deployment happens through build:site.
`, "utf8");

const bytes = walk(outDir).reduce((n, f) => n + statSync(f).size, 0);
console.log(`dist-wiki-preview/: ${pages.length} page(s), ${rewritten} rewritten, ${(bytes / 1048576).toFixed(1)}MB`);
console.log(`Open ${path.join("dist-wiki-preview", "index.html")}, or host the folder anywhere.`);
