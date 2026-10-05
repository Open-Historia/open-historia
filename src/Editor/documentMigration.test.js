// Run: node --test src/Editor/documentMigration.test.js
//
// A Workshop document saved before owners were names owns its regions by GADM
// code ("MNG") and keys its colours, flags and tags the same way.
// migrateDocumentOwners runs on every open and is the only migration such a
// document gets: once it is applied to a scenario it inherits that world's
// ownerSchema marker, and the store never repairs it (documentMigration.js).

import test from "node:test";
import assert from "node:assert/strict";
import { OWNER_SCHEMA, docNeedsOwnerMigration, migrateDocumentOwners } from "./documentMigration.js";

const region = (id, properties) => ({ type: "Feature", geometry: null, properties: { id, ...properties } });

const legacyDocument = () => ({
  id: "doc-1",
  name: "Old map",
  regions: {
    type: "FeatureCollection",
    features: [
      region("MNG.1_1", { owner: "MNG", country: "Mongolia", gid0: "MNG" }),
      region("MNG.2_1", { owner: "MNG", country: "Mongolia", gid0: "MNG" }),
      region("fmg-7", { owner: "Yardibyurt", country: "Yardibyurt" }),
    ],
  },
  colorOverrides: { MNG: [1, 2, 3], Yardibyurt: [4, 5, 6] },
  flags: { MNG: "data:image/png;base64,AAAA" },
  tags: { MNG: ["steppe"] },
});

// Runs fn with console quiet, and hands back what it warned.
const quietly = (t, fn) => {
  const warnings = [];
  t.mock.method(console, "warn", (message) => { warnings.push(String(message)); });
  t.mock.method(console, "log", () => {});
  return { result: fn(), warnings };
};

test("a code-keyed document is re-keyed by name everywhere, and stamped", (t) => {
  const doc = legacyDocument();
  const { result } = quietly(t, () => migrateDocumentOwners(doc));

  assert.equal(result.ownerSchema, OWNER_SCHEMA);
  assert.deepEqual(result.regions.features.map((f) => f.properties.owner), ["Mongolia", "Mongolia", "Yardibyurt"]);
  assert.deepEqual(result.colorOverrides, { Mongolia: [1, 2, 3], Yardibyurt: [4, 5, 6] });
  assert.deepEqual(result.flags, { Mongolia: "data:image/png;base64,AAAA" });
  assert.deepEqual(result.tags, { Mongolia: ["steppe"] });
  assert.equal(result.name, "Old map");
});

test("the country property goes, id and gid0 stay", (t) => {
  const { result } = quietly(t, () => migrateDocumentOwners(legacyDocument()));
  for (const feature of result.regions.features) {
    assert.equal("country" in feature.properties, false);
  }
  assert.deepEqual(result.regions.features[0].properties, { id: "MNG.1_1", gid0: "MNG", owner: "Mongolia" });
  assert.equal(result.regions.type, "FeatureCollection");
});

test("an owner that is already a name passes through unchanged", (t) => {
  const { result } = quietly(t, () => migrateDocumentOwners(legacyDocument()));
  assert.equal(result.regions.features[2].properties.owner, "Yardibyurt");
});

test("the input document is not changed", (t) => {
  const doc = legacyDocument();
  const before = structuredClone(doc);
  quietly(t, () => migrateDocumentOwners(doc));
  assert.deepEqual(doc, before);
});

test("a current document comes back as the same object, so this is safe on every open", (t) => {
  const doc = { ...legacyDocument(), ownerSchema: OWNER_SCHEMA };
  assert.equal(docNeedsOwnerMigration(doc), false);
  assert.equal(migrateDocumentOwners(doc), doc);

  const { result: once } = quietly(t, () => migrateDocumentOwners(legacyDocument()));
  assert.equal(migrateDocumentOwners(once), once, "a migrated document needs nothing more");
});

test("a document with no marker, or an older one, is legacy", () => {
  assert.equal(docNeedsOwnerMigration({}), true);
  assert.equal(docNeedsOwnerMigration({ ownerSchema: 1 }), true);
  assert.equal(docNeedsOwnerMigration({ ownerSchema: OWNER_SCHEMA - 1 }), true);
  assert.equal(migrateDocumentOwners(null), null);
  assert.equal(migrateDocumentOwners("text"), "text");
});

test("two codes that land on one name keep one entry, the real country's, and warn", (t) => {
  // CHN and the disputed placeholder Z02 both resolve to "China".
  const doc = {
    colorOverrides: { Z02: [0, 0, 0], CHN: [255, 0, 0] },
    regions: { features: [region("a", { owner: "Z02" }), region("b", { owner: "CHN" })] },
  };
  const { result, warnings } = quietly(t, () => migrateDocumentOwners(doc));
  assert.deepEqual(result.colorOverrides, { China: [255, 0, 0] });
  assert.deepEqual(result.regions.features.map((f) => f.properties.owner), ["China", "China"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /colorOverrides: "China" claimed by CHN over Z02/);
});

test("a region with no properties or no owner keeps its owner and loses only country", (t) => {
  const bare = { type: "Feature", geometry: null };
  const doc = {
    regions: {
      features: [
        bare,
        region("x", { owner: "", country: "Mongolia" }),
        region("y", { country: "Mongolia" }),
      ],
    },
  };
  const { result } = quietly(t, () => migrateDocumentOwners(doc));
  assert.equal(result.regions.features[0], bare);
  assert.deepEqual(result.regions.features[1].properties, { id: "x", owner: "" });
  assert.deepEqual(result.regions.features[2].properties, { id: "y" });
  // Missing maps stay missing rather than turning into empty objects.
  assert.equal(result.colorOverrides, undefined);
  assert.equal(result.flags, undefined);
});

test("parts added to documents after the rename are left as they are", (t) => {
  const doc = {
    ...legacyDocument(),
    polities: { MNG: { name: "Mongolia" } },
    units: [{ id: "u1", ownerCode: "MNG" }],
  };
  const { result } = quietly(t, () => migrateDocumentOwners(doc));
  assert.equal(result.polities, doc.polities);
  assert.equal(result.units, doc.units);
});
