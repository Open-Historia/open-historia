// Run: node --test src/runtime/historyTiers.test.js
//
// The history in tiers, and the canon that never fades: what a fold's answer
// gives is taken entry by entry, years roll into eras, and a canon fact stays
// in the save, and on the page, across any number of folds.
import test from "node:test";
import assert from "node:assert/strict";

import {
  HISTORY_TIERS,
  eraWordCount,
  judgeHistoryTiers,
  mergeHistoryTiers,
  normalizeCanonFacts,
  renderCanonFacts,
  renderHistoryTiers,
} from "./historyTiers.js";

const paragraph = (label) => `${label} saw ministers fall, armies move to the frontier, two treaties signed and a winter of hunger in the north.`;

test("a fold's tiers are taken entry by entry: thin, misplaced and undated entries are left out and said so", () => {
  const judged = judgeHistoryTiers({
    years: [{ year: 1931, text: paragraph("1931") }, { year: 1931.5, text: "too short" }, { year: 1950, text: paragraph("1950") }],
    canon: [{ date: "1931-04-02", kind: "treaty", text: "Treaty of Brod: Slavonia cedes the Vale to Ruritania." }, { kind: "death", text: "no date" }],
  }, { span: [1930, 1931] });
  assert.deepEqual(judged.years.map((entry) => entry.year), [1931]);
  assert.equal(judged.canon.length, 1);
  assert.equal(judged.notes.length, 3);
  assert.equal(judged.any, true);
  assert.equal(judgeHistoryTiers({}).any, false);
});

test("a revision of the eras that would throw most of them away is a stub, and is not taken", () => {
  const judged = judgeHistoryTiers({ eras: [{ from: 1900, to: 1920, text: paragraph("The early years") }] }, { eraWords: 900 });
  assert.equal(judged.eras, null);
  const kept = judgeHistoryTiers({ eras: [{ from: 1900, to: 1920, text: paragraph("The early years") }] }, { eraWords: 30 });
  assert.equal(kept.eras.length, 1);
});

test("a document from before the tiers becomes the first era, and the newest years stay a paragraph each", () => {
  let document = { text: "The old document: the long war, the peace of 1925, the regency.", throughDate: "1929-12-31" };
  let merged = mergeHistoryTiers(document, { years: [{ year: 1930, text: paragraph("1930") }] }, { startYear: 1914 });
  assert.deepEqual(merged.eras, [{ from: 1914, to: 1929, text: document.text }]);
  assert.deepEqual(merged.years.map((entry) => entry.year), [1930]);
  for (const year of [1931, 1932, 1933, 1934]) {
    document = { ...merged };
    merged = mergeHistoryTiers(document, { years: [{ year, text: paragraph(String(year)) }] });
  }
  assert.deepEqual(merged.years.map((entry) => entry.year), [1932, 1933, 1934]);
  assert.equal(merged.years.length, HISTORY_TIERS.yearsKept);
  assert.equal(merged.eras.length, 1);
  assert.equal(merged.eras[0].to, 1931, "the years that rolled joined the era before them");
  assert.match(merged.eras[0].text, /The old document/);
  assert.match(merged.eras[0].text, /1930: 1930 saw/);
  assert.match(merged.eras[0].text, /1931: 1931 saw/);
});

test("a year written again replaces its paragraph", () => {
  const first = mergeHistoryTiers({}, { years: [{ year: 1930, text: paragraph("Spring 1930") }] });
  const second = mergeHistoryTiers(first, { years: [{ year: 1930, text: paragraph("All of 1930") }] });
  assert.deepEqual(second.years.map((entry) => entry.text), [paragraph("All of 1930")]);
});

