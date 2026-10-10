import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TYPES, openStoredDocument } from "./useMapDocument.js";
import { OWNER_SCHEMA } from "./documentMigration.js";

const region = (id, owner) => ({
  type: "Feature",
  properties: { id, owner },
  geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
});

test("a stored map opens with its own fields and its regions", () => {
  const regions = { type: "FeatureCollection", features: [region("r1", "Atlantis")] };
  const opened = openStoredDocument({
    id: "atlantis_1",
    name: "Atlantis",
    ownerSchema: OWNER_SCHEMA,
    metadata: { name: "Old name", author: "Arkniem", customBackground: { kind: "image", dataUrl: "data:," } },
    types: [{ id: "sea", name: "Sea" }],
    features: [{ id: "f1", name: "Poseidonia" }],
    colorOverrides: { Atlantis: [1, 2, 3] },
    polities: { Atlantis: { name: "Atlantis" } },
    units: [{ id: "u1" }],
    groups: { Priests: { name: "Priests" } },
    puppets: [{ puppet: "Lemuria", overlord: "Atlantis" }],
    regions,
  });
  assert.equal(opened.regions, regions);
  assert.equal(opened.doc.id, "atlantis_1");
  assert.equal(opened.doc.metadata.name, "Atlantis", "the document's name wins over a stale metadata copy");
  assert.equal(opened.doc.metadata.author, "Arkniem");
  assert.deepEqual(opened.doc.metadata.customBackground, { kind: "image", dataUrl: "data:," });
  assert.deepEqual(opened.doc.types, [{ id: "sea", name: "Sea" }]);
  assert.deepEqual(opened.doc.colorOverrides, { Atlantis: [1, 2, 3] });
  assert.deepEqual(opened.doc.units, [{ id: "u1" }]);
  assert.deepEqual(opened.doc.puppets, [{ puppet: "Lemuria", overlord: "Atlantis" }]);
});

test("a map saved before the newer fields existed opens with them defaulted", () => {
  const opened = openStoredDocument({ id: "old", ownerSchema: OWNER_SCHEMA, types: [], regions: null });
  assert.equal(opened.doc.metadata.name, "Map");
  assert.deepEqual(opened.doc.types, DEFAULT_TYPES);
  assert.deepEqual(opened.doc.features, []);
  assert.deepEqual(opened.doc.colorOverrides, {});
  assert.deepEqual(opened.doc.flags, {});
  assert.deepEqual(opened.doc.tags, {});
  assert.deepEqual(opened.doc.polities, {});
  assert.deepEqual(opened.doc.units, []);
  assert.deepEqual(opened.doc.groups, {});
  assert.deepEqual(opened.doc.puppets, []);
  assert.equal(opened.regions, null);
});

test("a legacy map's regions come back with their owners migrated", () => {
  const opened = openStoredDocument({ id: "legacy", ownerSchema: 1, regions: { type: "FeatureCollection", features: [region("r1", "FRA")] } });
  assert.equal(opened.doc.ownerSchema, OWNER_SCHEMA);
  assert.equal(opened.regions.features[0].properties.owner, "France");
});

test("a document that cannot be read throws before anything is built", () => {
  assert.throws(() => openStoredDocument(null));
});
