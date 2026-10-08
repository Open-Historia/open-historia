/*! Open Historia — tests for the game's copy of the Fantasy Map Generator © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/fmgVendor.test.js
//
// What the game keeps of the generator, what it takes out of it, and that the
// installers and the release workflows carry it.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  FMG_COMMIT,
  FMG_CONTENT_SECURITY_POLICY,
  FMG_STAMP,
  FMG_TAG,
  FMG_ZIP_URL,
  PREPARED_MARK,
  keepFmgFile,
  prepareFmgFile,
  prepareFmgFontsJs,
  prepareFmgIndexHtml,
  prepareFmgMainJs,
} from "../scripts/fmg-vendor.mjs";

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// The lines of the pinned release the preparation changes, as the release has them.
const INDEX = [
  "<!DOCTYPE html>",
  "<html lang=\"en\">",
  "  <head>",
  "    <meta charset=\"utf-8\" />",
  "    <title>Azgaar's Fantasy Map Generator</title>",
  "    <script async src=\"https://www.googletagmanager.com/gtag/js?id=G-VJL3J26W7R\"></script>",
  "    <script>",
  "      window.dataLayer = window.dataLayer || [];",
  "      function gtag() {",
  "        dataLayer.push(arguments);",
  "      }",
  "      gtag(\"js\", new Date());",
  "      gtag(\"config\", \"G-VJL3J26W7R\");",
  "    </script>",
  "",
  "    <link rel=\"icon\" type=\"image/png\" href=\"images/icons/favicon-32x32.png\" sizes=\"32x32\" />",
  "    <link rel=\"canonical\" href=\"https://azgaar.github.io/Fantasy-Map-Generator/\" />",
  "    <link rel=\"manifest\" href=\"manifest.webmanifest\" />",
  "    <link rel=\"preload\" href=\"index.css?v=1.109.1\" as=\"style\" />",
  "  </head>",
  "  <body>",
  "    <script>",
  "      const keep = \"this inline script is the generator's own\";",
  "    </script>",
  "    <script src=\"main.js\"></script>",
  "  </body>",
  "</html>",
  "",
].join("\n");

const MAIN = [
  "// set debug options",
  "const PRODUCTION = location.hostname && location.hostname !== \"localhost\" && location.hostname !== \"127.0.0.1\";",
  "if (PRODUCTION && \"serviceWorker\" in navigator) {",
  "  navigator.serviceWorker.register(\"./sw.js\");",
  "}",
  "function toggleAssistant() {",
  "  const showAssistant = byId(\"azgaarAssistant\").value === \"show\";",
  "  if (showAssistant) import(\"./libs/openwidget.min.js\");",
  "}",
  "",
].join("\n");

const FONTS = [
  "const fonts = [",
  "  {family: \"Arial\"},",
  "  {family: \"Almendra SC\", src: \"url(https://fonts.gstatic.com/s/almendrasc/v13/x.woff2)\"}",
  "];",
  "function declareFont(font) {",
  "  const {family, src, ...rest} = font;",
  "  addFontOption(family);",
  "",
  "  if (!src) return;",
  "  const fontFace = new FontFace(family, src, {...rest, display: \"block\"});",
  "  document.fonts.add(fontFace);",
  "}",
  "",
].join("\n");

test("the download is asked for by the commit the pinned tag names", () => {
  assert.equal(FMG_TAG, "v1.109");
  assert.match(FMG_COMMIT, /^[0-9a-f]{40}$/);
  assert.equal(FMG_ZIP_URL, `https://codeload.github.com/Azgaar/Fantasy-Map-Generator/zip/${FMG_COMMIT}`);
  assert.ok(FMG_STAMP.startsWith(`${FMG_TAG}+oh`), "the stamp names the preparation, so a changed one is applied again");
});

test("the page is given a policy that allows this origin only, first in its head", () => {
  const page = prepareFmgIndexHtml(INDEX);
  const head = page.slice(page.indexOf("<head>"), page.indexOf("<meta charset"));
  assert.ok(head.includes(PREPARED_MARK), "the mark comes before anything the page loads");
  assert.ok(head.includes(`<meta http-equiv="Content-Security-Policy" content="${FMG_CONTENT_SECURITY_POLICY}" />`));
  assert.match(FMG_CONTENT_SECURITY_POLICY, /^default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;/);
  assert.doesNotMatch(FMG_CONTENT_SECURITY_POLICY, /https?:|\*/, "no other host, and no wildcard");
});

