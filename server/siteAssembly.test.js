/*! Open Historia — website assembly tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/siteAssembly.test.js
//
// scripts/assemble-site.mjs lifts pages and images out of the web game (built
// under /play/) up to the site root, because the game asks for them by absolute
// path. A name in its lists that is not in public/ is a file that 404s on
// openhistoria.com: loading_screen_5 was listed as .png after it became .webp,
// and the default scenario cover was never listed at all.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import url from "node:url";
import { ROOT_ASSETS, ROOT_PAGES, assembleSite } from "../scripts/assemble-site.mjs";

const PUBLIC_DIR = url.fileURLToPath(new URL("../public/", import.meta.url));

test("every page and image lifted to the site root exists in public/", () => {
  const missing = [...ROOT_PAGES, ...ROOT_ASSETS].filter((name) => !fs.existsSync(path.join(PUBLIC_DIR, name)));
  assert.deepEqual(missing, []);
});

test("the site root carries the fifth loading image and the default scenario cover", () => {
  assert.ok(ROOT_ASSETS.includes("loading_screen_5.webp"));
  assert.ok(ROOT_ASSETS.includes("scenario-placeholder.webp"));
});

test("assembly copies the root images and names one that is missing instead of skipping it quietly", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oh-site-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const game = path.join(root, "dist-web");
  fs.mkdirSync(path.join(root, "site"), { recursive: true });
  fs.writeFileSync(path.join(root, "site", "index.html"), "landing");
  fs.mkdirSync(game, { recursive: true });
  fs.writeFileSync(path.join(game, "index.html"), "game");
  for (const name of ROOT_PAGES) fs.writeFileSync(path.join(game, name), name);
  const [absent, ...present] = ROOT_ASSETS;
  for (const name of present) fs.writeFileSync(path.join(game, name), name);

  const warnings = [];
  t.mock.method(console, "warn", (message) => warnings.push(String(message)));
  t.mock.method(console, "log", () => {});

  assert.equal(assembleSite(root), true);
  for (const name of present) assert.ok(fs.existsSync(path.join(root, "dist-site", name)), `${name} at the root`);
  assert.ok(fs.existsSync(path.join(root, "dist-site", "play", "index.html")));
  assert.equal(fs.existsSync(path.join(root, "dist-site", absent)), false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], new RegExp(absent.replace(/\./g, "\\.")));
});

test("assembly stops when a root page is missing", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oh-site-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "dist-web"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist-web", "index.html"), "game");
  t.mock.method(console, "error", () => {});
  assert.equal(assembleSite(root), false);
  assert.equal(fs.existsSync(path.join(root, "dist-site")), false);
});
