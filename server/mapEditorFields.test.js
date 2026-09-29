/*! Open Historia — a new map document keeps everything the Workshop sent © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test server/mapEditorFields.test.js
//
// A create builds its record field by field, so a field it does not name is
// dropped without a word. Puppets were: puppet states set before a new map's
// first save were gone on reopening it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { after, test } from "node:test";
import { DOCUMENT_FIELDS, documentFieldsFromBody } from "./mapEditorFields.js";

// One value of the right shape for every field, none of them a default.
const EVERY_FIELD = {
  types: [{ id: "city", name: "City" }],
  regions: { type: "FeatureCollection", features: [{ type: "Feature", id: "r1", properties: { id: "r1", owner: "Vinland" }, geometry: null }] },
  features: [{ id: "f1" }],
  colorOverrides: { Vinland: "#2bc1f3" },
  flags: { Vinland: "data:image/png;base64,AAAA" },
  tags: { Vinland: ["Coastal"] },
  polities: { Vinland: { name: "Vinland" } },
  units: [{ id: "u1", owner: "Vinland", strength: 40 }],
  groups: { rebels: { name: "Rebels" } },
  puppets: [{ puppet: "Markland", overlord: "Vinland" }],
  ownerSchema: 4,
};

test("the list names every field the Workshop saves besides name and metadata", () => {
  assert.deepEqual(Object.keys(DOCUMENT_FIELDS).sort(), Object.keys(EVERY_FIELD).sort());
});

test("a create keeps what it was sent and fills what it was not", () => {
  assert.deepEqual(documentFieldsFromBody(EVERY_FIELD), EVERY_FIELD);
  assert.deepEqual(documentFieldsFromBody({}), {
    types: [],
    regions: { type: "FeatureCollection", features: [] },
    features: [],
    colorOverrides: {},
    flags: {},
    tags: {},
    polities: {},
    units: [],
    groups: {},
    puppets: [],
    ownerSchema: 1,
  });
  const wrongShapes = documentFieldsFromBody({ puppets: { a: 1 }, units: "u1", flags: "none" });
  assert.deepEqual([wrongShapes.puppets, wrongShapes.units, wrongShapes.flags], [[], [], {}]);
});

// --- through the desktop store ----------------------------------------------

const SERVER_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const STORE_URL = url.pathToFileURL(path.join(SERVER_DIR, "mapEditorStore.js")).href;
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test("a document created with every field reads each one back", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "oh-mapdoc-"));
  roots.push(root);
  const body = { name: "Vinland", metadata: { kind: "scenario" }, ...EVERY_FIELD };
  const script = `
    const store = await import(${JSON.stringify(STORE_URL)});
    const created = store.createMapEditorDocument(${JSON.stringify(body)});
    process.stdout.write("\\n@@" + JSON.stringify(store.getMapEditorDocument(created.id)));
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf-8",
    env: { ...process.env, OH_DATA_DIR: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stored = JSON.parse(out.slice(out.lastIndexOf("\n@@") + 3));
  for (const [field, value] of Object.entries(EVERY_FIELD)) {
    assert.deepEqual(stored[field], value, field);
  }
  assert.equal(stored.name, "Vinland");
  assert.equal(stored.metadata.kind, "scenario");
});
