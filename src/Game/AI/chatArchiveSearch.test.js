// Run: node --test src/Game/AI/chatArchiveSearch.test.js
//
// Older conversations kept on file, on the runtime side (relatedEventsSearch.js):
// indexed while idle, recalled for a skip within its time, reachable by the
// past_talks lookup, and rendered by the prompt (promptContext.js).
import assert from "node:assert/strict";
import test from "node:test";
import { CHAT_CHUNK_MAX_TOKENS } from "../../runtime/embeddingModels.js";
import { LOOKUP_TOOLS, PAST_TALKS_FUNCTION, PAST_TALKS_TOOL, withPastTalks } from "./lookupTools.js";
import { PAST_DIPLOMACY_HEADER, renderArchivedChats } from "./chatArchive.js";
import { buildPromptContext } from "./promptContext.js";
import { findPastTalks, indexOpenGame, pastTalksSearch, setRelatedEventsDepsForTests } from "./relatedEventsSearch.js";

// A fake model: a text's vector is which of four words it holds.
const WORDS = ["danube", "grain", "harvest", "wine"];
const vectorOf = (text) => {
  const hits = WORDS.map((word) => (String(text).toLowerCase().includes(word) ? 1 : 0));
  const raw = [...hits, hits.some(Boolean) ? 0 : 1];
  const norm = Math.hypot(...raw);
  return Float32Array.from(raw.map((value) => value / norm));
};
const fakeModel = ({ delayMs = 0 } = {}) => {
  const calls = [];
  return {
    calls,
    module: async () => ({
      embedTexts: async (texts, options = {}) => {
        calls.push({ texts, options });
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        return texts.map(vectorOf);
      },
    }),
  };
};
const fakeChatStore = () => {
  const games = new Map();
  return {
    games,
    readGame: async (gameId) => new Map(games.get(gameId) ?? []),
    write: async (gameId, rows) => {
      const game = games.get(gameId) ?? new Map();
      for (const row of rows) game.set(`${row.chatId}:${row.chunk}`, { ...row });
      games.set(gameId, game);
    },
    remove: async (gameId, keys) => { for (const key of keys) games.get(gameId)?.delete(key); },
  };
};
const noEvents = { readGame: async () => new Map(), write: async () => {}, remove: async () => {} };

const thread = (id, partner, date, lines, memory = "") => ({
  id,
  status: "open",
  countries: [{ name: partner }],
  messages: lines.map((text, at) => ({
    role: at % 2 ? "leader" : "user",
    speaker: at % 2 ? partner : "Italy",
    text,
    time: date,
    ...(memory && at === lines.length - 1 ? { memorySummary: memory } : {}),
  })),
});

