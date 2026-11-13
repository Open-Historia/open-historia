// Run: node --test src/Game/AI/historyTiersFold.test.js
//
// Needs a full install: promptContext.js -> assets.js -> maplibre-gl.
//
// The history in tiers as a time skip's fold writes it, the save keeps it and
// the next skip reads it: a fold's years and canon are taken, a campaign from
// before the tiers keeps its document as its first era, and the canon stays,
// in the save and on the page, across any number of folds.
import test from "node:test";
import assert from "node:assert/strict";

import {
  applyHistoryDocumentUpdate,
  judgeSkipHistoryAnswer,
  yearSpanOf,
} from "./historyConsolidation.js";
import { buildConsolidatedHistoryText } from "./promptContext.js";
import { normalizeWorldState } from "../../runtime/gameState.js";
import { foldJumpTool, getGameplayTool, HISTORY_FIELD } from "./gameplaySchemas.js";

const paragraph = (label) => `${label} saw ministers fall, armies move to the frontier, two treaties signed and a winter of hunger in the north.`;

test("a fold in tiers is taken, and judged entry by entry", () => {
  const judged = judgeSkipHistoryAnswer({
    summary: "A long summary of the period.",
    years: [{ year: 1936, text: paragraph("1936") }, { year: 1990, text: paragraph("1990") }],
    canon: [{ date: "1936-07-18", kind: "war", text: "The Ruritanian civil war begins." }],
  }, { span: [1936, 1936] });
  assert.equal(judged.ok, true);
  assert.deepEqual(judged.tiers.years.map((entry) => entry.year), [1936]);
  assert.equal(judged.tiers.canon.length, 1);
  assert.match(judged.reason, /outside the years folded/);
  // A summary alone still appends, and its canon rides with it.
  const thin = judgeSkipHistoryAnswer({ summary: Array.from({ length: 50 }, () => "word").join(" "), canon: [{ date: "1936-01-01", kind: "death", text: "The old king dies." }] });
  assert.equal(thin.ok, true);
  assert.equal(thin.tiers.canon.length, 1);
  assert.deepEqual(thin.tiers.years, []);
});

// The skip's own contract names every field of a tier's entry (gameplaySchemas.js
// foldJumpTool): an answer written in exactly those fields is taken whole.
test("a fold written in the skip's own entry shapes is taken, every tier of it", () => {
  const tiers = foldJumpTool(getGameplayTool("jumpForward"), { history: true }).schema.properties[HISTORY_FIELD].properties;
  const entry = (tier, values) => Object.fromEntries(Object.keys(tiers[tier].items.properties).filter((field) => field in values).map((field) => [field, values[field]]));
  const judged = judgeSkipHistoryAnswer({
    summary: "The first year of the war.",
    years: [entry("years", { year: 1936, text: paragraph("1936") })],
    canon: [entry("canon", { date: "1936-07-18", kind: "war", text: "The Ruritanian civil war begins.", key: "ruritanian-civil-war" })],
    eras: [entry("eras", { from: 1930, to: 1935, text: paragraph("The early thirties") })],
  }, { span: [1936, 1936] });
  assert.equal(judged.ok, true, judged.reason);
  assert.deepEqual(judged.tiers.years, [{ year: 1936, text: paragraph("1936") }]);
  assert.deepEqual(judged.tiers.canon, [{ date: "1936-07-18", kind: "war", text: "The Ruritanian civil war begins.", key: "ruritanian-civil-war" }]);
  assert.equal(judged.tiers.eras.length, 1);
});

