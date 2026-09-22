/*! Open Historia — Stats editor layout regression checks © 2026 Open Historia contributors, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./StatsSheetEditor.jsx", import.meta.url), "utf8");

test("custom Stats sheet surfaces cannot grow wider than the editor drawer", () => {
  assert.match(source, /className="oh-stats-sheet-editor" style=\{\{[^}]*maxWidth: "100%"[^}]*minWidth: 0[^}]*width: "100%"/);
  assert.match(source, /borderRadius: "13px", maxWidth: "100%", minWidth: 0, overflow: "hidden", width: "100%"/);
  assert.match(source, /borderRadius: "11px", maxWidth: "100%", minWidth: 0, padding: "0\.6rem"/);
});

test("long stat metadata shrinks while edit and delete actions stay reachable", () => {
  assert.match(source, /flex: "1 1 8rem"[^}]*minWidth: 0[^}]*overflow: "hidden"[^}]*textOverflow: "ellipsis"/);
  assert.match(source, /flex: "0 1 7rem"[^}]*maxWidth: "35%"[^}]*minWidth: 0[^}]*textOverflow: "ellipsis"/);
  assert.match(source, /maxWidth: "40%"[^}]*minWidth: 0[^}]*overflow: "hidden"[^}]*textOverflow: "ellipsis"/);
  assert.match(source, /<div style=\{\{ display: "flex", flex: "0 0 auto", gap: "0\.32rem" \}\}>/);
});

test("expanded stat forms wrap their columns instead of imposing a fixed minimum width", () => {
  assert.match(source, /className="oh-stats-stat-editor"/);
  assert.match(source, /gridTemplateColumns: "repeat\(auto-fit, minmax\(min\(7rem, 100%\), 1fr\)\)"/);
  assert.match(source, /\.oh-stats-stat-editor > \* \{\s*min-width: 0;/);
  assert.ok(source.includes('overflowWrap: "anywhere"'));
  assert.ok(source.includes('Machine key: <code>{stat.key}</code>'));
});