test("the analytics tags are taken out, and the generator's own scripts stay", () => {
  const page = prepareFmgIndexHtml(INDEX);
  assert.doesNotMatch(page, /googletagmanager|gtag\(|dataLayer/);
  assert.doesNotMatch(page, /rel="(icon|canonical|manifest)"/);
  assert.ok(page.includes("this inline script is the generator's own"));
  assert.ok(page.includes("<script src=\"main.js\"></script>"));
  assert.ok(page.includes("index.css?v=1.109.1"));
  assert.ok(page.includes("<title>Azgaar's Fantasy Map Generator</title>"));
});

test("a page that is not the pinned release's is refused, not half prepared", () => {
  assert.throws(() => prepareFmgIndexHtml("<html><body>nothing here</body></html>"), /<head> was not found/);
  assert.throws(() => prepareFmgIndexHtml(INDEX.replace(/\s*<script async[^\n]*\n/, "\n")), /analytics script was not found/);
  assert.throws(() => prepareFmgMainJs("const OTHER = 1;"), /PRODUCTION switch was not found/);
  assert.throws(() => prepareFmgMainJs("const PRODUCTION = true;"), /assistant switch was not found/);
  assert.throws(() => prepareFmgFontsJs("function other() {}"), /font declaration was not found/);
});

test("the generator is never in production and never asks for the chat widget", () => {
  const script = prepareFmgMainJs(MAIN);
  assert.match(script, /^const PRODUCTION = false;/m);
  assert.doesNotMatch(script, /location\.hostname/);
  assert.match(script, /const showAssistant = false;/);
});

test("a font that lives on another host is not declared", () => {
  const script = prepareFmgFontsJs(FONTS);
  const guard = script.match(/if \((.+?)\) return;/)[1];
  // Run the guard the prepared file carries against the kinds of src the list holds.
  const skips = (src) => new Function("src", `return Boolean(${guard});`)(src);
  assert.equal(skips(undefined), true, "a system font has no src");
  assert.equal(skips("url(https://fonts.gstatic.com/s/almendrasc/v13/x.woff2)"), true);
  assert.equal(skips("url('//fonts.gstatic.com/x.woff2')"), true);
  assert.equal(skips("url(fonts/local.woff2)"), false, "a font the copy carries would still load");
  assert.equal(skips("local(Georgia)"), false);
});

test("only the files a generation uses are kept, and always the licence", () => {
  for (const file of ["index.html", "main.js", "versioning.js", "index.css", "LICENSE", "modules/burgs-and-states.js", "modules/ui/options.js", "utils/graphUtils.js", "libs/d3.min.js", "libs/delaunator.min.js", "config/heightmap-templates.js", "components/slider-input.js", "styles/default.json"]) {
    assert.equal(keepFmgFile(file), true, file);
  }
  for (const file of ["sw.js", "manifest.webmanifest", "dropbox.html", "Dockerfile", "README.md", "run_python_server.sh", "run_php_server.bat", "images/pattern1.png", "images/icons/favicon-32x32.png", "charges/lion.svg", "heightmaps/europe.png", "libs/tinymce/tinymce.min.js", "libs/three.min.js", "libs/openwidget.min.js", "libs/umami.js", "libs/dropbox-sdk.min.js", ".github/workflows/x.yml", ".gitignore", "", "modules/"]) {
    assert.equal(keepFmgFile(file), false, file);
  }
  assert.equal(keepFmgFile("libs\\d3.min.js"), true, "a Windows path is the same file");
});

test("a kept file is written as it came, apart from the three that are prepared", () => {
  const bytes = Buffer.from("plain");
  assert.equal(prepareFmgFile("modules/voronoi.js", bytes), bytes);
  assert.equal(prepareFmgFile("libs/openwidget.min.js", bytes), null);
  assert.ok(prepareFmgFile("index.html", Buffer.from(INDEX)).toString("utf8").includes(PREPARED_MARK));
  assert.match(prepareFmgFile("main.js", Buffer.from(MAIN)).toString("utf8"), /PRODUCTION = false/);
  assert.match(prepareFmgFile("modules/fonts.js", Buffer.from(FONTS)).toString("utf8"), /no font is fetched from another host/);
});

test("the editor looks for the same mark the preparation writes", () => {
  const driver = read("../src/Editor/fmg/fmgDriver.js");
  assert.ok(driver.includes(`export const PREPARED_MARK = ${JSON.stringify(PREPARED_MARK)};`));
});

test("every installer packs the generator", () => {
  const packageJson = JSON.parse(read("../package.json"));
  assert.ok(packageJson.build.files.includes("fmg/dist/**"));
  for (const config of ["../electron-builder.beta.yml", "../electron-builder.multiplayer.yml"]) {
    assert.match(read(config), /^files:\n(?: {2}- .+\n)* {2}- fmg\/dist\/\*\*\n/m, config);
  }
  // A local build fetches it too; best effort there, since it is not a release.
  for (const [name, script] of Object.entries(packageJson.scripts)) {
    if (!name.startsWith("dist:")) continue;
    assert.match(script, /node scripts\/fetch-fmg\.mjs && npm run build && electron-builder/, name);
  }
});

test("a release workflow fetches the generator before it builds, and stops when it cannot", () => {
  for (const file of ["../.github/workflows/desktop-installer.yml", "../.github/workflows/desktop-beta.yml"]) {
    const workflow = read(file);
    const vendor = workflow.indexOf("run: node scripts/fetch-fmg.mjs --required");
    assert.ok(vendor > 0, `${file} vendors the generator`);
    assert.ok(vendor < workflow.indexOf("- name: Build the installer"), `${file}: before the installer is built`);
    assert.ok(vendor > workflow.indexOf("run: npm ci"), `${file}: after the dependencies, which the script needs`);
    const step = workflow.slice(workflow.lastIndexOf("- name:", vendor), vendor);
    assert.doesNotMatch(step, /continue-on-error/, `${file}: a failure is not passed over`);
  }
  const script = read("../scripts/fetch-fmg.mjs");
  assert.match(script, /if \(REQUIRED\) \{[\s\S]*?process\.exit\(1\);/);
});

test("the server serves the generator from the folder the installers pack", () => {
  const server = read("./server.js");
  assert.match(server, /const fmgDistDir = path\.join\(__dirname, "\.\.\/fmg\/dist"\);/);
  const mount = server.slice(server.indexOf("if (fs.existsSync(fmgDistDir)) {"), server.indexOf("if (fs.existsSync(fmgDistDir)) {") + 600);
  const files = mount.indexOf("app.use(\"/fmg\", express.static(fmgDistDir));");
  const missing = mount.indexOf("res.status(404)");
  assert.ok(files > 0, "the folder is served");
  // A file the copy leaves out must not be answered with the app's own page.
  assert.ok(missing > files, "and what it does not hold is a 404, after the files");
  assert.ok(server.indexOf("if (fs.existsSync(fmgDistDir)) {") < server.indexOf("express.static(distDir)"), "before the app's own files and the SPA fallback");
});
