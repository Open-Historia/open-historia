/*! Open Historia — what the game ships of Azgaar's Fantasy Map Generator © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

// The map editor's Generate drawer runs Azgaar's Fantasy Map Generator (MIT) in
// a hidden frame and reads the world it makes (src/Editor/fmg/fmgDriver.js).
// The game ships its own copy of the generator, and this file says what that
// copy is. scripts/fetch-fmg.mjs downloads the pinned release and applies it.
//
// The generator as its author publishes it is a website, and behaves like one
// when it is loaded: it reports the visit to its author's Google Analytics,
// loads a support chat widget from a third party, fetches fonts from Google and
// registers a service worker on whatever origin serves it. Measured in the
// editor before this file existed, one press of Generate made seven requests
// to four outside hosts. None of that belongs in the game, so the copy is
// PREPARED:
//
//   - the page carries a Content-Security-Policy that allows this origin only,
//     so nothing in it can reach another host, whatever a later line of the
//     generator tries (the guarantee; the removals below are for tidiness);
//   - the analytics tags are taken out of the page;
//   - the generator is told it is not "in production", which is what makes it
//     register its service worker and ask before the page is left;
//   - the chat widget is never asked for;
//   - and only the files a generation uses are kept: the 25 MB download has
//     12 MB of images, the heraldry, the hand-made heightmaps, a rich-text
//     editor and a 3D viewer the hidden frame never opens.
//
// A prepared page says so in a comment (PREPARED_MARK). The editor offers the
// Generate drawer only when the page it would load carries the mark
// (fmgDriver.js isFmgIndexPage), so a copy fetched by an older checkout is
// never run.
//
// DELIBERATELY IMPORT-FREE: the rules are tested as plain functions
// (server/fmgVendor.test.js).

export const FMG_REPO = "Azgaar/Fantasy-Map-Generator";
// v1.109 is the NEWEST release that still runs as plain static files (no
// build) and keeps its state (pack, grid, biomesData, mapCoordinates…) in the
// classic global scope where the driver can read it. v1.110 and later are ES
// modules, whose state is out of reach.
export const FMG_TAG = "v1.109";
// The commit that tag names. The download is asked for by commit, so a tag
// that is moved upstream cannot change what a build ships.
export const FMG_COMMIT = "50f51bd8380a7fddc27977f96fa9c1db4b7cdd1e";
// Raise when the preparation below changes: a copy stamped with another value
// is fetched and prepared again.
export const FMG_PREPARATION = 1;
export const FMG_STAMP = `${FMG_TAG}+oh${FMG_PREPARATION}`;
export const FMG_ZIP_URL = `https://codeload.github.com/${FMG_REPO}/zip/${FMG_COMMIT}`;

export const PREPARED_MARK = "open-historia: prepared copy";
// Everything the page may load or talk to: this origin, and what a page makes
// for itself. The generator is classic scripts with inline handlers and the
// driver reads its state through eval, so both are allowed; another host is not.
export const FMG_CONTENT_SECURITY_POLICY = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; object-src 'none'; base-uri 'self'; form-action 'none'";

// Folders and files of the release that the hidden frame never needs.
const DROPPED_FOLDERS = ["images/", "charges/", "heightmaps/", "libs/tinymce/", ".github/", ".vscode/", ".docker/"];
const DROPPED_FILES = new Set([
  "sw.js", // the service worker, which the prepared copy never registers
  "manifest.webmanifest",
  "dropbox.html",
  "libs/dropbox-sdk.min.js",
  "libs/openwidget.min.js", // the chat widget's loader
  "libs/umami.js", // an analytics client
  "libs/three.min.js", // the 3D view
  "libs/orbitControls.min.js",
  "libs/mapControls.min.js",
  "Dockerfile",
]);

// Whether a file of the release (its path inside the release, forward slashes)
// is part of the copy the game ships. The licence always is.
export const keepFmgFile = (relativePath) => {
  const file = String(relativePath ?? "").replace(/\\/g, "/").replace(/^\.?\//, "");
  if (!file || file.endsWith("/")) return false;
  if (file === "LICENSE") return true;
  if (DROPPED_FILES.has(file)) return false;
  if (DROPPED_FOLDERS.some((folder) => file.startsWith(folder))) return false;
  if (file.startsWith(".")) return false;
  // Notes, launchers and container files at the top of the repository.
  if (!file.includes("/") && /\.(md|bat|sh|ya?ml|json|txt)$/i.test(file)) return false;
  return true;
};

const mustChange = (before, after, what) => {
  if (before === after) throw new Error(`the generator's ${what} was not found: the pinned release is not the one this preparation was written for`);
  return after;
};

// The page, prepared: the policy and the mark first in <head>, the analytics
// tags and the links to files the copy does not carry taken out.
export const prepareFmgIndexHtml = (html) => {
  const source = String(html ?? "");
  let page = mustChange(source, source.replace(/<head>/i, (head) => `${head}\n    <!-- ${PREPARED_MARK} (scripts/fmg-vendor.mjs) -->\n    <meta http-equiv="Content-Security-Policy" content="${FMG_CONTENT_SECURITY_POLICY}" />`), "<head>");
  // <script async src="https://www.googletagmanager.com/gtag/js?id=…"></script>
  page = mustChange(page, page.replace(/[ \t]*<script[^>]*\bsrc="https?:\/\/www\.googletagmanager\.com\/[^"]*"[^>]*>\s*<\/script>\s*\n?/gi, ""), "analytics script");
  // …and the inline block that feeds it.
  page = mustChange(page, page.replace(/[ \t]*<script>(?:(?!<\/script>)[\s\S])*?\bgtag\((?:(?!<\/script>)[\s\S])*?<\/script>\s*\n?/gi, ""), "analytics settings");
  page = page.replace(/[ \t]*<link[^>]*\brel="(?:icon|apple-touch-icon|manifest|canonical)"[^>]*>\s*\n?/gi, "");
  if (/googletagmanager|google-analytics/i.test(page)) throw new Error("the prepared page still names the analytics host");
  return page;
};

// The generator's main script, prepared: never "in production" (no service
// worker, no question before the frame is removed) and never the chat widget.
export const prepareFmgMainJs = (script) => {
  const source = String(script ?? "");
  let text = mustChange(source, source.replace(/^const PRODUCTION = [^\n;]*;/m, "const PRODUCTION = false; // Open Historia: a frame inside the game, never the generator's own site"), "PRODUCTION switch");
  text = mustChange(text, text.replace(/const showAssistant = byId\("azgaarAssistant"\)\.value === "show";/, "const showAssistant = false; // Open Historia: the chat widget is not shipped"), "assistant switch");
  return text;
};

// The generator's font list, prepared: it declares some forty label fonts by
// their address on Google's font host as soon as the page loads. The policy
// refuses every one of them, at the price of forty errors in the console for
// each generation, so a font that lives on another host is simply not declared.
// The hidden frame draws no labels; the editor draws the map itself.
export const prepareFmgFontsJs = (script) => {
  const source = String(script ?? "");
  return mustChange(
    source,
    source.replace(/(function declareFont\(font\) \{[\s\S]*?)if \(!src\) return;/, "$1if (!src || /^url\\(\\s*[\"']?(?:https?:)?\\/\\//i.test(src)) return; // Open Historia: no font is fetched from another host"),
    "font declaration",
  );
};

// What becomes of one file of the release: null when it is not kept, else the
// bytes to write.
export const prepareFmgFile = (relativePath, bytes) => {
  if (!keepFmgFile(relativePath)) return null;
  const file = String(relativePath).replace(/\\/g, "/");
  if (file === "index.html") return Buffer.from(prepareFmgIndexHtml(Buffer.from(bytes).toString("utf8")), "utf8");
  if (file === "main.js") return Buffer.from(prepareFmgMainJs(Buffer.from(bytes).toString("utf8")), "utf8");
  if (file === "modules/fonts.js") return Buffer.from(prepareFmgFontsJs(Buffer.from(bytes).toString("utf8")), "utf8");
  return bytes;
};