// Austria's promise, two years old; Portugal's pleasantries, as old; Hungary's talk, this month.
const promise = thread("austria", "Austria", "1936-02-01", [
  "Will you let our barges pass on the Danube?",
  "Austria promises Italy free passage on the Danube until 1940.",
], "Austria promised Italy free passage on the Danube until 1940.");
const idle = thread("portugal", "Portugal", "1936-03-01", ["Our wine is the best.", "So is ours."], "Pleasantries about wine.");
const recent = thread("hungary", "Hungary", "1938-04-01", ["Send grain.", "We will."]);
const history = Array.from({ length: 12 }, (_, at) => {
  const month = 5 - at;
  const from = new Date(Date.UTC(1938, month - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(1938, month, 1)).toISOString().slice(0, 10);
  return { round: 30 - at, fromDate: from, toDate: to };
});
const bundle = (actions = []) => ({
  game: { country: "Italy", gameDate: "1938-05-01", round: 30, startDate: "1935-01-01" },
  world: { simulationHistory: history, wars: [], peaceOffers: [] },
  chats: [recent, promise, idle],
  events: [],
  actions,
  advisor: [],
});

const depsFor = (store, model, extra = {}) => ({
  model: model.module,
  store: () => noEvents,
  chatStore: () => store,
  campaign: () => "g1",
  readEvents: async () => [],
  readChatBundle: async () => bundle(),
  openChat: () => "",
  focusPowers: async () => [],
  busy: () => false,
  ...extra,
});

test("the index embeds the archived chats' chunks while idle, read to the chunk length, and only those", async () => {
  const store = fakeChatStore();
  const model = fakeModel();
  let busy = 1;
  setRelatedEventsDepsForTests(depsFor(store, model, { busy: () => busy > 0, sleep: async () => { busy -= 1; } }));
  await indexOpenGame();
  assert.deepEqual([...store.games.get("g1").keys()].sort(), ["austria:0", "portugal:0"], "Hungary's chat is in use, not kept on file");
  assert.ok(model.calls.every((call) => call.options.maxTokens === CHAT_CHUNK_MAX_TOKENS));
  assert.match(model.calls[0].texts[0], /^Talks between Italy and (Austria|Portugal): /);

  // Nothing changed: nothing embedded again.
  model.calls.length = 0;
  await indexOpenGame();
  assert.deepEqual(model.calls, []);
  setRelatedEventsDepsForTests(null);
});

test("a chat used again leaves the archive, and its vectors with it", async () => {
  const store = fakeChatStore();
  const model = fakeModel();
  let chats = [recent, promise, idle];
  setRelatedEventsDepsForTests(depsFor(store, model, { readChatBundle: async () => ({ ...bundle(), chats }) }));
  await indexOpenGame();
  assert.equal(store.games.get("g1").size, 2);
  const usedAgain = { ...promise, messages: [...promise.messages, { role: "user", speaker: "Italy", text: "About the Danube again.", time: "1938-04-20" }] };
  chats = [recent, usedAgain, idle];
  await indexOpenGame();
  assert.deepEqual([...store.games.get("g1").keys()], ["portugal:0"]);
  setRelatedEventsDepsForTests(null);
});

test("an old chat with a promise is recalled when it bears on the turn; an unrelated one is not", async () => {
  const store = fakeChatStore();
  setRelatedEventsDepsForTests(depsFor(store, fakeModel()));
  await indexOpenGame();
  const turn = bundle([{ status: "planned", title: "Send our grain barges down the Danube to Vienna" }]);
  const ranked = await findPastTalks(turn);
  assert.equal(ranked[0].id, "austria:0");
  assert.ok(!ranked.some((row) => row.id.startsWith("portugal")), "wine bears on nothing this turn");

  // The skip's diplomacy: Hungary in full, Austria's promise recalled, Portugal counted.
  const variables = await buildPromptContext(turn, { requiredKeys: ["chatHistoryLong"], taskKey: "jumpForward", pastTalks: ranked, openChatId: "" });
  const text = variables.chatHistoryLong;
  assert.match(text, /Send grain\./, "the chat in use is sent as it was");
  assert.match(text, /2 older conversations kept on file \(with Portugal; Austria\)/, "the newest first");
  assert.ok(text.includes(PAST_DIPLOMACY_HEADER));
  assert.match(text, /Austria promises Italy free passage on the Danube until 1940\./);
  assert.equal(text.includes("Our wine is the best"), false, "the unrelated chat leaves the prompt");
  setRelatedEventsDepsForTests(null);
});

test("a relevant old chat is never dropped for an irrelevant one: the budget goes to relevance first", () => {
  // Thirty irrelevant chats and one relevant, the relevant ranked first.
  const many = Array.from({ length: 30 }, (_, at) => thread(`w${at}`, `Power ${at}`, "1936-01-01", [`Wine talk ${at}. ${"Vintages and casks. ".repeat(30)}`]));
  const candidates = [{ id: "austria:0", score: 0.9 }, ...many.map((chat) => ({ id: `${chat.id}:0`, score: 0.3 }))];
  const text = renderArchivedChats([...many, promise], candidates, { player: "Italy" });
  assert.match(text, /free passage on the Danube until 1940/);
  const excerpt = text.slice(text.indexOf(PAST_DIPLOMACY_HEADER));
  assert.ok(excerpt.length <= 2500);
  assert.ok(excerpt.indexOf("Austria") < excerpt.indexOf("Power"), "the relevant thread comes first");
});

test("the search keeps to its time and never throws", async () => {
  const store = fakeChatStore();
  setRelatedEventsDepsForTests(depsFor(store, fakeModel()));
  await indexOpenGame();
  setRelatedEventsDepsForTests(depsFor(store, fakeModel({ delayMs: 400 })));
  const started = Date.now();
  assert.equal(await findPastTalks(bundle([{ status: "planned", title: "Danube" }]), { timeoutMs: 50 }), null);
  assert.ok(Date.now() - started < 300);

  setRelatedEventsDepsForTests(depsFor(store, { module: async () => { throw new Error("no wasm"); } }));
  assert.equal(await findPastTalks(bundle([{ status: "planned", title: "Danube" }])), null);

  // No chat kept on file: no model, nothing.
  const model = fakeModel();
  setRelatedEventsDepsForTests(depsFor(store, model));
  assert.equal(await findPastTalks({ ...bundle(), chats: [recent] }), null);
  assert.deepEqual(model.calls, []);

  // The open conversation is never kept on file, so never searched.
  assert.equal(await findPastTalks({ ...bundle(), chats: [recent, promise] }, { openChatId: "austria" }), null);
  setRelatedEventsDepsForTests(null);
});

test("past_talks reaches the chats kept on file once the model has loaded", async () => {
  const store = fakeChatStore();
  setRelatedEventsDepsForTests(depsFor(store, fakeModel()));
  await indexOpenGame(); // the model answered once
  const search = pastTalksSearch(bundle(), { campaignId: "g1" });
  assert.equal(typeof search, "function");
  const base = { tools: LOOKUP_TOOLS, execute: async (name) => `answered ${name}` };
  const lookups = withPastTalks(base, search);
  assert.equal(lookups.tools.at(-1), PAST_TALKS_TOOL);
  assert.equal(await lookups.execute("war_ledger", {}), "answered war_ledger");
  const answer = await lookups.execute(PAST_TALKS_FUNCTION, { query: "passage on the Danube" });
  assert.equal(answer.talks[0].with, "Austria");
  assert.match(answer.talks[0].excerpt, /free passage on the Danube/);
  assert.equal((await lookups.execute(PAST_TALKS_FUNCTION, { query: "Danube", with: "Portugal" })).talks.length, 0);
  assert.ok((await lookups.execute(PAST_TALKS_FUNCTION, {})).error);

  assert.equal(pastTalksSearch({ ...bundle(), chats: [recent] }, { campaignId: "g1" }), null, "nothing kept on file, nothing offered");
  assert.equal(pastTalksSearch(bundle(), {}), null);
  assert.equal(withPastTalks(base, null), base);
  assert.equal(PAST_TALKS_TOOL.schema.type, "object");
  assert.deepEqual(PAST_TALKS_TOOL.schema.required, ["query"]);
  assert.ok(!LOOKUP_TOOLS.some((tool) => tool.name === PAST_TALKS_FUNCTION));
  setRelatedEventsDepsForTests(null);
});

test("without a search the prompt still counts the chats kept on file and keeps their binding word", async () => {
  const variables = await buildPromptContext(bundle(), { requiredKeys: ["chatHistoryLong", "chatsToConsolidate"], taskKey: "jumpForward", openChatId: "" });
  assert.match(variables.chatHistoryLong, /2 older conversations kept on file/);
  assert.match(variables.chatHistoryLong, /STANDING WORD FROM OLDER TALKS[^\n]*\n- With Austria \([^)]+\): Austria promised Italy free passage on the Danube until 1940\./);
  assert.equal(variables.chatHistoryLong.includes("PAST DIPLOMACY"), false);
  assert.match(variables.chatsToConsolidate, /free passage on the Danube/, "a history fold still reads them all");

  // The conversation the player has open is sent whole, however old.
  const open = await buildPromptContext(bundle(), { requiredKeys: ["chatHistoryLong"], taskKey: "jumpForward", openChatId: "austria" });
  assert.match(open.chatHistoryLong, /Will you let our barges pass on the Danube\?/);
  assert.match(open.chatHistoryLong, /1 older conversation kept on file \(with Portugal\)/);
});
