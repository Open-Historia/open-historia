/*! Open Historia - bounded Advisor diplomacy and targeted canonical chat retrieval. AGPL-3.0-or-later. */

// This is a VIEW of saved diplomacy. Never fold, rewrite or trim canonical chat
// messages here. Short summaries cannot authorize commitments or establish
// changed state; the source messages and their dates remain the authority.
import { filterChatsVisibleTo } from "./chatVisibility.js";
import { sortDiplomaticChatsByRecentActivity } from "./promptContext.js";
import {
  chatArchiveContext, partitionChats, renderArchivedChats, unfoldedChats,
} from "./chatArchive.js";

export const ADVISOR_DIPLOMACY_CONTEXT_MAX_CHARS = 16000;
export const ADVISOR_DIPLOMACY_MESSAGE_MAX_CHARS = 900;
const BRIEF_THREAD_LIMIT = 14;
const MAX_SEARCH_RESULTS = 4;
const STOP = new Set([
  "the","and","or","but","for","from","with","what","when","where","which","whose",
  "why","how","was","were","are","is","have","has","had","can","could","would","should",
  "will","into","about","that","this","these","those","they","them","you","your",
  "our","their","did","does","done","please","there","been","than","then",
  "once","said","tell","more","less","show","explain","regarding",
]);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const safe = (value) => clean(value).replace(/`{3,}/g, "'");
const clipped = (value, max) => {
  const raw = safe(value);
  const bound = Math.max(0, Math.trunc(Number(max) || 0));
  if (!bound) return "";
  return raw.length <= bound ? raw : raw.slice(0, Math.max(0, bound - 1)).trimEnd() + "…";
};
const list = (value) => Array.isArray(value) ? value : [];
const tokensOf = (value) => {
  const words = [...new Set(clean(value).toLowerCase()
    .match(/[\p{L}\p{N}]{3,}/gu)?.filter((word) => !STOP.has(word)) || [])];
  // Long presidential turns often put their actual question at the end.
  return words.length <= 18 ? words : [...words.slice(0, 6), ...words.slice(-12)];
};
const partnersOf = (chat) => list(chat?.countries).map((c) => clean(c?.name || c?.code)).filter(Boolean);
const headingOf = (chat) => safe(chat?.title) || partnersOf(chat).join(", ") || "Unnamed diplomatic thread";
const lastMemoryOf = (chat) => {
  for (const msg of [...list(chat?.messages)].reverse()) {
    if (clean(msg?.memorySummary)) return { summary: clean(msg.memorySummary), date: clean(msg.time) };
  }
  return null;
};
const lastDateOf = (chat) => {
  for (const msg of [...list(chat?.messages)].reverse()) if (clean(msg?.time)) return clean(msg.time);
  return "";
};
const labeledMessage = (msg, max) =>
  clipped(`[${clean(msg?.time) || "undated"}] ${safe(msg?.speaker || msg?.role || "Unknown")}: ${safe(msg?.text)}`, max);
const visibleChats = (chats, visibleTo = "") =>
  filterChatsVisibleTo(list(chats), visibleTo);

const matchCount = (haystack, terms) => {
  const h = String(haystack ?? "").toLowerCase();
  return terms.reduce((sum, term) => sum + (h.includes(term) ? 1 : 0), 0);
};
const excerptNear = (value, terms, max) => {
  const raw = safe(value);
  if (raw.length <= max) return raw;
  const lower = raw.toLowerCase();
  const span = Math.max(1, max - 2);
  const positions = new Set([0, Math.max(0, raw.length - span)]);
  // Search several bounded windows, not merely the earliest match. A long
  // agreement can name its subject in paragraph one but contain the requested
  // limiting clause at the end. Prefer the window with the most distinct
  // source-matched query terms, without expanding the prompt budget.
  for (const term of terms) {
    let at = lower.indexOf(term);
    let seen = 0;
    while (at >= 0 && seen < 12) {
      positions.add(Math.min(Math.max(0, at - Math.floor(span / 3)), raw.length - span));
      at = lower.indexOf(term,at + term.length);
      seen++;
    }
    const last = lower.lastIndexOf(term);
    if (last >= 0) positions.add(Math.min(Math.max(0, last - Math.floor(span / 3)), raw.length - span));
  }
  let bestStart = 0;
  let bestScore = -1;
  for (const start of positions) {
    const section = lower.slice(start,start + span);
    const score = matchCount(section,terms);
    if (score > bestScore || (score === bestScore && start > bestStart)) {
      bestScore = score;
      bestStart = start;
    }
  }
  const end = Math.min(raw.length,bestStart + span);
  return (bestStart ? "…" : "") + raw.slice(bestStart,end).trim()
    + (end < raw.length ? "…" : "");
};

// Finds dated source passages across *both* active and archived chats.
// It deliberately never uses names or freeform text as a canonical mutation ID.
// Callers may restrict visibility by polity; an inaccessible direct thread ID
// is a hard failure in readAdvisorDiplomaticMessages.
export const searchAdvisorDiplomaticMessages = (chats, {
  query = "", partner = "", visibleTo = "", limit = MAX_SEARCH_RESULTS,
  maxExcerptChars = ADVISOR_DIPLOMACY_MESSAGE_MAX_CHARS,
} = {}) => {
  const terms = tokensOf(query);
  const partnerTerms = tokensOf(partner);
  const limitBound = Math.min(MAX_SEARCH_RESULTS, Math.max(1, Math.trunc(Number(limit) || MAX_SEARCH_RESULTS)));
  if (!terms.length && !partnerTerms.length) return { matches: [], note: "A meaningful query or partner is required." };
  const matched = [];
  for (const chat of visibleChats(chats, visibleTo)) {
    const threadId = clean(chat?.id);
    if (!threadId) continue;
    const participants = partnersOf(chat).join(", ");
    const threadHeading = headingOf(chat);
    if (partnerTerms.length && matchCount(participants + " " + threadHeading, partnerTerms) === 0) continue;
    const headingMatches = matchCount(participants + " " + threadHeading, terms);
    for (const [messageIndex, msg] of list(chat?.messages).entries()) {
      const text = clean(msg?.text);
      if (!text) continue;
      const contentMatches = matchCount(text, terms);
      const dateMatches = terms.some((term) => /^\d{4}$/.test(term) && clean(msg?.time).startsWith(term));
      const score = contentMatches * 4 + (headingMatches && contentMatches ? headingMatches * 2 : 0)
        + (dateMatches ? 3 : 0) + (partnerTerms.length ? 2 : 0);
      if (score <= 0) continue;
      matched.push({
        threadId, participant: participants, title: threadHeading,
        messageIndex, sourceMessageId: clean(msg?.id), sourceChars: String(msg?.text ?? "").length,
        speaker: clean(msg?.speaker || msg?.role || "Unknown"),
        date: clean(msg?.time) || "undated",
        excerpt: excerptNear(text, terms, Math.min(ADVISOR_DIPLOMACY_MESSAGE_MAX_CHARS,
          Math.max(100, Math.trunc(Number(maxExcerptChars) || ADVISOR_DIPLOMACY_MESSAGE_MAX_CHARS)))),
        score,
      });
    }
  }
  matched.sort((a,b) => b.score-a.score || String(b.date).localeCompare(String(a.date))
    || a.threadId.localeCompare(b.threadId) || a.messageIndex-b.messageIndex);
  // A single active thread cannot monopolize every result when other sources match.
  const perThread = new Map();
  const results = [];
  for (const item of matched) {
    const n = perThread.get(item.threadId) || 0;
    if (n >= 2) continue;
    perThread.set(item.threadId, n+1);
    results.push(item);
    if (results.length >= limitBound) break;
  }
  return { matches: results, source: "saved diplomacy; not evidence of current operational status" };
};

export const readAdvisorDiplomaticMessages = (chats, {
  threadId = "", around, messageIndex, offset = 0, maxChars = ADVISOR_DIPLOMACY_MESSAGE_MAX_CHARS,
  messageId = "", visibleTo = "", limit = 3,
} = {}) => {
  // These are saved exact source messages, not AI summaries. The index and
  // offset refer to the same original string on every call so a long treaty
  // can be reconstructed in bounded chunks, with no hidden 900-char cutoff.
  const chat = visibleChats(chats, visibleTo).find((row) => clean(row?.id) === clean(threadId) && clean(threadId));
  if (!chat) return { error: "Diplomatic thread is not accessible." };
  const messages = list(chat?.messages);
  const requestedIndex = messageIndex === undefined ? around : messageIndex;
  if (requestedIndex !== undefined && (!Number.isInteger(requestedIndex) || requestedIndex < 0)) {
    return { error: "A valid nonnegative message index is required." };
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return { error: "A valid nonnegative message offset is required." };
  }
  if (messageId && (!clean(messageId) || typeof messageId !== "string")) {
    return { error: "A valid source message ID is required." };
  }
  const limitBound = Math.min(4, Math.max(1, Math.trunc(Number(limit) || 3)));
  const pageChars = Math.min(2000, Math.max(100, Math.trunc(Number(maxChars) || ADVISOR_DIPLOMACY_MESSAGE_MAX_CHARS)));
  const first = requestedIndex === undefined ? Math.max(0, messages.length-limitBound) : requestedIndex;
  if (first >= messages.length) return { error: "Message index is outside this thread." };
  if (offset && requestedIndex === undefined) return { error: "Message index is required to page source text." };
  const count = offset || messageId ? 1 : limitBound;
  const selected = messages.slice(first,first+count);
  if (messageId && clean(selected[0]?.id) !== messageId) {
    return { error: "Source message ID does not match this thread and index." };
  }
  if (offset >= String(selected[0]?.text ?? "").length && offset > 0) {
    return { error: "Message offset is outside this source text." };
  }
  return {
    threadId: chat.id, title: headingOf(chat), participant: partnersOf(chat).join(", "),
    totalMessages: messages.length,
    messages: selected.map((msg,i) => {
      const sourceText = String(msg?.text ?? "");
      const at = i === 0 ? offset : 0;
      const excerpt = sourceText.slice(at,at+pageChars);
      const nextOffset = at+excerpt.length;
      return {
        messageIndex:first+i, sourceMessageId:clean(msg?.id), date:clean(msg?.time) || "undated",
        speaker:clean(msg?.speaker || msg?.role || "Unknown"),
        offset:at, totalChars:sourceText.length, excerpt,
        hasMore:nextOffset < sourceText.length,
        nextOffset:nextOffset < sourceText.length ? nextOffset : null,
      };
    }),
  };
};

const renderThread = (chat) => {
  const memory = lastMemoryOf(chat);
  const latest = list(chat?.messages).filter((m) => clean(m?.text)).slice(-2);
  const parts = [
    `- ${clipped(headingOf(chat),100)} [${lastDateOf(chat) || "undated"}]`,
    ...(memory ? [`Durable diplomatic memory (${memory.date || "earlier"}): ${clipped(memory.summary,440)}`] : []),
    ...latest.map((m) => labeledMessage(m,210)),
  ];
  return clipped(parts.join(" | "), 900);
};

// A broad deterministic index comes BEFORE detailed per-thread excerpts.
// Without it, capped sampling can silently suppress an entire still-active
// diplomatic relationship. Summaries are explicitly described as historical
// records, never as current sovereign commitments or approvals.
const renderStandingIndex = (active, maxChars) => {
  const header = "Standing commitments index (recorded summaries; verify exact terms from source):\n";
  let output = header;
  let shown = 0;
  const cap = Math.max(header.length + 200, Math.trunc(maxChars));
  for (const chat of active) {
    const memory = lastMemoryOf(chat);
    const latest = [...list(chat?.messages)].reverse().find((msg) => clean(msg?.text));
    const openDemandCount = list(chat?.demands).filter((d) =>
      ["open","countered"].includes(clean(d?.status).toLowerCase())).length;
    const pending = openDemandCount ? ` [${openDemandCount} open demand(s)]` : "";
    const note = memory ? memory.summary : latest?.text || "No recorded message summary";
    const line = clipped(`- Source thread ${clean(chat?.id)}: ${headingOf(chat)}${pending}; `
      + `[${memory?.date || latest?.time || "undated"}] ${note}`, 162) + "\n";
    if (output.length + line.length + 100 > cap) break;
    output += line;
    shown++;
  }
  const omitted = active.length - shown;
  if (omitted > 0) {
    output += `[${omitted} further active thread(s) omitted from this bounded index; use source lookup.]\n`;
  }
  return output;
};

// A fair cross-thread overview. Do NOT use the normal chatHistoryLong renderer
// here: its last ten messages in each of eight threads can exceed 100k chars.
// The archive/tier sources remain unchanged, and current-question evidence
// can recover detail from an ACTIVE old thread, not just an archived one.
export const renderAdvisorDiplomaticContext = ({
  chats = [], world = {}, game = {}, question = "", pastTalks = null,
  visibleTo = "", maxChars = ADVISOR_DIPLOMACY_CONTEXT_MAX_CHARS,
} = {}) => {
  const ceiling = Math.max(1000, Math.trunc(Number(maxChars) || ADVISOR_DIPLOMACY_CONTEXT_MAX_CHARS));
  const visible = visibleChats(chats, visibleTo);
  const all = sortDiplomaticChatsByRecentActivity(visible);
  const unfolded = unfoldedChats(all,world);
  const { active, archived } = partitionChats(unfolded,chatArchiveContext({game,world,chats:visible}));
  const head = "[Diplomatic Continuity - bounded view of canonical chats]\n"
    + `Recorded threads: ${visible.length}; currently unconsolidated: ${unfolded.length}; `
    + `active: ${active.length}; archived: ${archived.length}. `
    + "These excerpts are historical evidence, not new orders or proof of execution. "
    + "If exact older terms matter, use the diplomatic history lookup when available; "
    + "otherwise distinguish summaries from verified quotations.\n";
  let output = head;
  // Evidence selection is based on actual source-token overlap, not a fixed
  // English topic keyword list. An indirect or non-English question can still
  // retrieve an exact treaty/place term appearing in an older source.
  const terms = tokensOf(question);
  const namedTerms = new Set(
    [...String(question).matchAll(/(?<![\p{L}\p{N}])(\p{Lu}[\p{L}\p{N}]{4,})/gu)]
      .filter((match) => match.index > 0).map((match) => match[1].toLowerCase()),
  );
  const findings = searchAdvisorDiplomaticMessages(visible,{
    query:question,limit:3,maxExcerptChars:650,
  }).matches.filter((row) => {
    const contentHits = matchCount(row.excerpt,terms);
    // Require two independently matched details, or a named subject from
    // the player's question. A single generic word such as "administrative"
    // must not summon irrelevant diplomatic evidence into a domestic query.
    return contentHits >= 2 || [...namedTerms].some((word) => row.excerpt.toLowerCase().includes(word));
  });
  if (findings.length) {
    let section = "Relevant dated passages from saved diplomacy (matched to the current question):\n";
    for (const row of findings) {
      section += `- [${row.date}] ${clipped(row.participant,80)} / ${clipped(row.speaker,65)}: ${clipped(row.excerpt,650)}\n`;
    }
    if (output.length + section.length <= ceiling-650) output += section;
  }
  // Preserve broad continuity even when a question is unrelated to diplomacy
  // and provider lookup functions are disabled. A short index is cheap enough
  // to include every current relationship in an ordinary long campaign.
  const index = renderStandingIndex(active, Math.min(7000, Math.floor(ceiling * 0.48)));
  if (output.length + index.length + 250 < ceiling) output += index;
  output += "Most recent unconsolidated diplomatic threads (memory and attributed recent evidence):\n";
  let shown=0;
  // Reserve a couple of slots for older still-active relationships, so a wave
  // of fresh routine chats cannot hide every standing older commitment.
  const newest = active.slice(0,Math.max(0,BRIEF_THREAD_LIMIT-2));
  const older = active.length > BRIEF_THREAD_LIMIT ? active.slice(-2) : active.slice(newest.length);
  const sampled = [...new Map([...newest,...older].map((chat) => [chat.id,chat])).values()];
  for (const chat of sampled) {
    const row = renderThread(chat) + "\n";
    if (output.length+row.length+100 > ceiling) break;
    output += row;
    shown++;
  }
  const omitted = active.length-shown;
  if (omitted>0 && output.length+100<ceiling) output += `[${omitted} other active threads omitted from this brief; complete records remain saved.]\n`;
  const archivedText = renderArchivedChats(archived,pastTalks,{player:game?.country,lookups:false});
  if (archivedText && output.length < ceiling-180) {
    output += clipped("\nArchived diplomacy (targeted retrieval and standing commitments):\n"+archivedText,
      ceiling-output.length);
  }
  return output.length <= ceiling ? output : output.slice(0,ceiling);
};

const toolSchema = (description, properties, required = []) => ({
  type:"object", description, properties, required, additionalProperties:false,
});
export const ADVISOR_DIPLOMACY_LOOKUP_TOOLS = Object.freeze([
  {
    name:"search_advisor_diplomacy",
    description:"Search exact dated messages in the player's saved diplomatic conversations, including old messages in ACTIVE threads and archived chats. Search before asserting exact old treaty terms. Returns threadId/messageIndex for a follow-up read.",
    schema:toolSchema("Search saved diplomatic messages.",{
      query:{type:"string",description:"Distinctive treaty, participant, or subject terms to locate in historical conversation records."},
      partner:{type:"string",description:"Optional participant name to narrow the search."},
      limit:{type:"integer",description:"Max matches (1-4)."},
    },["query"]),
  },
  {
    name:"read_advisor_diplomacy",
    description:"Read exact paginated source text from saved diplomacy. Use exact threadId and messageIndex from search; inspect hasMore and continue at nextOffset until the relevant treaty passage is complete. Never invent IDs or treat conversation text as an authorization.",
    schema:toolSchema("Read source diplomatic messages.",{
      threadId:{type:"string",description:"Exact threadId returned by a diplomatic search."},
      around:{type:"integer",description:"Legacy first message index, or omit for newest messages."},
      messageIndex:{type:"integer",description:"Exact source message index from search for paginated reading."},
      messageId:{type:"string",description:"Optional stable source message ID from search; validated against the selected message."},
      offset:{type:"integer",description:"Start character offset of this message, initially 0; use the returned nextOffset to continue."},
      maxChars:{type:"integer",description:"Source characters per page (100-2000)."},
      limit:{type:"integer",description:"Number of adjacent messages (1-4); pagination selects one message."},
    },["threadId"]),
  },
]);
export const advisorDiplomaticLookups = ({chats = [], visibleTo = ""} = {}) => ({
  tools:ADVISOR_DIPLOMACY_LOOKUP_TOOLS,
  // Search + several bounded pages can be necessary for one long treaty.
  // Provider-wide lookup limits still apply; this does not remove guards.
  maxRounds:5,
  execute:async(name,args={}) => {
    if(name==="search_advisor_diplomacy") return searchAdvisorDiplomaticMessages(chats,{...args,visibleTo});
    if(name==="read_advisor_diplomacy") return readAdvisorDiplomaticMessages(chats,{...args,visibleTo});
    return {error:"Unknown Advisor diplomatic lookup."};
  },
});
