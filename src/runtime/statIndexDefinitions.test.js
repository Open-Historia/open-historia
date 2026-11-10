import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_STAT_INDEX_KEYS,
  MAX_STAT_INDICES,
  normalizeCustomStatValues,
  readCustomStatNumber,
  hasRecordedCustomStatValues,
  normalizeStatIndexRows,
  normalizeStatSheetDefinition,
  serializeStatSheet,
  statSheetKeys,
  toStatIndexKey,
} from "./statIndexDefinitions.js";

test("stat index compatibility still falls back to the stock six", () => {
  const rows = normalizeStatIndexRows(null);
  assert.deepEqual(rows.map((row) => row.key), [...DEFAULT_STAT_INDEX_KEYS]);
});

test("legacy V1 indices migrate into a full custom sheet without changing stable keys", () => {
  const definition = normalizeStatSheetDefinition({
    indices: [
      { key: "timber", label: "Timber supply", icon: "🪵", color: "#22C55E", description: "Usable timber access." },
      { key: "goldAccess", label: "Gold access", icon: "🪙", color: "#eab308" },
    ],
  });

  assert.equal(definition.custom, true);
  assert.equal(definition.sections.length, 1);
  assert.equal(definition.sections[0].key, "strategic");
  assert.deepEqual(statSheetKeys(definition), ["timber", "goldAccess"]);
  assert.equal(definition.sections[0].stats[0].color, "#22c55e");
});

test("full-sheet sections preserve order, types, units, and deterministic unique keys", () => {
  const definition = normalizeStatSheetDefinition({
    version: 2,
    sections: [
      {
        label: "Resources",
        icon: "🧰",
        stats: [
          { label: "Timber", kind: "index", icon: "🪵" },
          { label: "Timber", kind: "number", suffix: "tonnes", compact: true },
          { key: "treasury", label: "Treasury", kind: "currency", prefix: "ℳ", decimals: 2, minimum: 0 },
        ],
      },
      {
        label: "Population",
        stats: [{ key: "settlers", label: "Settlers", kind: "number", suffix: "people", minimum: 0 }],
      },
    ],
  });

  assert.equal(definition.custom, true);
  assert.deepEqual(definition.sections.map((section) => section.key), ["resources", "population"]);
  assert.deepEqual(statSheetKeys(definition), ["timber", "timber2", "treasury", "settlers"]);
  assert.equal(definition.sections[0].stats[0].kind, "index");
  assert.equal(definition.sections[0].stats[0].minimum, 0);
  assert.equal(definition.sections[0].stats[0].maximum, 100);
  assert.equal(definition.sections[0].stats[1].suffix, "tonnes");
  assert.equal(definition.sections[0].stats[2].prefix, "ℳ");
  assert.equal(definition.sections[0].stats[2].decimals, 2);
});

test("custom values clamp and round according to their scenario definitions", () => {
  const definition = normalizeStatSheetDefinition({
    sections: [{
      label: "Resources",
      stats: [
        { key: "timber", label: "Timber", kind: "index" },
        { key: "silver", label: "Silver", kind: "number", minimum: 0, maximum: 10000, decimals: 1 },
        { key: "balance", label: "Balance", kind: "percentage", minimum: -100, maximum: 100, decimals: 2 },
      ],
    }],
  });

  assert.deepEqual(normalizeCustomStatValues({ timber: 104.2, silver: 42.267, balance: -12.345 }, definition), {
    timber: 100,
    silver: 42.3,
    balance: -12.35,
  });
});

test("serialized V2 sheet contains canonical persistent fields, not editor metadata", () => {
  const sheet = serializeStatSheet({
    custom: true,
    sections: [{
      key: "resources",
      label: "Resources",
      icon: "🧰",
      draftId: "ui-section",
      isNew: true,
      stats: [{
        key: "timber",
        label: "Timber",
        kind: "number",
        icon: "🪵",
        color: "#22c55e",
        description: "Supply",
        suffix: "tonnes",
        decimals: 0,
        compact: true,
        minimum: 0,
        isNew: true,
        draftId: "ui-stat",
      }],
    }],
  });

  assert.equal(sheet.version, 2);
  assert.equal(sheet.sections.length, 1);
  assert.equal(sheet.sections[0].key, "resources");
  assert.equal(sheet.sections[0].stats[0].key, "timber");
  assert.equal(sheet.sections[0].stats[0].kind, "number");
  assert.equal(sheet.sections[0].stats[0].suffix, "tonnes");
  assert.equal(sheet.sections[0].stats[0].draftId, undefined);
  assert.equal(sheet.sections[0].stats[0].isNew, undefined);
});

test("legacy key generation and index bounding remain deterministic", () => {
  const input = Array.from({ length: MAX_STAT_INDICES + 4 }, (_, index) => ({
    label: index < 2 ? "Timber" : `Metric ${index}`,
  }));
  const rows = normalizeStatIndexRows(input, { fallback: false });

  assert.equal(rows.length, MAX_STAT_INDICES);
  assert.equal(rows[0].key, "timber");
  assert.equal(rows[1].key, "timber2");
  assert.equal(toStatIndexKey("Horse & cart capacity"), "horseCartCapacity");
});

test("custom numeric values distinguish unavailable data from recorded zero", () => {
  const definition = { sections: [{ key: "finances", label: "Finances", stats: [
    { key: "treasury", label: "Treasury", kind: "currency", suffix: "silver marks", minimum: 0, decimals: 2 },
  ] }] };
  for (const value of [undefined, null, "", "  ", false, true, [], [0], {}, NaN, Infinity, -Infinity, "unknown", "12 marks"]) {
    assert.equal(readCustomStatNumber(value), null);
    assert.deepEqual(normalizeCustomStatValues({ treasury: value }, definition), {});
    assert.deepEqual(normalizeCustomStatValues({ treasury: value }, definition, { partial: true }), {});
  }
  for (const value of [0, "0", " 0 "]) {
    assert.equal(readCustomStatNumber(value), 0);
    assert.deepEqual(normalizeCustomStatValues({ treasury: value }, definition), { treasury: 0 });
  }
  assert.equal(readCustomStatNumber(" -12.5 "), -12.5);
  assert.deepEqual(normalizeCustomStatValues({ treasury: 12.345 }, definition), { treasury: 12.35 });
  assert.deepEqual(normalizeCustomStatValues({ treasury: -5 }, definition), { treasury: 0 });
});

test("a partial scenario sheet is displayable without declaring it complete", () => {
  const definition = { sections: [{ key: "realm", label: "Realm", stats: [
    { key: "treasury", label: "Treasury", kind: "currency" },
    { key: "grain", label: "Grain reserves", kind: "number" },
  ] }] };
  assert.equal(hasRecordedCustomStatValues({ treasury: 0 }, definition), true);
  assert.equal(hasRecordedCustomStatValues({ treasury: 1200 }, definition), true);
  assert.equal(hasRecordedCustomStatValues({ unrelated: 12 }, definition), false);
  assert.equal(hasRecordedCustomStatValues({ treasury: " " }, definition), false);
  assert.equal(hasRecordedCustomStatValues(undefined, definition), false);
});
