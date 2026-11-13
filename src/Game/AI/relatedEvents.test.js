import assert from "node:assert/strict";
import test from "node:test";
import {
  RELATED_EVENTS_HEADER,
  RELATED_EVENTS_LIMIT,
  RELATED_EVENTS_MAX_CHARS,
  buildRelatedQueries,
  embeddableEvents,
  relatedEligibility,
  relatedScores,
  renderRelatedPastEvents,
  similarEventsAnswer,
} from "./relatedEvents.js";
import { contentHash, eventEmbeddingText, meanPoolNormalize, EMBEDDING_MODEL, embeddingFileUrl, embeddingModelRoot } from "../../runtime/embeddingModels.js";
import { buildPromptContext } from "./promptContext.js";

const unit = (...values) => {
  const norm = Math.hypot(...values) || 1;
  return Float32Array.from(values.map((value) => value / norm));
};

test("the model is pinned: revision, files and their byte size, served from the game's own address", () => {
  assert.match(EMBEDDING_MODEL.revision, /^[0-9a-f]{40}$/);
  assert.equal(Object.values(EMBEDDING_MODEL.files).reduce((sum, bytes) => sum + bytes, 0), EMBEDDING_MODEL.bytes);
  assert.equal(EMBEDDING_MODEL.bytes, 23685047);
  // The desktop's local server and the Android app serve the build at the root,
  // the website under /play/.
  assert.equal(embeddingFileUrl("onnx/model_quantized.onnx", { base: "/", origin: "http://localhost:3000" }),
    "http://localhost:3000/models/all-MiniLM-L6-v2/onnx/model_quantized.onnx");
  assert.equal(embeddingFileUrl("tokenizer.json", { base: "/play/", origin: "https://openhistoria.com" }),
    "https://openhistoria.com/play/models/all-MiniLM-L6-v2/tokenizer.json");
  assert.equal(embeddingModelRoot("/play", "https://openhistoria.com"), "https://openhistoria.com/play/models/");
  assert.equal(embeddingModelRoot(), "/models/");
});

test("an event is embedded as its title and description; the hash follows the text", () => {
  const event = { id: "e1", title: "  Treaty of Lyon ", description: "France cedes\nSavoy." };
  assert.equal(eventEmbeddingText(event), "Treaty of Lyon. France cedes Savoy.");
  assert.equal(contentHash("a"), contentHash("a"));
  assert.notEqual(contentHash("a"), contentHash("b"));
  assert.notEqual(contentHash("a", "model-1"), contentHash("a", "model-2"), "another model's vector is embedded again");
  // A bare string event has no id of its own: never indexed.
  assert.deepEqual(embeddableEvents(["Scenario start", { id: "e2", title: "" }, event]).map((entry) => entry.id), ["e1"]);
});

test("mean pooling leaves the padding out and scales to length one", () => {
  // Two rows, three tokens, two dims; the second row's last token is padding.
  const hidden = [1, 0, 1, 0, 1, 0, 0, 2, 0, 2, 9, 9];
  const mask = [1n, 1n, 1n, 1n, 1n, 0n];
  const out = meanPoolNormalize(hidden, mask, 2, 3, 2);
  assert.deepEqual([...out.slice(0, 2)], [1, 0]);
  assert.deepEqual([...out.slice(2, 4)], [0, 1], "the padded token's 9s are not averaged in");
});

test("ranking takes each query's nearest events in turn, above the floor", () => {
  const vectors = new Map([
    ["war-1", { vector: unit(1, 0, 0) }],
    ["war-2", { vector: unit(0.95, 0.05, 0) }],
    ["war-3", { vector: unit(0.9, 0.1, 0) }],
    ["treaty", { vector: unit(0, 1, 0) }],
    ["harvest", { vector: unit(0, 0, 1) }],
  ]);
  const ranked = relatedScores([unit(1, 0, 0), unit(0.1, 1, 0)], vectors, { limit: 3 });
  assert.deepEqual(ranked.map((row) => row.id), ["war-1", "treaty", "war-2"], "the treaty is not crowded out by the war's battles");
  assert.ok(ranked.every((row) => row.score > 0.9));
  assert.ok(!relatedScores([unit(1, 0, 0)], vectors).some((row) => row.id === "harvest"), "an unrelated event is left out");
  assert.deepEqual(relatedScores([], vectors), []);
});