test("canon facts persist across many folds, and stay on the page whatever the eras and years forget", () => {
  const founding = { date: "1914-06-28", kind: "death", text: "Archduke Rudolf is assassinated in Brod." };
  const treaty = { date: "1919-06-28", kind: "treaty", text: "Treaty of Zenda: Slavonia cedes the Vale to Ruritania for ever." };
  let canon = [founding, treaty];
  let document = {};
  for (let fold = 0; fold < 60; fold += 1) {
    const year = 1920 + fold;
    const judged = judgeHistoryTiers({
      years: [{ year, text: paragraph(String(year)) }],
      canon: [{ date: `${year}-03-01`, kind: "office", key: "Chancellor of Ruritania", text: `Chancellor No. ${fold} takes office.` }],
    }, { span: [year, year] });
    canon = normalizeCanonFacts([...canon, ...judged.canon]);
    const merged = mergeHistoryTiers(document, judged);
    // Each fold the eras are condensed to almost nothing, as a careless model might.
    document = { ...merged, eras: merged.eras.length ? [{ ...merged.eras.at(-1), from: merged.eras[0].from, text: "Condensed." }] : [] };
  }
  assert.ok(canon.some((fact) => fact.text === founding.text), "the oldest death is still canon");
  assert.ok(canon.some((fact) => fact.text === treaty.text), "the oldest treaty is still canon");
  const page = renderCanonFacts(canon);
  assert.match(page, /Archduke Rudolf is assassinated in Brod/);
  assert.match(page, /Treaty of Zenda/);
  assert.match(page, /Chancellor No\. 59 takes office/);
  assert.doesNotMatch(page, /Chancellor No\. 58 takes office/, "an office holder is superseded on the page by the next");
  assert.equal(canon.filter((fact) => fact.key === "Chancellor of Ruritania").length, 60, "and kept in the save");
});

test("the canon keeps at most its limit, letting superseded facts go first", () => {
  const facts = [
    { date: "1900-01-01", kind: "treaty", text: "The first treaty." },
    ...Array.from({ length: HISTORY_TIERS.canonMost + 10 }, (_, index) => ({ date: `${1901 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`, kind: "office", key: "Mayor", text: `Mayor ${index}.` })),
  ];
  const kept = normalizeCanonFacts(facts);
  assert.equal(kept.length, HISTORY_TIERS.canonMost);
  assert.equal(kept[0].text, "The first treaty.");
});

test("each tier has its own budget, newest kept and the rest counted", () => {
  const years = Array.from({ length: 3 }, (_, index) => ({ year: 1930 + index, text: paragraph(String(1930 + index)).repeat(30) }));
  const eras = Array.from({ length: 12 }, (_, index) => ({ from: 1800 + index * 10, to: 1809 + index * 10, text: paragraph("An era").repeat(8) }));
  const text = renderHistoryTiers({ years, eras });
  assert.match(text, /^EARLIER YEARS, IN ERAS:\n\[\d+ older era\(s\) omitted here; they remain in the save\.\]/);
  assert.match(text, /1910–1919: |1900–1909: /);
  assert.match(text, /YEAR BY YEAR:/);
  assert.match(text, /1932: 1932 saw/);
  assert.equal(renderHistoryTiers({}), "");
  assert.equal(renderCanonFacts([]), "");
});

// A WW2 save, 2026-11-10: its document from before the tiers covered 1939 and
// early 1940; the first fold in tiers wrote 1940 and 1941 and, unasked, an era
// of 1940–1941 in 50 words, and that era replaced the old text whole.
test("a document from before the tiers is not replaced by a stub of eras, nor by eras that leave its years out", () => {
  const legacy = { text: paragraph("1939").repeat(20), revision: 3, throughDate: "1940-05-12" };
  assert.ok(eraWordCount(legacy) > 300);
  const stub = judgeHistoryTiers({ years: [{ year: 1940, text: paragraph("1940") }, { year: 1941, text: paragraph("1941") }], eras: [{ from: 1940, to: 1941, text: paragraph("1940 and 1941") }] }, { span: [1940, 1941], eraWords: eraWordCount(legacy) });
  assert.equal(stub.eras, null);
  const merged = mergeHistoryTiers(legacy, stub, { startYear: 1939 });
  assert.deepEqual(merged.eras.map((era) => [era.from, era.to]), [[1939, 1939]]);
  assert.equal(merged.eras[0].text, legacy.text);
  assert.deepEqual(merged.years.map((entry) => entry.year), [1940, 1941]);
  // Eras long enough to be taken: an older era they leave out stays, and one of years still kept as paragraphs is not written.
  const long = mergeHistoryTiers(legacy, { years: stub.years, eras: [{ from: 1940, to: 1941, text: paragraph("again").repeat(10) }] }, { startYear: 1939 });
  assert.deepEqual(long.eras.map((era) => [era.from, era.to]), [[1939, 1939]]);
  const condensed = mergeHistoryTiers({ eras: [{ from: 1900, to: 1910, text: "Old." }, { from: 1911, to: 1920, text: "Older." }], years: [{ year: 1930, text: "x" }] }, { eras: [{ from: 1911, to: 1920, text: "Condensed." }] });
  assert.deepEqual(condensed.eras.map((era) => era.text), ["Old.", "Condensed."]);
});
