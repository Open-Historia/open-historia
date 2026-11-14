// Run: node --test src/Game/AI/chatArchive.test.js
//
// Older conversations kept on file: which chats, their chunks, and what the
// prompt says of them.
import assert from "node:assert/strict";
import test from "node:test";
import {
  ARCHIVE_MIN_SKIPS,
  BINDING_HEADER,
  BINDING_LINE_CHARS,
  BINDING_MAX_CHARS,
  CHAT_CHUNK_CHARS,
  CHAT_CHUNK_OVERLAP,
  PAST_DIPLOMACY_HEADER,
  PAST_DIPLOMACY_MAX_CHARS,
  archiveExemption,
  archivedChunkRows,
  archivedCountLine,
  buildPastTalksQueries,
  chatArchiveContext,
  chatChunks,
  chatLastUsed,
  chatPartners,
  isArchivedChat,
  moreThanAYearBefore,
  parseChunkKey,
  partitionChats,
  pastTalksAnswer,
  renderArchivedChats,
  renderBindingWord,
  renderPastDiplomacy,
  skipsSince,
  standingWord,
  unfoldedChats,
} from "./chatArchive.js";

// A month-long skip a round, the newest first, as world.simulationHistory keeps them.
const monthlySkips = (toDate, count) => {
  const [year, month] = toDate.split("-").map(Number);
  return Array.from({ length: count }, (_, at) => {
    const end = new Date(Date.UTC(year, month - 1 - at, 1));
    const start = new Date(Date.UTC(year, month - 2 - at, 1));
    const iso = (date) => date.toISOString().slice(0, 10);
    return { round: 40 - at, fromDate: iso(start), toDate: iso(end) };
  });
};

const chat = (id, partner, lastDate, extra = {}) => ({
  id,
  countries: [{ name: partner }],
  status: "open",
  messages: [
    { role: "user", speaker: "Italy", text: `Greetings to ${partner}.`, time: lastDate },
    { role: "leader", speaker: partner, text: "And to you.", time: lastDate },
  ],
  ...extra,
});

const bundleAt = (gameDate, { history = monthlySkips(gameDate, 12), round = 40, world = {} } = {}) => ({
  game: { country: "Italy", gameDate, round },
  world: { simulationHistory: history, wars: [], peaceOffers: [], ...world },
});

test("the owner's rule: more than a game year AND at least four skips, both", () => {
  // Monthly skips: the last twelve, from 2029-08-01 back.
  const ctx = chatArchiveContext(bundleAt("2029-09-01"));
  assert.equal(isArchivedChat(chat("a", "Austria", "2028-01-10"), ctx), true, "twenty months and every skip since");

  // A year and a day is more than a year; a year to the day is not.
  assert.equal(moreThanAYearBefore("2028-08-31", "2029-09-01"), true);
  assert.equal(moreThanAYearBefore("2028-09-01", "2029-09-01"), false);

  // Old by the calendar, but only three skips since (one long skip of a year and more).
  const longSkips = [
    { round: 40, fromDate: "2029-08-01", toDate: "2029-09-01" },
    { round: 39, fromDate: "2029-07-01", toDate: "2029-08-01" },
    { round: 38, fromDate: "2028-01-15", toDate: "2029-07-01" },
    { round: 37, fromDate: "2027-12-01", toDate: "2028-01-15" },
  ];
  const fewSkips = chatArchiveContext(bundleAt("2029-09-01", { history: longSkips }));
  assert.equal(skipsSince("2028-01-10", fewSkips), 3);
  assert.equal(isArchivedChat(chat("b", "Austria", "2028-01-10"), fewSkips), false, "a year, but three skips");
  assert.equal(ARCHIVE_MIN_SKIPS, 4);

  // Four skips ago, but within the year.
  assert.equal(skipsSince("2029-04-15", ctx), 4);
  assert.equal(isArchivedChat(chat("c", "Austria", "2029-04-15"), ctx), false, "four skips, but months not a year");

  // No dated word: its age cannot be told, so it is sent.
  assert.equal(isArchivedChat({ id: "d", countries: [{ name: "Austria" }], messages: [{ role: "user", text: "Hello" }] }, ctx), false);
  assert.equal(chatLastUsed({ messages: [{ time: "2027-01-01" }], events: [{ kind: "poll_vote_cast", time: "2028-02-01" }] }), "2028-02-01", "a vote is a use");
});