test("the turn's queries: pending orders, live wars, live storylines and the powers in focus", () => {
  const queries = buildRelatedQueries({
    game: { country: "Italy" },
    actions: [
      { status: "resolved", title: "Old order" },
      { status: "planned", title: "March on Paris", description: "Take the capital." },
    ],
    world: {
      wars: [
        { status: "active", title: "Franco-Italian War", sideA: ["Italy"], sideB: ["France"] },
        { status: "ended", title: "Old war" },
      ],
      storylines: [{ status: "active", title: "Southern uprising", state: "Prefectures restless." }, { status: "resolved", title: "Done" }],
    },
  }, { focusPowers: ["France", "Italy", "Germany"] });
  assert.deepEqual(queries, [
    "March on Paris. Take the capital.",
    "Franco-Italian War. Italy against France",
    "Southern uprising. Prefectures restless.",
    "Italy, France, Germany",
  ]);
});

// A campaign of 20 events, the first 12 folded into the history.
const events = Array.from({ length: 20 }, (_, at) => ({
  id: `e${at + 1}`,
  date: `1940-${String(Math.floor(at / 2) + 1).padStart(2, "0")}-${at % 2 ? "15" : "01"}`,
  title: `Event ${at + 1}`,
  description: `What happened in event ${at + 1}. `.repeat(20),
  importance: "minor",
}));
const world = { consolidatedHistory: [{ throughEventId: "e12", throughDate: "1940-06-15", summary: "The first half of the year." }] };

test("eligible: folded into the history, or older than the window; never shown", () => {
  const unfolded = events.slice(12);
  const shown = [events[15], events[18]];
  const eligible = relatedEligibility(events, { unfolded, shown });
  assert.equal(eligible(events[0]), true, "folded");
  assert.equal(eligible(events[12]), true, "unfolded, older than the oldest shown");
  assert.equal(eligible(events[15]), false, "shown");
  assert.equal(eligible(events[16]), false, "unfolded and inside the window");
  assert.equal(eligible({ title: "no id" }), false);
});

test("the block: at most six, in date order, within the budget, one line each", () => {
  const candidates = events.map((event, at) => ({ id: event.id, score: 1 - at / 100 })).reverse();
  const block = renderRelatedPastEvents(candidates, { events, unfolded: events.slice(12), shown: events.slice(14) });
  const lines = block.split("\n");
  assert.equal(lines[0], RELATED_EVENTS_HEADER);
  assert.equal(lines.length - 1, RELATED_EVENTS_LIMIT);
  assert.ok(block.length <= RELATED_EVENTS_MAX_CHARS, `${block.length} characters`);
  assert.deepEqual(lines.slice(1).map((line) => line.match(/Event (\d+)/)[1]), ["9", "10", "11", "12", "13", "14"]);
  assert.ok(lines.slice(1).every((line) => line.length <= 240));
  assert.match(lines[1], /^- 1940-05-01: Event 9 — What happened/);
  // A digest is used where the event has one.
  const digested = renderRelatedPastEvents([{ id: "e1" }], { events: [{ ...events[0], digest: "One line." }], unfolded: [], shown: [] });
  assert.match(digested, /Event 1 — One line\.$/);
  // Nothing eligible, nothing at all.
  assert.equal(renderRelatedPastEvents([{ id: "e20" }], { events, unfolded: events.slice(12), shown: [events[19]] }), "");
  assert.equal(renderRelatedPastEvents(null, { events }), "");
});

test("a tight budget drops lines rather than cutting one", () => {
  const block = renderRelatedPastEvents(events.map((event) => ({ id: event.id })), { events, unfolded: [], shown: [], maxChars: 500 });
  assert.ok(block.length <= 500);
  assert.ok(block.split("\n").length >= 2);
});

