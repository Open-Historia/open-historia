/*! Open Historia - the built-in's earlier maps are served by name © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "libraryStore.js")).href;
const root = mkdtempSync(path.join(os.tmpdir(), "oh-earlier-maps-"));
after(() => rmSync(root, { recursive: true, force: true }));

test("the map editor's world map is the hand-drawn map the built-in had, and nothing else is served by that route", () => {
  const script = `
    const { resolveEarlierBuiltInMap } = await import(${JSON.stringify(STORE_URL)});
    const fs = await import("node:fs");
    const map = JSON.parse(fs.readFileSync(resolveEarlierBuiltInMap("fault-lines-2014-v1"), "utf8"));
    const refused = ["../default/regions", "default", "", "FAULT-LINES-2014-V1"].filter((stamp) => {
      try { resolveEarlierBuiltInMap(stamp); return false; } catch { return true; }
    });
    console.log(JSON.stringify({ regions: map.features.length, refused: refused.length }));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, OH_DATA_DIR: root },
  });
  assert.deepEqual(JSON.parse(out.trim().split("\n").pop()), { regions: 4848, refused: 4 });
});