test("skips are counted from the save's history, the skip a message was written in not among them", () => {
  const history = [
    { fromDate: "1940-03-01", toDate: "1940-04-01" },
    { fromDate: "1940-02-01", toDate: "1940-03-01" },
    { fromDate: "1940-01-01", toDate: "1940-02-01" },
  ];
  // A skip's own letters are dated the day it ended: the next skip is the first after.
  assert.equal(skipsSince("1940-02-01", { history }), 2);
  assert.equal(skipsSince("1939-12-31", { history }), 3);
  assert.equal(skipsSince("1939-12-31", { history, round: 2 }), 2, "never more skips than rounds");
  assert.equal(skipsSince("", { history }), 0);
});

test("never archived: the open conversation, a pending demand or peace offer, a war, a negotiation, an open vote", () => {
  const base = bundleAt("2029-09-01");
  const ctx = chatArchiveContext(base, { openChatId: "open" });
  const old = "2027-05-01";
  assert.equal(archiveExemption(chat("open", "Austria", old), ctx), "open");

  assert.equal(archiveExemption(chat("dem", "Austria", old, { demands: [{ id: "d1", status: "open" }] }), ctx), "demand");
  assert.equal(archiveExemption(chat("dem2", "Austria", old, { demands: [{ id: "d1", status: "countered" }] }), ctx), "demand");
  assert.equal(archiveExemption(chat("dem3", "Austria", old, { demands: [{ id: "d1", status: "accepted" }] }), ctx), "", "a settled demand keeps nothing");

  const offers = chatArchiveContext(bundleAt("2029-09-01", { world: { peaceOffers: [
    { id: "p1", warId: "w", from: "Austria", to: "Italy", status: "open", chatId: "peace" },
    { id: "p2", warId: "w", from: "Italy", to: "Hungary", status: "open" },
    { id: "p3", warId: "w", from: "Italy", to: "Spain", status: "declined", chatId: "spain" },
  ] } }));
  assert.equal(archiveExemption(chat("peace", "Austria", old), offers), "peace offer", "the offer's own thread");
  assert.equal(archiveExemption(chat("hun", "Hungary", old), offers), "peace offer", "an offer between the player and the partner");
  assert.equal(archiveExemption(chat("spain", "Spain", old), offers), "", "an answered offer keeps nothing");

  const wars = chatArchiveContext(bundleAt("2029-09-01", { world: { wars: [
    { id: "w1", status: "active", sideA: ["Italy", "Croatia"], sideB: ["Serbia"] },
    { id: "w2", status: "ended", sideA: ["Italy"], sideB: ["Greece"] },
    { id: "w3", status: "active", sideA: ["Chile"], sideB: ["Peru"] },
  ] } }));
  assert.equal(archiveExemption(chat("enemy", "Serbia", old), wars), "war", "the enemy");
  assert.equal(archiveExemption(chat("ally", "Croatia", old), wars), "war", "an ally in the same war");
  assert.equal(archiveExemption(chat("greece", "Greece", old), wars), "", "a war that ended");
  assert.equal(archiveExemption(chat("peru", "Peru", old), wars), "", "a war the player is not in");

  assert.equal(archiveExemption(chat("case", "Austria", old, { lifecycleInstitutionId: "eu", lifecycleCaseIds: ["c1"] }), ctx), "negotiation");
  assert.equal(archiveExemption(chat("case2", "Austria", old, { status: "closed", lifecycleInstitutionId: "eu", lifecycleCaseIds: ["c1"] }), ctx), "", "a closed case");

  const group = (votes) => ({
    ...chat("vote", "Austria", old),
    countries: [{ name: "Austria" }, { name: "Hungary" }],
    polls: [{ id: "q", options: [{ id: "yes" }, { id: "no" }], votes }],
  });
  assert.equal(archiveExemption(group({ Austria: "yes" }), ctx), "vote", "Hungary and the player have not voted");
  assert.equal(archiveExemption(group({ Austria: "yes", Hungary: "no", Italy: "yes" }), ctx), "", "everyone voted");

  // Each exemption keeps an old chat in the prompt.
  const kept = partitionChats([chat("open", "Austria", old), chat("free", "Bulgaria", old)], ctx);
  assert.deepEqual(kept.active.map((entry) => entry.id), ["open"]);
  assert.deepEqual(kept.archived.map((entry) => entry.id), ["free"]);
});

