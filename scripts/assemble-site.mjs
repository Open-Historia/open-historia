/*! Open Historia — combined site assembler © 2026 Nicholas Krol, MIT. */
// Builds dist-site/: the marketing landing page (site/) at the root, and the web
// game (dist-web/, built with `--base /play/`) under /play/. Deploy dist-site to
// Cloudflare Pages so openhistoria.com serves the landing page and its "Play"
// button opens the game (connect + sign-in screen) at /play/.
import { rmSync, mkdirSync, cpSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const siteDir = path.join(root, "site");       // landing page source (index.html, _redirects)
const gameDir = path.join(root, "dist-web");   // web game, built with base /play/
const outDir = path.join(root, "dist-site");

// Pages that must answer at the ROOT (/guides/, /robots.txt, …) but whose only copy
// lives in public/ — because a local install serves public/ at ITS root, so the guides
// work offline there too. They arrive here inside dist-web/ (vite copies public/
// verbatim), so lift them out of /play/ and up to /. Keeping a second hand-edited set
// under site/ is what this avoids: they were byte-identical, and the first edit to one
// would have silently desynced the website from the download.
// A page listed here MUST exist — a typo or rename that dropped a page from the site
// root would otherwise only surface as a sitemap URL 404ing to a crawler.
const ROOT_PAGES = [
  "guides", "get-started", "how-to-play", "ai-setup", "self-hosting",
  "pax-historia-alternative", "sitemap",
  "guides.css", "robots.txt", "sitemap.xml",
];

if (!existsSync(path.join(gameDir, "index.html"))) {
  console.error("dist-web/ is missing — build the game first: vite build --mode web --base /play/ --outDir dist-web");
  process.exit(1);
}

const missing = ROOT_PAGES.filter((name) => !existsSync(path.join(gameDir, name)));
if (missing.length > 0) {
  console.error(`public/ is missing root page(s): ${missing.join(", ")} — they are listed in ROOT_PAGES (scripts/assemble-site.mjs) but were not found in dist-web/.`);
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(siteDir, outDir, { recursive: true });                    // landing page + _redirects at /
cpSync(gameDir, path.join(outDir, "play"), { recursive: true }); // game at /play/
for (const name of ROOT_PAGES) {                                 // guides + robots/sitemap at /
  cpSync(path.join(gameDir, name), path.join(outDir, name), { recursive: true });
}
console.log(`Assembled dist-site/: landing page at /, game at /play/, ${ROOT_PAGES.length} root page(s) at /.`);
