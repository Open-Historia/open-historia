/*! Open Historia — older conversations, kept on file and recalled when they matter © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// A long campaign's diplomacy grows without end: every thread the player ever
// opened was sent with every time skip, every leader's reply and every word
// of the advisor, a thread with Austria untouched for three years beside the
// negotiation the turn is about. The owner's rule (2026-11-07): a chat that
// has not been used in more than one game year AND was last used at least four
// time skips ago is stored as a vector and retrieved only when relevant. Both
// must hold. Every other chat is sent as it was.
//
// An archived chat is cut into chunks of about 800 characters with about 150
// of overlap, at message or sentence boundaries; each chunk is turned into a
// vector on the device (the related-events model, runtime/embeddingModels.js)
// and kept in IndexedDB (runtime/eventVectorStore.js, the chat store). A skip,
// a leader's reply or the advisor is given the chunks nearest to what it is
// about, in about 2,500 characters, as PAST DIPLOMACY; the rest of the
// archived chats leave the prompt, but for one line counting them and the
// memory each last held, the word they gave that still binds (a promise, a
// treaty, a threat), so nothing agreed is lost while it is not recalled.
//
// Never archived, whatever its age:
// - the conversation the player has open (runtime/openConversation.js);
// - a chat with a demand still to be answered (chatThreads.js demands: open
//   or countered) or a peace offer still open (world.peaceOffers);
// - a chat with a power on either side of a live war the player is in (an
//   enemy is who peace is made with, an ally who the war is planned with);
// - an institution's open lifecycle negotiation (its case is still being
//   heard: chatFold.js isLifecycleNegotiationChat);
// - a group chat with a vote some member has not cast.
//
// Pure: the prompt (promptContext.js), the index and the search
// (relatedEventsSearch.js) and the tests call it.

import { addGameMonths, compareGameDates, formatGameDateReadable, isGameDate } from "../../runtime/gameDates.js";
import { contentHash } from "../../runtime/embeddingModels.js";
import { sentenceSlices } from "../../../server/sentences.js";

export const ARCHIVE_MIN_SKIPS = 4;
export const ARCHIVE_MIN_MONTHS = 12;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const list = (value) => (Array.isArray(value) ? value : []);
const fold = (value) => clean(value).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const cut = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);

// ---------------------------------------------------------------------------
// When a chat was last used, and how many skips ago that was.

const latestDate = (dates) => dates.filter((date) => isGameDate(date)).reduce(
  (latest, date) => (!latest || compareGameDates(date, latest) > 0 ? date : latest),
  "",
);

// The game date of a thread's latest word: a message, a vote, a demand or its
// answer (the thread's log). "" for a thread with nothing dated.
export const chatLastUsed = (chat) => latestDate([
  ...list(chat?.messages).map((message) => clean(message?.time)),
  ...list(chat?.events).map((event) => clean(event?.time)),
]);

// The time skips since `date`: those that began on or after it
// (world.simulationHistory, newest first, the last twelve kept). A message a
// skip wrote is dated the day it ended, the day the next skip begins, so that
// skip counts as the first after it. `round`, where known, caps the count.
export const skipsSince = (date, { history = [], round = null } = {}) => {
  if (!isGameDate(date)) return 0;
  const count = list(history).filter((entry) => {
    const from = clean(entry?.fromDate) || clean(entry?.date) || clean(entry?.toDate);
    return isGameDate(from) && compareGameDates(from, date) >= 0;
  }).length;
  const rounds = round === null || round === undefined || round === "" ? NaN : Number(round);
  return Number.isFinite(rounds) && rounds >= 0 ? Math.min(count, rounds) : count;
};

// More than one game year: the date a year after `date` is before `gameDate`.
export const moreThanAYearBefore = (date, gameDate, { months = ARCHIVE_MIN_MONTHS } = {}) => {
  if (!isGameDate(date) || !isGameDate(gameDate)) return false;
  const yearOn = addGameMonths(date, months);
  return Boolean(yearOn) && compareGameDates(yearOn, gameDate) < 0;
};

// ---------------------------------------------------------------------------
// What keeps a chat in the prompt, however old.

const LIVE_WAR = new Set(["active", "ceasefire"]);
const PENDING_DEMAND = new Set(["open", "countered"]);

const membersOf = (chat) => list(chat?.countries).map((country) => clean(country?.name || country?.code || country)).filter(Boolean);

// The polities on either side of a live war the player is in.
const playerWarParties = (wars, player) => {
  const parties = new Set();
  const me = fold(player);
  if (!me) return parties;
  for (const war of list(wars)) {
    if (!LIVE_WAR.has(fold(war?.status || "active"))) continue;
    const sides = [list(war?.sideA), list(war?.sideB)].map((side) => side.map(fold).filter(Boolean));
    if (!sides.some((side) => side.includes(me))) continue;
    for (const side of sides) for (const name of side) if (name !== me) parties.add(name);
  }
  return parties;
};

const hasOpenVote = (chat, player) => {
  const members = [...membersOf(chat), clean(player)].map(fold).filter(Boolean);
  return list(chat?.polls).some((poll) => {
    if (!list(poll?.options).length) return false;
    const voted = new Set(Object.keys(poll?.votes ?? {}).map(fold));
    return members.some((member) => !voted.has(member));
  });
};

// Why a chat is never archived, or "" when nothing keeps it.
//   ctx  chatArchiveContext's
export const archiveExemption = (chat, ctx = {}) => {
  const id = clean(chat?.id);
  if (id && id === clean(ctx.openChatId)) return "open";
  if (list(chat?.demands).some((demand) => PENDING_DEMAND.has(clean(demand?.status)))) return "demand";
  const members = new Set(membersOf(chat).map(fold));
  const me = fold(ctx.player);
  if (list(ctx.peaceOffers).some((offer) => clean(offer?.status || "open") === "open" && (
    (id && clean(offer?.chatId) === id)
    || (!clean(offer?.chatId) && [fold(offer?.from), fold(offer?.to)].some((name) => name === me)
      && [fold(offer?.from), fold(offer?.to)].some((name) => name !== me && members.has(name)))
  ))) return "peace offer";
  const parties = ctx.warParties ?? playerWarParties(ctx.wars, ctx.player);
  if ([...members].some((name) => parties.has(name))) return "war";
  if (chat?.status !== "closed" && chat?.lifecycleInstitutionId && list(chat?.lifecycleCaseIds).length) return "negotiation";
  if (hasOpenVote(chat, ctx.player)) return "vote";
  return "";
};

// What eligibility reads of the save, gathered once.
//   bundle      { game, world }
//   openChatId  the thread on screen (runtime/openConversation.js)
export const chatArchiveContext = (bundle, { openChatId = "" } = {}) => {
  const world = bundle?.world ?? {};
  const player = clean(bundle?.game?.country);
  return {
    gameDate: clean(bundle?.game?.gameDate),
    round: bundle?.game?.round != null && Number.isFinite(Number(bundle.game.round)) ? Number(bundle.game.round) : null,
    history: list(world.simulationHistory),
    openChatId: clean(openChatId),
    player,
    wars: list(world.wars),
    peaceOffers: list(world.peaceOffers),
    warParties: playerWarParties(world.wars, player),
  };
};

// The owner's rule: not used in more than one game year AND last used at least
// four time skips ago, and nothing keeping it (archiveExemption). A thread
// with no dated word is never archived: its age cannot be told.
//   ctx  { gameDate, round, history, openChatId, player, wars, peaceOffers } (chatArchiveContext)
export const isArchivedChat = (chat, ctx = {}) => {
  if (!chat || typeof chat !== "object") return false;
  const last = chatLastUsed(chat);
  if (!last) return false;
  if (!moreThanAYearBefore(last, ctx.gameDate)) return false;
  if (skipsSince(last, { history: ctx.history, round: ctx.round }) < ARCHIVE_MIN_SKIPS) return false;
  return !archiveExemption(chat, ctx);
};

// The chats not yet folded into the history (a closed chat a fold has told is
// in world.consolidatedHistory's chatIds, and no prompt sends it again).
export const unfoldedChats = (chats, world) => {
  const folded = new Set(list(world?.consolidatedHistory).flatMap((entry) => list(entry?.chatIds)).map(clean));
  return list(chats).filter((chat) => !folded.has(clean(chat?.id)));
};

// The chats as the prompt sends them (`active`) and those kept on file
// (`archived`), each in the order given.
export const partitionChats = (chats, ctx = {}) => {
  const active = [];
  const archived = [];
  for (const chat of list(chats)) (isArchivedChat(chat, ctx) ? archived : active).push(chat);
  return { active, archived };
};

// ---------------------------------------------------------------------------
// Chunks.

export const CHAT_CHUNK_CHARS = 800;
export const CHAT_CHUNK_OVERLAP = 150;

// Who the player talked to in a thread, by name: an institution's channel or
// a large table by its title and size (the United Nations' channel names two
// hundred members).
export const PARTNERS_NAMED = 4;
export const chatPartners = (chat, player = "") => {
  const me = fold(player);
  const names = membersOf(chat).filter((name) => fold(name) !== me);
  const title = clean(chat?.title);
  if (title && (chat?.institutionId || names.length > PARTNERS_NAMED)) return `${title} (${names.length} members)`;
  if (names.length > PARTNERS_NAMED) return `${names.slice(0, PARTNERS_NAMED).join(", ")} and ${names.length - PARTNERS_NAMED} more`;
  return names.join(", ") || title || "an unnamed table";
};

const latestMemory = (chat) => {
  const messages = list(chat?.messages);
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const summary = clean(messages[at]?.memorySummary);
    if (summary) return { summary, time: clean(messages[at]?.time) };
  }
  return null;
};

// A text longer than `max`, in pieces at its sentences, and a sentence longer
// than that at its words. A sentence ends as it does in any script
// (server/sentences.js): a Chinese or Japanese talk, whose full stop has no
// space after it, was cut only at `max`. The pieces keep the text as written
// between its sentences, so no space is put where the language has none.
const splitLong = (text, max) => {
  if (text.length <= max) return [text];
  const pieces = [];
  let current = "";
  const flush = () => {
    const piece = current.trim();
    if (piece) pieces.push(piece);
    current = "";
  };
  for (const slice of sentenceSlices(text)) {
    const sentence = slice.trim();
    if (!sentence) continue;
    if (sentence.length <= max) {
      if (current.trim() && `${current}${slice}`.trim().length > max) flush();
      current += slice;
      continue;
    }
    flush();
    let rest = sentence;
    while (rest.length > max) {
      const at = rest.lastIndexOf(" ", max);
      const end = at > max / 2 ? at : max;
      pieces.push(rest.slice(0, end).trim());
      rest = rest.slice(end).trim();
    }
    current = `${rest}${slice.slice(slice.trimEnd().length)}`;
  }
  flush();
  return pieces;
};

// The thread as lines: its standing memory first, then each message, dated.
// A message longer than a chunk is split at its sentences.
const chatUnits = (chat, max) => {
  const units = [];
  const memory = latestMemory(chat);
  if (memory) {
    for (const piece of splitLong(`Memory of these talks${memory.time ? ` (through ${memory.time})` : ""}: ${memory.summary}`, max)) {
      units.push({ text: piece, date: memory.time });
    }
  }
  for (const message of list(chat?.messages)) {
    const text = clean(message?.text);
    if (!text) continue;
    const date = clean(message?.time);
    const speaker = clean(message?.speaker || message?.role) || "Someone";
    const line = `${date ? `[${date}] ` : ""}${speaker}: ${text}`;
    for (const piece of splitLong(line, max)) units.push({ text: piece, date });
  }
  return units;
};

// The end of a chunk carried into the next: whole lines up to `overlap`, or
// the end of the last line, from a word.
const carriedOver = (units, overlap) => {
  const carried = [];
  let length = 0;
  for (let at = units.length - 1; at >= 0; at -= 1) {
    const add = units[at].text.length + (carried.length ? 1 : 0);
    if (length + add > overlap) break;
    carried.unshift(units[at]);
    length += add;
  }
  if (carried.length) return carried;
  const last = units.at(-1);
  if (!last) return [];
  const tail = last.text.slice(-overlap);
  const from = tail.indexOf(" ");
  const text = `…${(from >= 0 ? tail.slice(from + 1) : tail).trim()}`;
  return text.length > 1 ? [{ text, date: last.date }] : [];
};

// The thread in chunks: [{ chunk, text, from, to, overlap }], `overlap` being
// the characters at the start of the text that end the chunk before it.
export const chatChunks = (chat, { max = CHAT_CHUNK_CHARS, overlap = CHAT_CHUNK_OVERLAP } = {}) => {
  const units = chatUnits(chat, max);
  const chunks = [];
  let current = [];
  let carried = 0;
  const length = (rows) => rows.reduce((sum, row, at) => sum + row.text.length + (at ? 1 : 0), 0);
  const emit = () => {
    const dates = current.map((unit) => unit.date).filter((date) => isGameDate(date));
    chunks.push({
      chunk: chunks.length,
      text: current.map((unit) => unit.text).join("\n"),
      from: dates.reduce((oldest, date) => (!oldest || compareGameDates(date, oldest) < 0 ? date : oldest), ""),
      to: latestDate(dates),
      overlap: carried,
    });
  };
  let fresh = 0;
  for (const unit of units) {
    if (fresh && length([...current, unit]) > max) {
      emit();
      current = carriedOver(current, overlap);
      // A line that fills a chunk on its own starts it, without the carry.
      if (length([...current, unit]) > max) current = [];
      carried = current.length ? length(current) + 1 : 0;
      fresh = 0;
    }
    current.push(unit);
    fresh += 1;
  }
  if (fresh) emit();
  return chunks;
};

// What the model reads of a chunk: who it was with, then the text.
export const chunkEmbeddingText = (chat, chunk, player = "") => `Talks between ${clean(player) || "the player"} and ${chatPartners(chat, player)}: ${chunk.text}`;

export const chatChunkKey = (chatId, chunk) => `${clean(chatId)}:${Number(chunk) || 0}`;

// Every chunk of the archived chats to keep a vector of:
// [{ key, chatId, chunk, text, hash }].
export const archivedChunkRows = (archived, { player = "" } = {}) => {
  const rows = [];
  for (const chat of list(archived)) {
    const chatId = clean(chat?.id);
    if (!chatId) continue;
    for (const chunk of chatChunks(chat)) {
      const text = chunkEmbeddingText(chat, chunk, player);
      rows.push({ key: chatChunkKey(chatId, chunk.chunk), chatId, chunk: chunk.chunk, text, hash: contentHash(text) });
    }
  }
  return rows;
};

// ---------------------------------------------------------------------------
// The query: what this skip, reply or answer is about.

const PENDING = (action) => (clean(action?.status) || "planned") === "planned";
export const PAST_TALKS_QUERY_LIMIT = 12;

// One text per thing, each embedded on its own (as relatedEvents.js
// buildRelatedQueries): the player's orders, the live wars, what the open
// conversations last said, the leaders being addressed and the powers in view.
//   bundle        { game, world, actions }
//   focusPowers   the powers the prompt shows in full, most relevant first
//                 (promptContext.js rankFocusPowers, with idle diplomacy's
//                 relevant countries: promptFocus.js)
//   activeChats   the chats the prompt sends (partitionChats `active`), newest first
//   addressed     the leaders being addressed (a reply: its speaker)
//   about         words of the request itself (the thread's last lines, the
//                 advisor's question)
export const buildPastTalksQueries = (bundle, { focusPowers = [], activeChats = [], addressed = [], about = [] } = {}) => {
  const world = bundle?.world ?? {};
  const player = clean(bundle?.game?.country);
  const queries = [];
  const add = (text, max = 400) => {
    const value = cut(clean(text), max);
    if (value && !queries.includes(value)) queries.push(value);
  };
  for (const text of list(about).slice(0, 3)) add(text);
  for (const name of list(addressed).map(clean).filter(Boolean).slice(0, 3)) add(`Talks between ${player || "the player"} and ${name}`);
  for (const action of list(bundle?.actions).filter(PENDING).slice(-5)) {
    add([action.title, action.description || action.rawInput || action.text].map(clean).filter(Boolean).join(". "));
  }
  for (const war of list(world.wars).filter((entry) => LIVE_WAR.has(fold(entry?.status || "active"))).slice(0, 3)) {
    const sides = [list(war.sideA).map(clean).filter(Boolean).join(", "), list(war.sideB).map(clean).filter(Boolean).join(", ")].filter(Boolean);
    add([clean(war.title || war.name), sides.length === 2 ? `${sides[0]} against ${sides[1]}` : sides.join("")].filter(Boolean).join(". "));
  }
  for (const chat of list(activeChats).slice(0, 3)) {
    const said = list(chat?.messages).slice(-2).map((message) => clean(message?.text)).filter(Boolean).join(" ");
    if (said) add(`Talks between ${player || "the player"} and ${chatPartners(chat, player)}: ${said}`);
  }
  const me = fold(player);
  for (const name of list(focusPowers).map(clean).filter((value) => value && fold(value) !== me).slice(0, 6)) {
    add(`Talks between ${player || "the player"} and ${name}`);
  }
  return queries.slice(0, PAST_TALKS_QUERY_LIMIT);
};

// ---------------------------------------------------------------------------
// The prompt's part.

export const PAST_DIPLOMACY_MAX_CHARS = 2500;
export const PAST_DIPLOMACY_HEADER = "PAST DIPLOMACY (older talks that bear on now):";
export const PAST_TALKS_CANDIDATES = 30;

const readable = (date) => (isGameDate(date) ? formatGameDateReadable(date) : "");
const span = (from, to) => {
  const a = readable(from);
  const b = readable(to);
  return a && b && a !== b ? `${a} to ${b}` : a || b || "undated";
};

// The excerpts for the prompt: the best candidates within `maxChars`, never one
// twice, and of two neighbouring chunks of a thread the second without the
// lines it shares with the first. Grouped by thread (the most relevant thread
// first), each thread's in order. "" when none fits.
//   candidates  [{ id: "chatId:chunk", score }], best first (relatedScores)
//   archived    the chats kept on file (partitionChats `archived`): only
//               their chunks are shown (a leader's are the chats it was in)
// The chunk a candidate names: "chatId:chunk" (a chat id may hold colons).
export const parseChunkKey = (id) => {
  const value = clean(id);
  const match = /^(.*):(\d+)$/.exec(value);
  return match ? { chatId: match[1], chunk: Number(match[2]) } : null;
};

const selectPastDiplomacy = (candidates, archived, { player = "", maxChars = PAST_DIPLOMACY_MAX_CHARS } = {}) => {
  const byId = new Map(list(archived).map((chat) => [clean(chat?.id), chat]));
  const chunksOf = new Map();
  const chunkAt = (chatId, index) => {
    if (!chunksOf.has(chatId)) chunksOf.set(chatId, chatChunks(byId.get(chatId)));
    return chunksOf.get(chatId)[index] ?? null;
  };
  const picked = new Map(); // chatId -> Set(chunk)
  const order = [];
  let used = PAST_DIPLOMACY_HEADER.length;
  const lineOf = (chatId, chunk, trimmed) => {
    const text = trimmed ? chunk.text.slice(chunk.overlap) : chunk.text;
    return `- With ${chatPartners(byId.get(chatId), player)}, ${span(chunk.from, chunk.to)}:\n  ${text.replace(/\n/g, "\n  ")}`;
  };
  for (const candidate of list(candidates)) {
    const key = parseChunkKey(candidate?.id);
    if (!key || !byId.has(key.chatId)) continue;
    const { chatId, chunk: index } = key;
    const chunk = chunkAt(chatId, index);
    if (!chunk) continue;
    const taken = picked.get(chatId) ?? new Set();
    if (taken.has(index)) continue;
    // Measured as it stands now: a neighbour taken later only shortens it.
    const line = lineOf(chatId, chunk, taken.has(index - 1));
    if (used + 1 + line.length > maxChars) continue;
    taken.add(index);
    picked.set(chatId, taken);
    if (!order.includes(chatId)) order.push(chatId);
    used += 1 + line.length;
  }
  // The threads whose memory is quoted (it opens their first chunk).
  const memoryQuoted = new Set(order.filter((chatId) => picked.get(chatId).has(0) && latestMemory(byId.get(chatId))));
  if (!order.length) return { text: "", memoryQuoted };
  // Neighbouring chunks of a thread read as one passage, under one heading.
  const lines = [PAST_DIPLOMACY_HEADER];
  for (const chatId of order) {
    const indexes = [...picked.get(chatId)].sort((a, b) => a - b);
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const chunks = run.map((index) => chunkAt(chatId, index));
      const text = chunks.map((chunk, at) => (at ? chunk.text.slice(chunk.overlap) : chunk.text)).join("\n");
      const dates = chunks.flatMap((chunk) => [chunk.from, chunk.to]).filter((date) => isGameDate(date)).sort(compareGameDates);
      lines.push(`- With ${chatPartners(byId.get(chatId), player)}, ${span(dates[0], dates.at(-1))}:\n  ${text.replace(/\n/g, "\n  ")}`);
      run = [];
    };
    for (const index of indexes) {
      if (run.length && run.at(-1) !== index - 1) flush();
      run.push(index);
    }
    flush();
  }
  return { text: lines.join("\n"), memoryQuoted };
};

export const renderPastDiplomacy = (candidates, archived, options = {}) => selectPastDiplomacy(candidates, archived, options).text;

// What an older conversation agreed, promised, threatened or holds against
// someone: its standing memory, as it last stood, from its first sentence up
// to a line's room. The memory is that record already: the leader rewrites it
// with every reply as the thread's whole durable memory, its commitments,
// offers, deadlines and grievances first among them (diplomaticEnvelope.js
// buildDiplomaticTurnInstruction), in the language the game is played in. Its
// sentences were picked by English words (agreed, promised, treaty, warned…):
// in any other language none was, and the promise was lost while the talks
// were not recalled.
export const BINDING_LINE_CHARS = 320;
export const BINDING_MAX_CHARS = 1500;
export const BINDING_HEADER = "STANDING WORD FROM OLDER TALKS (the memory each conversation kept on file last held; what it agreed, promised, threatened or holds against someone still binds):";

export const standingWord = (chat, { maxChars = BINDING_LINE_CHARS } = {}) => {
  const memory = latestMemory(chat);
  if (!memory) return "";
  // Whole sentences from the first, as written (server/sentences.js), while
  // they fit; the first is cut to fit when it is longer than that alone.
  let said = "";
  for (const slice of sentenceSlices(memory.summary)) {
    if (said.trim() && `${said}${slice}`.trim().length > maxChars) break;
    said += slice;
  }
  return cut(said.trim(), maxChars);
};

export const renderBindingWord = (archived, { player = "", skip = new Set(), maxChars = BINDING_MAX_CHARS } = {}) => {
  const lines = [BINDING_HEADER];
  let used = BINDING_HEADER.length;
  for (const chat of list(archived)) {
    if (skip.has(clean(chat?.id))) continue;
    const said = standingWord(chat);
    if (!said) continue;
    const memory = latestMemory(chat);
    const line = `- With ${chatPartners(chat, player)} (${readable(memory?.time) || "undated"}): ${said}`;
    if (used + 1 + line.length > maxChars) continue;
    lines.push(line);
    used += 1 + line.length;
  }
  return lines.length > 1 ? lines.join("\n") : "";
};

export const ARCHIVE_NAMES_LISTED = 8;

// The one line that says the archived chats exist.
//   lookups  the task can call functions: name the ones that reach them
export const archivedCountLine = (archived, { player = "", lookups = false } = {}) => {
  const chats = list(archived);
  if (!chats.length) return "";
  const names = [...new Set(chats.map((chat) => chatPartners(chat, player)))];
  const shown = names.slice(0, ARCHIVE_NAMES_LISTED).join("; ");
  const more = names.length > ARCHIVE_NAMES_LISTED ? `; ${names.length - ARCHIVE_NAMES_LISTED} more` : "";
  const ask = lookups ? "; ask past_talks, similar_events or chat_history if one matters" : "";
  return `${chats.length} older conversation${chats.length === 1 ? "" : "s"} kept on file (with ${shown}${more})${ask}.`;
};

// Everything the prompt says of the archived chats, after the chats it sends:
// the count, the word that still binds, and the excerpts that bear on now.
//   pastTalks  [{ id, score }] (the search's candidates) or null
export const renderArchivedChats = (archived, pastTalks, { player = "", lookups = false } = {}) => {
  if (!list(archived).length) return "";
  const excerpts = pastTalks ? selectPastDiplomacy(pastTalks, archived, { player }) : { text: "", memoryQuoted: new Set() };
  // A thread whose memory the excerpts quote has its binding word there.
  const binding = renderBindingWord(archived, { player, skip: excerpts.memoryQuoted });
  return [archivedCountLine(archived, { player, lookups }), binding, excerpts.text].filter(Boolean).join("\n\n");
};

// ---------------------------------------------------------------------------
// The past_talks lookup's answer (lookupTools.js PAST_TALKS_TOOL).

export const PAST_TALKS_DEFAULT = 4;
export const PAST_TALKS_MAX = 8;
const PAST_TALKS_EXCERPT_CHARS = 900;

export const pastTalksAnswer = (ranked, archived, { player = "", limit = PAST_TALKS_DEFAULT, withPower = "" } = {}) => {
  const byId = new Map(list(archived).map((chat) => [clean(chat?.id), chat]));
  const wanted = fold(withPower);
  const found = [];
  for (const { id, score } of list(ranked)) {
    const key = parseChunkKey(id);
    const chat = key ? byId.get(key.chatId) : null;
    if (!chat) continue;
    if (wanted && !membersOf(chat).some((name) => fold(name) === wanted)) continue;
    const chunk = chatChunks(chat)[key.chunk];
    if (!chunk) continue;
    const { chatId } = key;
    found.push({ with: chatPartners(chat, player), chatId, dates: span(chunk.from, chunk.to), excerpt: cut(chunk.text, PAST_TALKS_EXCERPT_CHARS), similarity: Math.round(score * 100) / 100 });
    if (found.length >= limit) break;
  }
  return found.length ? { talks: found } : { talks: [], note: "No older conversation on file is close to that." };
};