test("a chat folded into the history is neither sent nor kept on file", () => {
  const chats = [chat("a", "Austria", "2027-01-01"), chat("b", "Bulgaria", "2027-01-01")];
  assert.deepEqual(unfoldedChats(chats, { consolidatedHistory: [{ chatIds: ["a"] }] }).map((entry) => entry.id), ["b"]);
});

const longThread = (id, partner, count, { memory = "", date = "1936-03-01" } = {}) => ({
  id,
  countries: [{ name: partner }],
  messages: Array.from({ length: count }, (_, at) => ({
    role: at % 2 ? "leader" : "user",
    speaker: at % 2 ? partner : "Italy",
    text: `Message ${at} about the grain and the railway. It goes on for a while, as envoys do, saying the same thing twice.`,
    time: date,
    ...(memory && at === count - 1 ? { memorySummary: memory } : {}),
  })),
});

test("chunks: about 800 characters, about 150 carried over, cut between messages", () => {
  const thread = longThread("t", "Austria", 30, { memory: "Austria promised Italy free passage on the Danube until 1940. Austria warned it would close the river if Italy armed Hungary." });
  const chunks = chatChunks(thread);
  assert.ok(chunks.length > 3);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= CHAT_CHUNK_CHARS, `chunk ${chunk.chunk} is ${chunk.text.length}`);
    assert.ok(chunk.overlap <= CHAT_CHUNK_OVERLAP + 1);
    // Every line is whole: a message, or the memory.
    for (const line of chunk.text.split("\n")) assert.match(line, /^(\[1936-03-01\] (Italy|Austria): Message \d+ .*twice\.|Memory of these talks .*)$/);
  }
  assert.match(chunks[0].text, /^Memory of these talks \(through 1936-03-01\): Austria promised Italy free passage/);
  // What a chunk carries over ends the chunk before it.
  for (const chunk of chunks.slice(1)) {
    const carried = chunk.text.slice(0, chunk.overlap).trimEnd();
    if (carried) assert.ok(chunks[chunk.chunk - 1].text.endsWith(carried));
  }
  assert.equal(chunks[0].from, "1936-03-01");
});

test("a message longer than a chunk is cut at its sentences", () => {
  const sentence = "The ambassador spoke at length of the old friendship between our peoples and the debts still owed.";
  const thread = { id: "x", countries: [{ name: "Austria" }], messages: [{ role: "leader", speaker: "Austria", text: Array.from({ length: 20 }, () => sentence).join(" "), time: "1936-01-01" }] };
  const chunks = chatChunks(thread);
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= CHAT_CHUNK_CHARS);
    assert.match(chunk.text, /owed\.$/, "ends at a sentence");
  }
});

// A Chinese talk is cut at its sentences as its English twin is: its full stop has no space after it, and it was cut
// only at the chunk's length, mid-sentence. Nothing is put between its sentences that the language does not have.
test("a long message in any script is cut at its sentences, its text kept as written", () => {
  const twins = [
    ["The ambassador spoke at length of the old friendship between our peoples and the debts still owed.", " ", /owed\.$/],
    ["大使详细谈到了我们两国人民之间的传统友谊，以及至今仍未偿还的债务，并且再三强调了双方在多瑙河航运问题上的长期共同利益和彼此之间应当承担的种种责任与义务。", "", /义务。$/],
  ];
  for (const [sentence, between, end] of twins) {
    const text = Array.from({ length: 40 }, () => sentence).join(between);
    const chunks = chatChunks({ id: "x", countries: [{ name: "Austria" }], messages: [{ role: "leader", speaker: "Austria", text, time: "1936-01-01" }] });
    assert.ok(chunks.length >= 2, sentence.slice(0, 10));
    for (const chunk of chunks) {
      assert.ok(chunk.text.length <= CHAT_CHUNK_CHARS);
      assert.match(chunk.text, end, "ends at a sentence");
    }
    if (!between) assert.ok(!chunks.some((chunk) => /。 /.test(chunk.text)), "no space put after a Chinese full stop");
  }
});

