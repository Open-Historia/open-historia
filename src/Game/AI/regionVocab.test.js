/*! Open Historia — region vocabulary tests © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// Run: node --test src/Game/AI/regionVocab.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRegionOwnershipText,
  regionOwnerCode,
  FOCUS_INTRO,
  ROSTER_INTRO,
} from "./regionVocab.js";

const CATALOG = [
  { id: "FRA.1_1", name: "Bourgogne", country: "France", countryCode: "FRA" },
  { id: "FRA.2_1", name: "Bretagne", country: "France", countryCode: "FRA" },
  { id: "DEU.1_1", name: "Bayern", country: "Germany", countryCode: "DEU" },
  { id: "DEU.2_1", name: "Ostpreußen", country: "Germany", countryCode: "DEU" },
  { id: "DEU.3_1", name: "Sachsen", country: "Germany", countryCode: "DEU" },
];
// Split a rendered result into its two sections for targeted assertions.
const sections = (text) => {
  const fi = text.indexOf(FOCUS_INTRO);
  const ri = text.indexOf(ROSTER_INTRO);
  return {
    focus: fi >= 0 ? text.slice(fi, ri >= 0 ? ri : undefined) : "",
    roster: ri >= 0 ? text.slice(ri) : "",
  };
};

// ---- Group A: regionOwnerCode ----------------------------------------------

test("A1 override wins over base country", () => {
  assert.equal(regionOwnerCode(CATALOG[2], { "DEU.1_1": "FRA" }), "FRA");
});
test("A2 falls back to base countryCode with no override", () => {
  assert.equal(regionOwnerCode(CATALOG[0], {}), "FRA");
});
test("A3 falls back to country NAME when countryCode is absent", () => {
  assert.equal(regionOwnerCode({ id: "X", name: "X", country: "Freedonia" }, {}), "Freedonia");
});
test("A4 empty overrides object → base owner", () => {
  assert.equal(regionOwnerCode(CATALOG[1], {}), "FRA");
});
test("A5 null overrides → base owner, no throw", () => {
  assert.equal(regionOwnerCode(CATALOG[1], null), "FRA");
});
test("A6 undefined region → empty string, no throw", () => {
  assert.equal(regionOwnerCode(undefined, {}), "");
});
test("A7 whitespace override is trimmed", () => {
  assert.equal(regionOwnerCode(CATALOG[0], { "FRA.1_1": "  SOV  " }), "SOV");
});
test("A8 empty-string override falls through to base", () => {
  assert.equal(regionOwnerCode(CATALOG[0], { "FRA.1_1": "   " }), "FRA");
});

// ---- Group B: grouping / stock map -----------------------------------------

test("B1 stock map (no overrides) groups every owner — the core gap", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA", "DEU"] });
  assert.match(text, /- FRA \[2 regions\]:/);
  assert.match(text, /- DEU \[3 regions\]:/);
});
test("B2 counts are correct per owner", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["DEU"] });
  assert.match(text, /- DEU \[3 regions\]/);
});
test("B3 regions render as `name (id)`", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA"] });
  assert.match(text, /Bourgogne \(FRA\.1_1\)/);
  assert.match(text, /Bretagne \(FRA\.2_1\)/);
});
test("B4 a region appears exactly once", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA", "DEU"] });
  assert.equal(text.split("Bayern (DEU.1_1)").length - 1, 1);
});
test("B5 an override moves a region into the new owner's group and updates counts", () => {
  const text = buildRegionOwnershipText(CATALOG, { "DEU.1_1": "FRA" }, { focusCodes: ["FRA", "DEU"] });
  assert.match(sections(text).focus, /- FRA \[3 regions\]:[\s\S]*Bayern \(DEU\.1_1\)/);
  assert.match(sections(text).focus, /- DEU \[2 regions\]:/);
});
test("B6 multiple overrides all apply", () => {
  const text = buildRegionOwnershipText(CATALOG, { "DEU.1_1": "FRA", "DEU.2_1": "FRA" }, { focusCodes: ["FRA"] });
  assert.match(text, /- FRA \[4 regions\]/);
});
test("B7 all-unowned catalog → safe line", () => {
  const text = buildRegionOwnershipText([{ id: "z", name: "Z" }], {});
  assert.match(text, /No region ownership could be determined/);
});
test("B8 deterministic — same input twice yields identical output", () => {
  const a = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA"] });
  const b = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA"] });
  assert.equal(a, b);
});

// ---- Group C: focus section ------------------------------------------------

test("C1 focus codes get full region lists", () => {
  const { focus } = sections(buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA"] }));
  assert.match(focus, /Bourgogne \(FRA\.1_1\)/);
});
test("C2 focus order is preserved", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["DEU", "FRA"] });
  assert.ok(text.indexOf("- DEU") < text.indexOf("- FRA"));
});
test("C3 focus matching is case-insensitive", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["fra"] });
  assert.match(sections(text).focus, /- FRA \[2 regions\]/);
});
test("C4 a focus code absent from the map is skipped gracefully", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["ZZZ", "FRA"] });
  assert.match(sections(text).focus, /- FRA \[2 regions\]/);
  assert.doesNotMatch(text, /ZZZ/);
});
test("C5 focus powers are excluded from the roster (no duplication)", () => {
  const { roster } = sections(buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA"] }));
  assert.doesNotMatch(roster, /- FRA /);
});
test("C6 FOCUS_INTRO is present when there is a focus set", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA"] });
  assert.ok(text.includes(FOCUS_INTRO));
});
test("C7 no focus set → no FOCUS_INTRO, roster only", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: [] });
  assert.ok(!text.includes(FOCUS_INTRO));
  assert.ok(text.includes(ROSTER_INTRO));
});
test("C8 ownerCap truncates a focus group with a visible (+N more)", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["DEU"], ownerCap: 1 });
  assert.match(text, /- DEU \[3 regions\]: Bayern \(DEU\.1_1\), \(\+2 more\)/);
});
test("C9 focusTotalCap drops an unfittable focus power down into the roster", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA", "DEU"], focusTotalCap: 2, ownerCap: 40 });
  assert.match(sections(text).focus, /- FRA \[2 regions\]/);
  assert.match(sections(text).roster, /- DEU — 3 regions/);
  assert.doesNotMatch(sections(text).roster, /Bayern/); // roster carries no province names
});
test("C10 focus header shows the polity display name", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA"], polityNames: { fra: "French Republic" } });
  assert.match(text, /- FRA \(French Republic\) \[2 regions\]/);
});
test("C11 focus region list preserves catalog order within a group", () => {
  const { focus } = sections(buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["DEU"] }));
  assert.ok(focus.indexOf("Bayern") < focus.indexOf("Ostpreußen"));
  assert.ok(focus.indexOf("Ostpreußen") < focus.indexOf("Sachsen"));
});
test("C12 focus region with an empty id renders name-only", () => {
  const cat = [{ id: "", name: "Nowhere", countryCode: "FRA" }];
  const text = buildRegionOwnershipText(cat, {}, { focusCodes: ["FRA"] });
  assert.match(text, /- FRA \[1 region\]: Nowhere\b/);
  assert.doesNotMatch(text, /Nowhere \(/);
});

// ---- Group D: roster section -----------------------------------------------

test("D1 roster lists a non-focus owner as `CODE — N regions`", () => {
  const { roster } = sections(buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA"] }));
  assert.match(roster, /- DEU — 3 regions/);
});
test("D2 roster carries NO province names", () => {
  const { roster } = sections(buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA"] }));
  assert.doesNotMatch(roster, /Bayern|Sachsen|Ostpreußen/);
});
test("D3 roster is sorted by region count descending", () => {
  const cat = [
    { id: "A.1", name: "a1", countryCode: "AAA" },
    { id: "B.1", name: "b1", countryCode: "BBB" },
    { id: "B.2", name: "b2", countryCode: "BBB" },
    { id: "C.1", name: "c1", countryCode: "CCC" },
    { id: "C.2", name: "c2", countryCode: "CCC" },
    { id: "C.3", name: "c3", countryCode: "CCC" },
  ];
  const { roster } = sections(buildRegionOwnershipText(cat, {}, { focusCodes: [] }));
  assert.ok(roster.indexOf("- CCC") < roster.indexOf("- BBB"));
  assert.ok(roster.indexOf("- BBB") < roster.indexOf("- AAA"));
});
test("D4 roster ties break by code ascending", () => {
  const cat = [
    { id: "B.1", name: "b", countryCode: "BBB" },
    { id: "A.1", name: "a", countryCode: "AAA" },
  ];
  const { roster } = sections(buildRegionOwnershipText(cat, {}, { focusCodes: [] }));
  assert.ok(roster.indexOf("- AAA") < roster.indexOf("- BBB"));
});
test("D5 rosterCap truncates with a (+K more) marker", () => {
  const cat = Array.from({ length: 5 }, (_, i) => ({ id: `C${i}.1`, name: `r${i}`, countryCode: `C${i}` }));
  const text = buildRegionOwnershipText(cat, {}, { focusCodes: [], rosterCap: 2 });
  assert.match(text, /\(\+3 more powers not listed for brevity\.\)/);
});
test("D6 ROSTER_INTRO present when the roster is non-empty", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA"] });
  assert.ok(text.includes(ROSTER_INTRO));
});
test("D7 every owner in focus → no roster section", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA", "DEU"] });
  assert.ok(!text.includes(ROSTER_INTRO));
});
test("D8 roster header shows the polity display name", () => {
  const { roster } = sections(buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA"], polityNames: { deu: "Germany" } }));
  assert.match(roster, /- DEU \(Germany\) — 3 regions/);
});
test("D9 singular '1 region' in the roster", () => {
  const cat = [
    { id: "A.1", name: "a", countryCode: "AAA" },
    { id: "B.1", name: "b", countryCode: "BBB" },
  ];
  const { roster } = sections(buildRegionOwnershipText(cat, {}, { focusCodes: ["AAA"] }));
  assert.match(roster, /- BBB — 1 region\b/);
});
test("D10 rosterOmitted count is exact", () => {
  const cat = Array.from({ length: 4 }, (_, i) => ({ id: `C${i}.1`, name: `r${i}`, countryCode: `C${i}` }));
  const text = buildRegionOwnershipText(cat, {}, { focusCodes: [], rosterCap: 1 });
  assert.match(text, /\(\+3 more powers not listed/);
});

// ---- Group E: polityNames / formatting -------------------------------------

test("E1 polityNames keyed by lowercase code", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA"], polityNames: { fra: "France" } });
  assert.match(text, /- FRA \(France\)/);
});
test("E2 polityNames keyed by original-case label", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA"], polityNames: { FRA: "France" } });
  assert.match(text, /- FRA \(France\)/);
});
test("E3 display name equal to the code (any case) is not repeated", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["FRA"], polityNames: { fra: "fra" } });
  assert.doesNotMatch(text, /- FRA \(fra\)/);
  assert.match(text, /- FRA \[2 regions\]/);
});
test("E4 singular '1 region' vs plural in the focus section", () => {
  const cat = [{ id: "A.1", name: "solo", countryCode: "AAA" }];
  const text = buildRegionOwnershipText(cat, {}, { focusCodes: ["AAA"] });
  assert.match(text, /- AAA \[1 region\]:/);
});
test("E5 diacritics in region names are preserved verbatim", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: ["DEU"] });
  assert.match(text, /Ostpreußen \(DEU\.2_1\)/);
});
test("E6 a region with an empty name falls back to its id", () => {
  const cat = [{ id: "FRA.9_1", name: "", countryCode: "FRA" }];
  const text = buildRegionOwnershipText(cat, {}, { focusCodes: ["FRA"] });
  assert.match(text, /FRA\.9_1 \(FRA\.9_1\)/);
});

// ---- Group F: bounds / safety / robustness ---------------------------------

test("F1 empty catalog → safe line, never throws", () => {
  assert.match(buildRegionOwnershipText([], {}), /No region catalog is available/);
});
test("F2 null catalog → safe line, never throws", () => {
  assert.match(buildRegionOwnershipText(null, null), /No region catalog is available/);
});
test("F3 undefined options → does not throw and still groups", () => {
  const text = buildRegionOwnershipText(CATALOG, {});
  assert.match(text, /- (FRA|DEU) —/); // no focus → all owners in the roster
});
test("F4 large catalog respects focusTotalCap and ownerCap", () => {
  const big = [];
  for (let c = 0; c < 40; c += 1) {
    for (let r = 0; r < 40; r += 1) big.push({ id: `C${c}.${r}`, name: `r${c}_${r}`, countryCode: `C${c}` });
  }
  const focusCodes = Array.from({ length: 40 }, (_, c) => `C${c}`);
  const text = buildRegionOwnershipText(big, {}, { focusCodes, ownerCap: 10, focusTotalCap: 100, rosterCap: 80 });
  // No focus group lists more than ownerCap regions.
  for (const line of text.split("\n")) {
    if (!line.includes("]: ")) continue;
    const listed = (line.match(/\(C\d+\.\d+\)/g) || []).length;
    assert.ok(listed <= 10, `a focus group listed ${listed} > ownerCap`);
  }
  // Total focus regions emitted is bounded by focusTotalCap.
  const totalFocusRegions = (text.slice(0, text.indexOf(ROSTER_INTRO)).match(/\(C\d+\.\d+\)/g) || []).length;
  assert.ok(totalFocusRegions <= 100, `emitted ${totalFocusRegions} > focusTotalCap`);
});
test("F5 focusCodes empty array → roster only", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: [] });
  assert.ok(!text.includes(FOCUS_INTRO));
  assert.match(text, /- FRA — 2 regions/);
});
test("F6 null overrides still groups by base country", () => {
  const text = buildRegionOwnershipText(CATALOG, null, { focusCodes: ["FRA"] });
  assert.match(text, /- FRA \[2 regions\]/);
});
test("F7 whitespace-padded owner codes group together", () => {
  const cat = [
    { id: "A.1", name: "a1", countryCode: " AAA " },
    { id: "A.2", name: "a2", countryCode: "AAA" },
  ];
  const text = buildRegionOwnershipText(cat, {}, { focusCodes: ["AAA"] });
  assert.match(text, /- AAA \[2 regions\]/);
});
test("F8 a fully-blank region row (no name, no id, no owner) is skipped", () => {
  const cat = [{ id: "", name: "", country: "", countryCode: "" }, ...CATALOG];
  const text = buildRegionOwnershipText(cat, {}, { focusCodes: ["FRA", "DEU"] });
  assert.match(text, /- FRA \[2 regions\]/); // unchanged; blank row contributed nothing
});
test("F9 duplicate region ids under different owners are each grouped", () => {
  const cat = [
    { id: "DUP", name: "Georgia", countryCode: "USA" },
    { id: "DUP", name: "Georgia", countryCode: "GEO" },
  ];
  const { roster } = sections(buildRegionOwnershipText(cat, {}, { focusCodes: [] }));
  assert.match(roster, /- GEO — 1 region/);
  assert.match(roster, /- USA — 1 region/);
});
test("F10 override to a brand-new owner code creates that group", () => {
  const text = buildRegionOwnershipText(CATALOG, { "FRA.1_1": "SOV" }, { focusCodes: ["SOV"] });
  assert.match(text, /- SOV \[1 region\]: Bourgogne \(FRA\.1_1\)/);
});
test("F11 same content, different call → structurally identical (no hidden state)", () => {
  const opts = { focusCodes: ["FRA"], polityNames: { fra: "France" } };
  assert.equal(
    buildRegionOwnershipText(CATALOG, {}, opts),
    buildRegionOwnershipText(CATALOG.slice(), { ...{} }, { ...opts, focusCodes: ["FRA"] }),
  );
});
test("F12 non-array focusCodes is treated as empty (no throw)", () => {
  const text = buildRegionOwnershipText(CATALOG, {}, { focusCodes: "FRA" });
  assert.ok(!text.includes(FOCUS_INTRO));
});
