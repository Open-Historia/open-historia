import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The game's fonts are in the bundle (src/assets/fonts/). Nothing under src/
// asks Google for one: a stylesheet or a font file fetched from Google's font
// service is a request that tells Google about the visit before the visitor has
// agreed to anything, and it is the request the website's entry screen used to
// make on every load.
//
// Every file is read, tests and comments included, so the two host names cannot
// come back by way of a copied snippet. (This file spells neither: the pattern
// below is what names them.)
const FONT_HOSTS = /fonts\.(?:googleapis|gstatic)\.com/i;

const root = fileURLToPath(new URL("./", import.meta.url));
// Fonts and pictures are not text; everything else is read.
const BINARY = /\.(?:woff2?|ttf|otf|png|jpe?g|webp|gif|ico|pmtiles|zip)$/i;

const filesUnder = (directory) => readdirSync(directory).flatMap((name) => {
  const full = path.join(directory, name);
  if (statSync(full).isDirectory()) return name === "generated" || name === "node_modules" ? [] : filesUnder(full);
  return BINARY.test(name) ? [] : [full];
});

test("no file under src/ names Google's font hosts", () => {
  const files = filesUnder(root);
  assert.ok(files.length > 500, `only ${files.length} files were read; this guard needs updating`);
  const naming = files
    .filter((full) => FONT_HOSTS.test(readFileSync(full, "utf8")))
    .map((full) => path.relative(root, full).split(path.sep).join("/"));
  assert.deepEqual(naming, []);
});

test("the website's demo notice takes its fonts from the bundle", () => {
  const home = readFileSync(path.join(root, "runtime", "web", "demoNotice.js"), "utf8");
  assert.match(home, /import "\.\.\/\.\.\/assets\/fonts\/fonts\.css";/);
  // It adds one <style> of its own and no stylesheet from anywhere.
  assert.doesNotMatch(home, /rel:\s*"stylesheet"|el\("link"/);
  // The two families it is set in are the two the bundle carries.
  const css = readFileSync(path.join(root, "assets", "fonts", "fonts.css"), "utf8");
  for (const family of ["Cinzel", "EB Garamond"]) {
    assert.ok(home.includes(`'${family}'`), `the entry screen uses ${family}`);
    assert.ok(css.includes(`font-family: '${family}';`), `${family} is in the bundle`);
  }
  // Every font the bundled sheet names is a file beside it.
  assert.doesNotMatch(css, /url\(\s*["']?(?:https?:)?\/\//, "the bundled sheet fetches nothing from another host");
});