test("each chunk is keyed chatId:chunk with the hash of what is embedded, who it was with leading", () => {
  const rows = archivedChunkRows([longThread("chat:7", "Austria", 12)], { player: "Italy" });
  assert.equal(rows[0].key, "chat:7:0");
  assert.deepEqual(parseChunkKey(rows[0].key), { chatId: "chat:7", chunk: 0 });
  assert.match(rows[0].text, /^Talks between Italy and Austria: /);
  assert.match(rows[0].hash, /^[0-9a-f]{8}$/);
  const again = archivedChunkRows([longThread("chat:7", "Austria", 12)], { player: "Italy" });
  assert.deepEqual(again.map((row) => row.hash), rows.map((row) => row.hash), "the same text, the same hash");
  const changed = longThread("chat:7", "Austria", 12);
  changed.messages[0].text = "Something else entirely.";
  assert.notEqual(archivedChunkRows([changed], { player: "Italy" })[0].hash, rows[0].hash);
});

test("a large table is named by its title and size", () => {
  const un = { id: "un", institutionId: "un", title: "United Nations", countries: Array.from({ length: 190 }, (_, at) => ({ name: `Member ${at}` })) };
  assert.equal(chatPartners(un, "Italy"), "United Nations (190 members)");
  assert.equal(chatPartners({ countries: [{ name: "Italy" }, { name: "Austria" }] }, "Italy"), "Austria");
});

test("PAST DIPLOMACY: within its budget, no chunk twice, neighbours as one passage", () => {
  const thread = longThread("t", "Austria", 40);
  const chunks = chatChunks(thread);
  const candidates = [
    { id: "t:2", score: 0.9 },
    { id: "t:2", score: 0.9 },
    { id: "t:3", score: 0.8 },
    { id: "gone:0", score: 0.7 },
    ...chunks.map((chunk) => ({ id: `t:${chunk.chunk}`, score: 0.5 })),
  ];
  const text = renderPastDiplomacy(candidates, [thread], { player: "Italy" });
  assert.ok(text.startsWith(PAST_DIPLOMACY_HEADER));
  assert.ok(text.length <= PAST_DIPLOMACY_MAX_CHARS, `${text.length}`);
  // Every message appears at most once, the carried-over lines included.
  for (let at = 0; at < 40; at += 1) {
    const count = text.split(`: Message ${at} about`).length - 1;
    assert.ok(count <= 1, `message ${at} shown ${count} times`);
  }
  // Chunks 2 and 3 are one passage under one heading.
  assert.equal(text.split("- With Austria").length - 1 <= 2, true);
  assert.equal(renderPastDiplomacy([], [thread]), "");
  assert.equal(renderPastDiplomacy([{ id: "t:0", score: 1 }], []), "", "only chats kept on file");
});

test("a promise in an older chat stays visible when no excerpt is recalled, and is said once when it is", () => {
  const promise = longThread("p", "Austria", 6, { memory: "Austria promised Italy free passage on the Danube until 1940. The weather was discussed." });
  const idle = longThread("q", "Portugal", 4, { memory: "Pleasantries about wine." });
  // The memory as it last stood, whatever its words: it is the thread's record of what binds.
  assert.equal(standingWord(promise), "Austria promised Italy free passage on the Danube until 1940. The weather was discussed.");
  assert.equal(standingWord(idle), "Pleasantries about wine.");
  assert.equal(standingWord(longThread("r", "Spain", 2)), "", "a thread with no memory has none to give");

  const without = renderArchivedChats([promise, idle], null, { player: "Italy" });
  assert.match(without, /^2 older conversations kept on file \(with Austria; Portugal\)\./);
  assert.ok(without.includes(BINDING_HEADER));
  assert.match(without, /- With Austria \([^)]+\): Austria promised Italy free passage on the Danube until 1940\./);
  assert.match(without, /- With Portugal \([^)]+\): Pleasantries about wine\./);
  assert.equal(without.includes("PAST DIPLOMACY"), false);

  // Recalled with its memory: the promise is in the excerpt, not twice.
  const recalled = renderArchivedChats([promise, idle], [{ id: "p:0", score: 0.8 }], { player: "Italy" });
  assert.ok(recalled.includes(PAST_DIPLOMACY_HEADER));
  assert.equal(recalled.split("free passage on the Danube").length - 1, 1);

  assert.match(archivedCountLine([promise], { player: "Italy", lookups: true }), /ask past_talks, similar_events or chat_history/);
  assert.equal(renderArchivedChats([], [{ id: "p:0", score: 1 }]), "");
});