test("the skip's history carries the related events, never one it already shows, within 2,000 characters", async () => {
  const bundle = { game: { gameDate: "1940-10-20", country: "Italy" }, world, events, actions: [], chats: [], advisor: [] };
  const relatedEvents = events.map((event) => ({ id: event.id, score: 0.5 })).reverse();
  const { recentEventsLong } = await buildPromptContext(bundle, { requiredKeys: ["recentEventsLong"], relatedEvents, longEventLimit: 4 });
  const [history, related] = recentEventsLong.split(`${RELATED_EVENTS_HEADER}\n`);
  assert.ok(related, "the block is there");
  assert.ok(related.length + RELATED_EVENTS_HEADER.length < RELATED_EVENTS_MAX_CHARS);
  const relatedIds = [...related.matchAll(/Event (\d+)/g)].map((match) => Number(match[1]));
  const recent = history.split("RECENT EVENTS:")[1];
  const shownIds = [...recent.matchAll(/^- \S+: Event (\d+)$/gm)].map((match) => Number(match[1]));
  assert.equal(shownIds.length, 4);
  assert.ok(relatedIds.length > 0 && relatedIds.length <= 6);
  assert.deepEqual(relatedIds.filter((id) => shownIds.includes(id)), [], "no event twice");
  assert.ok(relatedIds.every((id) => id <= 12 || id < Math.min(...shownIds)), "folded, or older than the window");
  // Without candidates the history is as it was.
  const plain = await buildPromptContext(bundle, { requiredKeys: ["recentEventsLong"], longEventLimit: 4 });
  assert.equal(plain.recentEventsLong, history.replace(/\n\n$/, ""));
});

test("similar_events answers date, title and summary, closest first", () => {
  const answer = similarEventsAnswer([{ id: "e3", score: 0.812 }, { id: "missing", score: 0.7 }, { id: "e1", score: 0.6 }], events, { limit: 2 });
  assert.deepEqual(answer.events.map((event) => [event.date, event.title, event.similarity]), [["1940-02-01", "Event 3", 0.81], ["1940-01-01", "Event 1", 0.6]]);
  assert.ok(answer.events[0].summary.length <= 200);
  assert.deepEqual(similarEventsAnswer([], events).events, []);
});

test("the worker loads the bundled model from the game's own files only: no model host, no cache, wasm, int8", async () => {
  const { readFileSync } = await import("node:fs");
  const worker = readFileSync(new URL("../../runtime/embeddingWorker.js", import.meta.url), "utf8");
  assert.match(worker, /env\.allowRemoteModels = false;/);
  assert.match(worker, /env\.allowLocalModels = true;/);
  assert.match(worker, /env\.localModelPath = embeddingModelRoot\(BASE, ORIGIN\);/);
  assert.match(worker, /env\.useBrowserCache = false;/);
  assert.match(worker, /from_pretrained\(EMBEDDING_MODEL\.dir, \{\s*local_files_only: true,/);
  assert.match(worker, /new BertTokenizer\(tokenizerJson, tokenizerConfig\)/, "the tokenizer from the game's own files");
  assert.match(worker, /device: "wasm",\s*dtype: "q8"/);
  assert.doesNotMatch(worker, /huggingface\.co|githubusercontent|remoteHost|modelStore/, "nothing fetched from a model host, nothing kept");
  // The copy an older version downloaded is no longer kept from the sweep.
  const assets = readFileSync(new URL("../../runtime/assets.js", import.meta.url), "utf8");
  assert.doesNotMatch(assets, /EMBEDDING_MODEL_CACHE_NAME/);
});

test("with the skip's 'also recent' lines every unfolded event is shown, so only the folded history is searched", async () => {
  const bundle = { game: { gameDate: "1940-10-20", country: "Italy" }, world, events, actions: [], chats: [], advisor: [] };
  const relatedEvents = events.map((event) => ({ id: event.id, score: 0.5 })).reverse();
  const { recentEventsLong } = await buildPromptContext(bundle, { requiredKeys: ["recentEventsLong"], relatedEvents, longEventLimit: 4, taskKey: "jumpForward" });
  const related = recentEventsLong.split(`${RELATED_EVENTS_HEADER}\n`)[1];
  assert.ok(related, "the block is there");
  const relatedIds = [...related.matchAll(/Event (\d+)/g)].map((match) => Number(match[1]));
  assert.ok(relatedIds.length > 0 && relatedIds.every((id) => id <= 12), `only folded events: ${relatedIds}`);
});