test("a campaign from before the tiers keeps its document as its first era, and its canon is added", () => {
  const world = { historyDocument: { text: "The old document.", revision: 4, throughDate: "1935-12-31" }, canonFacts: [] };
  const update = applyHistoryDocumentUpdate(world, {
    summary: "s",
    throughDate: "1936-12-31",
    tiers: { years: [{ year: 1936, text: paragraph("1936") }], canon: [{ date: "1936-07-18", kind: "war", text: "The civil war begins." }] },
    span: [1936, 1936],
    startYear: 1930,
  });
  assert.equal(update.mode, "tiered");
  assert.deepEqual(update.historyDocument.eras, [{ from: 1930, to: 1935, text: "The old document." }]);
  assert.deepEqual(update.historyDocument.years.map((entry) => entry.year), [1936]);
  assert.equal(update.historyDocument.revision, 5);
  assert.equal(update.canonFacts.length, 1);
  const stored = normalizeWorldState({ ...world, historyDocument: update.historyDocument, canonFacts: update.canonFacts });
  assert.deepEqual(stored.historyDocument.years, update.historyDocument.years);
  assert.deepEqual(stored.canonFacts, update.canonFacts);
  const text = buildConsolidatedHistoryText(stored);
  assert.match(text, /^CANON \(standing facts[^\n]*\n- 1936-07-18 \(war\): The civil war begins\.\n\nHistory \(maintained across consolidations, through 1936-12-31\):\nEARLIER YEARS, IN ERAS:\n1930–1935: The old document\.\n\nYEAR BY YEAR:\n1936: 1936 saw/);
});

test("canon facts persist across many folds through the save, and stay on the page", () => {
  let world = normalizeWorldState({
    historyDocument: { text: "Before the war.", revision: 1, throughDate: "1913-12-31" },
    canonFacts: [{ date: "1914-06-28", kind: "death", text: "Archduke Rudolf is assassinated in Brod." }],
  });
  for (let fold = 0; fold < 40; fold += 1) {
    const year = 1915 + fold;
    const answer = judgeSkipHistoryAnswer({
      summary: `The year ${year}, in brief.`,
      years: [{ year, text: paragraph(String(year)) }],
      canon: fold === 3 ? [{ date: "1918-11-11", kind: "treaty", text: "Armistice of Zenda ends the Great War." }] : [],
      // A model that "condenses" the eras to nothing is refused.
      eras: fold === 20 ? [{ from: 1900, to: 1930, text: "Short." }] : undefined,
    }, { span: [year, year], eraWords: 400 });
    const update = applyHistoryDocumentUpdate(world, { summary: answer.summary, tiers: answer.tiers, span: [year, year], startYear: 1900, throughDate: `${year}-12-31` });
    world = normalizeWorldState(JSON.parse(JSON.stringify({ ...world, historyDocument: update.historyDocument, canonFacts: update.canonFacts })));
  }
  const facts = world.canonFacts.map((fact) => fact.text);
  assert.ok(facts.includes("Archduke Rudolf is assassinated in Brod."));
  assert.ok(facts.includes("Armistice of Zenda ends the Great War."));
  assert.equal(world.historyDocument.years.length, 3);
  assert.deepEqual(world.historyDocument.years.map((entry) => entry.year), [1952, 1953, 1954]);
  assert.match(world.historyDocument.eras[0].text, /Before the war\./, "the oldest era is never condensed to a stub");
  const page = buildConsolidatedHistoryText(world, { maxChars: 4000 });
  assert.match(page, /Archduke Rudolf is assassinated in Brod\./);
  assert.match(page, /Armistice of Zenda ends the Great War\./);
  assert.match(page, /1954: 1954 saw/);
});

test("the years a fold covers come from its events' dates", () => {
  assert.deepEqual(yearSpanOf([{ date: "1936-03-01" }, { date: "1938-01-01" }, { date: "" }]), [1936, 1938]);
  assert.deepEqual(yearSpanOf([{ date: "-0218-03-01" }]), [-218, -218]);
  assert.equal(yearSpanOf([]), null);
});

// The story so far changes only when a fold is written: a skip carries it in its
// cached opening, and its event history points there.
test("a skip carries the story so far in its cached opening; other tasks keep it with the events", async () => {
  const { buildPromptContext } = await import("./promptContext.js");
  const { STATIC_PROMPT_KEYS } = await import("./promptLayout.js");
  const bundle = {
    game: { country: "Ruritania", gameDate: "1937-01-01", round: 9, startDate: "1930-01-01" },
    world: normalizeWorldState({ historyDocument: { text: "", years: [{ year: 1936, text: paragraph("1936") }], revision: 2 }, canonFacts: [{ date: "1936-07-18", kind: "war", text: "The civil war begins." }] }),
    events: [], actions: [], chats: [],
  };
  const skip = await buildPromptContext(bundle, { requiredKeys: ["campaignHistory", "recentEventsLong"], taskKey: "jumpForward" });
  assert.match(skip.campaignHistory, /^\[The Story So Far\]\n[^\n]*\nCANON[\s\S]*The civil war begins\.[\s\S]*1936: 1936 saw[\s\S]*\n\n$/);
  assert.match(skip.recentEventsLong, /^STORY SO FAR:\nUnder \[The Story So Far\] above\.\n/);
  assert.ok(STATIC_PROMPT_KEYS.has("campaignHistory") && STATIC_PROMPT_KEYS.has("CAMPAIGN_HISTORY"));
  const other = await buildPromptContext(bundle, { requiredKeys: ["campaignHistory", "recentEventsLong"], taskKey: "actions" });
  assert.equal(other.campaignHistory, "");
  assert.match(other.recentEventsLong, /The civil war begins\./);
});