// The memory is written in the game's language. Its "binding" sentences were
// picked by English words, so a French or a Chinese promise was never said
// while its talks were kept on file: the player's ally forgot what it swore.
test("the standing word is the same in every language: the memory as it last stood", () => {
  const twins = [
    ["Austria promised Italy free passage on the Danube until 1940. The weather was discussed.", "Austria"],
    ["L'Autriche a promis à l'Italie le libre passage sur le Danube jusqu'en 1940. On a parlé du temps.", "Autriche"],
    ["Австрия обещала Италии свободный проход по Дунаю до 1940 года. Говорили о погоде.", "Австрия"],
    ["奥地利承诺在1940年前允许意大利自由通过多瑙河。双方还谈到了天气。", "奥地利"],
  ];
  for (const [memory, partner] of twins) {
    const chat = longThread(`t-${partner}`, partner, 4, { memory });
    assert.equal(standingWord(chat), memory, partner);
    assert.ok(renderArchivedChats([chat], null, { player: "Italy" }).includes(`- With ${partner} (`), partner);
  }

  // Held to a line's room at its sentences, and to the block's room in all.
  const long = longThread("l", "Austria", 4, { memory: Array.from({ length: 12 }, (_, at) => `Clause ${at + 1} binds Austria to a further duty on the Danube.`).join(" ") });
  const said = standingWord(long);
  assert.ok(said.length <= BINDING_LINE_CHARS && said.startsWith("Clause 1 binds") && said.endsWith("."), said);
  const many = Array.from({ length: 12 }, (_, at) => longThread(`m${at}`, `Power ${at}`, 2, { memory: "x".repeat(200) }));
  assert.ok(renderBindingWord(many, { player: "Italy" }).length <= BINDING_MAX_CHARS);
});

test("the query: orders, wars, what the open chats say, who is addressed, the powers in view", () => {
  const queries = buildPastTalksQueries({
    game: { country: "Italy" },
    actions: [{ status: "planned", title: "Close the Danube to Austrian barges" }, { status: "resolved", title: "Old order" }],
    world: { wars: [{ status: "active", title: "The Adriatic War", sideA: ["Italy"], sideB: ["Yugoslavia"] }] },
  }, {
    focusPowers: ["Italy", "France"],
    activeChats: [{ countries: [{ name: "Hungary" }], messages: [{ text: "We need grain." }] }],
    addressed: ["Austria"],
    about: ["What did Austria promise us?"],
  });
  assert.equal(queries[0], "What did Austria promise us?");
  assert.ok(queries.includes("Talks between Italy and Austria"));
  assert.ok(queries.includes("Close the Danube to Austrian barges"));
  assert.ok(queries.some((query) => query.includes("Italy against Yugoslavia")));
  assert.ok(queries.includes("Talks between Italy and Hungary: We need grain."));
  assert.ok(queries.includes("Talks between Italy and France"));
  assert.equal(queries.some((query) => query.includes("Old order")), false);
  assert.equal(queries.includes("Talks between Italy and Italy"), false);
});

test("the past_talks answer: the passages, with whom and when, one power's if asked", () => {
  const a = longThread("a", "Austria", 4);
  const b = longThread("b", "Bulgaria", 4);
  const ranked = [{ id: "b:0", score: 0.71 }, { id: "a:0", score: 0.6 }];
  const all = pastTalksAnswer(ranked, [a, b], { player: "Italy" });
  assert.deepEqual(all.talks.map((talk) => talk.with), ["Bulgaria", "Austria"]);
  assert.equal(all.talks[0].similarity, 0.71);
  assert.equal(all.talks[0].dates, "1 March 1936");
  assert.deepEqual(pastTalksAnswer(ranked, [a, b], { player: "Italy", withPower: "Austria" }).talks.map((talk) => talk.chatId), ["a"]);
  assert.match(pastTalksAnswer([], [a]).note, /No older conversation/);
});
