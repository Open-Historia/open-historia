/*!
 * Open Historia Map Editor
 * Copyright (c) 2026 Nicholas Krol - AGPL-3.0-or-later (see LICENSE).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIPBOARD_VERSION,
  buildClipboardPayload,
  describeClipboard,
  formatCopiedDay,
  isRegionClipboard,
  planClipboardMerge,
  resolvePastedIds,
} from "./regionClipboard.js";
import { createDateLocalizer } from "../runtime/localDates.js";

const region = (id, owner, extra = {}) => ({
  type: "Feature",
  id,
  geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
  properties: { id, name: `Region ${id}`, owner, typeId: "land", ...extra },
});

const sourceDoc = {
  id: "doc-1",
  types: [
    { id: "land", name: "Land" },
    { id: "coastal", name: "Coastal" },
    { id: "steppe", name: "Steppe", opacity: 0.4 },
  ],
  polities: {
    Gondor: { name: "Gondor", aliases: ["Kingdom of Gondor"], color: "#3366cc", status: "active" },
    Rohan: { name: "Rohan", aliases: [] },
  },
  flags: { Gondor: "data:image/png;base64,AAAA" },
  tags: { Gondor: ["monarchy"], Mordor: ["dark"] },
};
const sourceColors = { Gondor: [51, 102, 204], Rohan: [200, 180, 40], Mordor: [10, 10, 10] };

const regions = {
  type: "FeatureCollection",
  features: [
    region("g1", "Gondor", { claimants: ["Mordor"] }),
    region("g2", "Gondor", { typeId: "steppe" }),
    region("r1", "Rohan", { edited: true }),
    region("n1", null),
  ],
};

test("a copy carries the regions, the countries they name, and the types they use", () => {
  const payload = buildClipboardPayload({ regions, doc: sourceDoc, colors: sourceColors, sourceName: "Middle-earth", sourceId: "doc-1", now: new Date("2026-09-16T20:00:00Z") });
  assert.ok(isRegionClipboard(payload));
  assert.equal(payload.version, CLIPBOARD_VERSION);
  assert.deepEqual(payload.source, { name: "Middle-earth", id: "doc-1" });
  assert.equal(payload.copiedAt, "2026-09-16T20:00:00.000Z");
  assert.equal(payload.regions.features.length, 4);
  assert.deepEqual(payload.regions.features[2].properties, { id: "r1", name: "Region r1", owner: "Rohan", typeId: "land", edited: true });
  assert.deepEqual(Object.keys(payload.polities).sort(), ["Gondor", "Mordor", "Rohan"], "owners and claimants, nobody else");
  assert.deepEqual(payload.polities.Gondor, {
    name: "Gondor",
    aliases: ["Kingdom of Gondor"],
    color: "#3366cc",
    status: "active",
    rgb: [51, 102, 204],
    flag: "data:image/png;base64,AAAA",
    tags: ["monarchy"],
  });
  assert.deepEqual(payload.polities.Mordor, { name: "Mordor", rgb: [10, 10, 10], tags: ["dark"] }, "a claimant with no record still travels with its colour and tags");
  assert.deepEqual(payload.types.map((t) => t.id), ["land", "steppe"], "only the types the regions use");
  payload.regions.features[0].properties.owner = "changed";
  assert.equal(regions.features[0].properties.owner, "Gondor", "the copy is detached from the source");
});

test("an empty or malformed selection copies nothing", () => {
  const payload = buildClipboardPayload({ regions: { features: [null, { type: "Feature" }] }, doc: sourceDoc });
  assert.equal(payload.regions.features.length, 0);
  assert.deepEqual(payload.polities, {});
  assert.equal(payload.source.name, "Untitled Map");
  assert.ok(!isRegionClipboard({ version: 0, regions: { features: [] } }));
  assert.ok(!isRegionClipboard(null));
});

test("on paste the target keeps what it has and takes only what it lacks", () => {
  const payload = buildClipboardPayload({ regions, doc: sourceDoc, colors: sourceColors, sourceName: "Middle-earth" });
  const plan = planClipboardMerge(payload, {
    polities: { Gondor: { name: "Gondor (mine)", aliases: [] } },
    colors: { Gondor: [1, 2, 3] },
    flags: {},
    tags: { Mordor: ["already"] },
    types: [{ id: "land", name: "Land" }],
  });
  assert.deepEqual(Object.keys(plan.upserts).sort(), ["Mordor", "Rohan"], "Gondor's record stays the target's");
  assert.deepEqual(plan.upserts.Rohan, { name: "Rohan", aliases: [] });
  assert.deepEqual(plan.upserts.Mordor, { name: "Mordor" });
  assert.ok(!("rgb" in plan.upserts.Mordor) && !("flag" in plan.upserts.Mordor) && !("tags" in plan.upserts.Mordor), "colour, flag and tags travel as their own patches");
  assert.deepEqual(plan.colorOverrides, { Rohan: [200, 180, 40], Mordor: [10, 10, 10] }, "the target's Gondor colour wins");
  assert.deepEqual(plan.flags, { Gondor: "data:image/png;base64,AAAA" }, "a flag the target lacks arrives even for a known country");
  assert.deepEqual(plan.tags, { Gondor: ["monarchy"] }, "tags arrive only where the target has none");
  assert.deepEqual(plan.types.map((t) => t.id), ["steppe"]);
  assert.deepEqual(planClipboardMerge(null, {}), { upserts: {}, colorOverrides: {}, flags: {}, tags: {}, types: [] });
});

test("a pasted region keeps a free id and gets a fresh one for a taken id", () => {
  let n = 0;
  const mint = () => `reg_new${(n += 1)}`;
  const ids = resolvePastedIds(["FRA.1_1", "FRA.2_1", null, "reg_new1"], new Set(["FRA.2_1", "reg_new1"]), mint);
  assert.equal(ids.get("FRA.1_1"), "FRA.1_1");
  assert.equal(ids.get("FRA.2_1"), "reg_new2", "taken, and reg_new1 was taken too");
  assert.equal(ids.get(null), "reg_new3");
  assert.equal(ids.get("reg_new1"), "reg_new4");
  assert.equal(new Set(ids.values()).size, 4, "all distinct");
});

test("the panel summary counts regions per owner", () => {
  const payload = buildClipboardPayload({ regions, doc: sourceDoc, colors: sourceColors, sourceName: "Middle-earth" });
  const summary = describeClipboard(payload);
  assert.equal(summary.count, 4);
  assert.equal(summary.source, "Middle-earth");
  assert.deepEqual(summary.owners, [
    { key: "Gondor", name: "Gondor", count: 2 },
    { key: "", name: "No owner", count: 1 },
    { key: "Rohan", name: "Rohan", count: 1 },
  ]);
  assert.equal(describeClipboard(null), null);
});

test("the day a clipboard was copied is written so the translator reads it as that day", () => {
  // 8 January, whatever the browser's locale: a day-first "8/1/2026" was read
  // month first by the translator and shown as 1 August.
  const day = formatCopiedDay(new Date(2026, 0, 8, 12).getTime());
  assert.equal(day, "Jan 8, 2026");
  assert.equal(createDateLocalizer("fr")(day), "8 janv. 2026");
  assert.equal(createDateLocalizer("fr")(formatCopiedDay(new Date(2026, 0, 25, 12).getTime())), "25 janv. 2026", "a day above 12 is not dropped");
  assert.equal(formatCopiedDay(Number.NaN), "");
});
